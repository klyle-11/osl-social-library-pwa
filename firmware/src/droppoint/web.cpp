// The drop point's web servers (ESP-IDF esp_https_server / esp_http_server).
//
// HTTPS :443, same address and certificate as the archive:
//   GET  /*          the app (files from LittleFS /www, built by `npm run build:firmware`)
//   POST /sync       phones hand in ops, receive the archive's moderated ops
//   GET  /status     counters for testing
//   PUT  /media/*    refused (503): files wait on the phone until it reaches the archive
// HTTP :80:
//   operating-system connectivity checks answered "online", so phones stay on this
//   network and don't open the captive-portal mini browser (which can't install the app);
//   /ca.pem for installing a test CA; everything else redirects to https.

#include <esp_https_server.h>
#include <sys/stat.h>

#include <string>

#include "config.h"
#include "droppoint.h"
#include "osl_sync.h"

static const char* WWW = "/littlefs/www";
static httpd_handle_t httpsServer = nullptr, httpServer = nullptr;
static char *certPem = nullptr, *keyPem = nullptr;
static size_t certLen = 0, keyLen = 0;

static bool loadFile(const char* path, char** out, size_t* len) {
    FILE* f = fopen(path, "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    *out = (char*)malloc(n + 1);
    if (!*out || fread(*out, 1, n, f) != (size_t)n) {
        fclose(f);
        return false;
    }
    fclose(f);
    (*out)[n] = 0;
    *len = n + 1;  // esp_https_server wants the terminating NUL counted
    return true;
}

static bool fileExists(const std::string& path) {
    struct stat st;
    return stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode);
}

static const char* contentType(const std::string& p) {
    auto ends = [&](const char* e) { size_t n = strlen(e); return p.size() >= n && !p.compare(p.size() - n, n, e); };
    if (ends(".html")) return "text/html; charset=utf-8";
    if (ends(".js")) return "text/javascript; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".webmanifest")) return "application/manifest+json";
    if (ends(".png")) return "image/png";
    if (ends(".json")) return "application/json";
    if (ends(".pem")) return "application/x-x509-ca-cert";
    return "application/octet-stream";
}

static esp_err_t sendFile(httpd_req_t* req, const std::string& path) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "not found");
        return ESP_OK;
    }
    httpd_resp_set_type(req, contentType(path));
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");  // the service worker does the offline caching
    char buf[2048];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) {
        if (httpd_resp_send_chunk(req, buf, n) != ESP_OK) {
            fclose(f);
            return ESP_FAIL;
        }
    }
    fclose(f);
    return httpd_resp_send_chunk(req, nullptr, 0);
}

static std::string uriPath(httpd_req_t* req) {
    std::string u = req->uri;
    size_t q = u.find('?');
    if (q != std::string::npos) u.resize(q);
    return u;
}

// ---- HTTPS ----

static esp_err_t staticHandler(httpd_req_t* req) {
    std::string u = uriPath(req);
    if (u.find("..") != std::string::npos) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "bad path");
        return ESP_OK;
    }
    if (u.empty() || u.back() == '/') u += "index.html";
    std::string path = WWW + u;
    if (!fileExists(path)) {
        size_t slash = u.rfind('/');
        if (u.find('.', slash) == std::string::npos) path = std::string(WWW) + "/index.html";  // app route
    }
    return sendFile(req, path);
}

class ChunkWriter : public osl::Writer {
   public:
    explicit ChunkWriter(httpd_req_t* r) : req_(r) {}
    void write(const char* s, size_t n) override {
        while (n) {
            size_t take = n < sizeof(buf_) - len_ ? n : sizeof(buf_) - len_;
            memcpy(buf_ + len_, s, take);
            len_ += take;
            s += take;
            n -= take;
            if (len_ == sizeof buf_) flush();
        }
    }
    void flush() {
        if (len_) httpd_resp_send_chunk(req_, buf_, len_);
        len_ = 0;
    }

   private:
    httpd_req_t* req_;
    char buf_[1024];
    size_t len_ = 0;
};

static esp_err_t syncHandler(httpd_req_t* req) {
    size_t len = req->content_len;
    if (len == 0 || len > SYNC_MAX_BODY) {
        httpd_resp_set_status(req, "413 Payload Too Large");
        httpd_resp_sendstr(req, "send fewer ops per request");
        return ESP_OK;
    }
    char* body = (char*)malloc(len);
    if (!body) {
        httpd_resp_set_status(req, "503 Service Unavailable");
        httpd_resp_sendstr(req, "busy");
        return ESP_OK;
    }
    size_t got = 0;
    while (got < len) {
        int r = httpd_req_recv(req, body + got, len - got);
        if (r == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (r <= 0) {
            free(body);
            return ESP_FAIL;
        }
        got += r;
    }

    osl::SyncOptions opt;
    opt.nodeId = nodeId.c_str();
    opt.shareLocal = SHARE_LOCAL_CONTRIBUTIONS;
    opt.allow = allowAuthor;
    osl::SyncResult result;
    StoreLock lock;  // ops written by applySync are durable before the reply says "acked"
    int status = osl::applySync(store, body, len, opt, &result);
    free(body);
    if (status != 200) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "bad request");
        return ESP_OK;
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    ChunkWriter w(req);
    osl::writeSyncReply(store, opt, result, w);
    w.flush();
    return httpd_resp_send_chunk(req, nullptr, 0);
}

static esp_err_t statusHandler(httpd_req_t* req) {
    JsonDocument d;
    {
        StoreLock lock;
        fillStatus(d);
    }
    std::string out;
    serializeJson(d, out);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, out.data(), out.size());
}

static esp_err_t mediaHandler(httpd_req_t* req) {
    if (req->method == HTTP_GET) {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "media stays at the archive");
        return ESP_OK;
    }
    httpd_resp_set_status(req, "503 Service Unavailable");
    httpd_resp_sendstr(req, "this drop point does not store files; they upload at the archive");
    return ESP_OK;
}

// ---- HTTP :80 ----

static esp_err_t plainHandler(httpd_req_t* req) {
    std::string u = uriPath(req);
    if (u == "/hotspot-detect.html" || u == "/library/test/success.html") {  // Apple
        httpd_resp_set_type(req, "text/html");
        return httpd_resp_sendstr(req, "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
    }
    if (u == "/generate_204" || u == "/gen_204") {  // Android / Chrome
        httpd_resp_set_status(req, "204 No Content");
        return httpd_resp_send(req, nullptr, 0);
    }
    if (u == "/ncsi.txt") return httpd_resp_sendstr(req, "Microsoft NCSI");
    if (u == "/connecttest.txt") return httpd_resp_sendstr(req, "Microsoft Connect Test");
    if (u == "/ca.pem" && fileExists("/littlefs/tls/ca.pem")) return sendFile(req, "/littlefs/tls/ca.pem");

    std::string to = std::string("https://") + LIBRARY_DOMAIN + u;
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", to.c_str());
    return httpd_resp_send(req, nullptr, 0);
}

static void reg(httpd_handle_t s, const char* uri, httpd_method_t m, esp_err_t (*fn)(httpd_req_t*)) {
    httpd_uri_t h = {};
    h.uri = uri;
    h.method = m;
    h.handler = fn;
    httpd_register_uri_handler(s, &h);
}

bool webStart() {
    if (!loadFile("/littlefs/tls/cert.pem", &certPem, &certLen) || !loadFile("/littlefs/tls/key.pem", &keyPem, &keyLen)) return false;

    httpd_ssl_config_t conf = HTTPD_SSL_CONFIG_DEFAULT();
    conf.cacert_pem = (const uint8_t*)certPem;  // in IDF 4.4 this field is the server certificate
    conf.cacert_len = certLen;
    conf.prvtkey_pem = (const uint8_t*)keyPem;
    conf.prvtkey_len = keyLen;
    conf.httpd.max_open_sockets = 3;  // each TLS session needs ~40 KB of RAM
    conf.httpd.uri_match_fn = httpd_uri_match_wildcard;
    conf.httpd.stack_size = 12288;
    conf.httpd.lru_purge_enable = true;
    if (httpd_ssl_start(&httpsServer, &conf) != ESP_OK) return false;
    // more specific patterns first: the first match wins
    reg(httpsServer, "/sync", HTTP_POST, syncHandler);
    reg(httpsServer, "/status", HTTP_GET, statusHandler);
    reg(httpsServer, "/media/*", HTTP_PUT, mediaHandler);
    reg(httpsServer, "/media/*", HTTP_GET, mediaHandler);
    reg(httpsServer, "/*", HTTP_GET, staticHandler);

    httpd_config_t plain = HTTPD_DEFAULT_CONFIG();
    plain.server_port = 80;
    plain.ctrl_port = 32769;  // the HTTPS server uses 32768
    plain.max_open_sockets = 2;
    plain.uri_match_fn = httpd_uri_match_wildcard;
    plain.lru_purge_enable = true;
    if (httpd_start(&httpServer, &plain) == ESP_OK) reg(httpServer, "/*", HTTP_GET, plainHandler);
    return true;
}
