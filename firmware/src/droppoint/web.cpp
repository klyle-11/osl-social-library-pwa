// The drop point's web servers (ESP-IDF esp_http_server, and esp_https_server when
// LIBRARY_HTTPS is 1). Everything the app asks under /api/ is answered by osl::Api
// (lib/osl_node/src/osl_api.h, tested on a computer); this file only moves requests
// and replies between it and the network, and serves the app's own files.
//
// The library's address (config.h):
//   GET  /*        the app (files from LittleFS /www, built by `npm run build:firmware`)
//   *    /api/*    osl::Api
// Port 80, when the library's address is elsewhere:
//   operating-system connectivity checks answered "online", so phones stay on this
//   network and don't open the captive-portal mini browser (which can't run the app);
//   /ca.pem for installing a test CA; everything else redirects to the library's address.

#include <sys/stat.h>

#include <string>

#include "config.h"
#include "droppoint.h"

#if LIBRARY_HTTPS
#include <esp_https_server.h>
#else
#include <esp_http_server.h>
#endif

static const char* WWW = "/littlefs/www";
static httpd_handle_t appServer = nullptr, plainServer = nullptr;

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
    if (ends(".json")) return "application/json; charset=utf-8";
    if (ends(".png")) return "image/png";
    if (ends(".svg")) return "image/svg+xml";
    if (ends(".pem")) return "application/x-x509-ca-cert";
    return "application/octet-stream";
}

static const char* statusLine(int status) {
    switch (status) {
        case 200: return "200 OK";
        case 400: return "400 Bad Request";
        case 404: return "404 Not Found";
        case 413: return "413 Payload Too Large";
        case 503: return "503 Service Unavailable";
        case 507: return "507 Insufficient Storage";
        default: return "500 Internal Server Error";
    }
}

static esp_err_t sendFile(httpd_req_t* req, const std::string& path) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) {
        httpd_resp_set_status(req, "404 Not Found");
        httpd_resp_set_type(req, "application/json");
        return httpd_resp_sendstr(req, "{\"error\":\"not at this drop point\"}");
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

// An osl::Reply that streams through the IDF server in chunks.
class ChunkReply : public osl::Reply {
   public:
    explicit ChunkReply(httpd_req_t* r) : req_(r) {}
    void begin(int status, const char* type) override {
        httpd_resp_set_status(req_, statusLine(status));
        httpd_resp_set_type(req_, type);
        httpd_resp_set_hdr(req_, "Cache-Control", "no-store");
    }
    using osl::Reply::write;  // keep write(const char*) visible next to the override
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
    esp_err_t finish() {
        flush();
        return httpd_resp_send_chunk(req_, nullptr, 0);
    }

   private:
    void flush() {
        if (len_ && httpd_resp_send_chunk(req_, buf_, len_) != ESP_OK) failed_ = true;
        len_ = 0;
    }
    httpd_req_t* req_;
    char buf_[1024];
    size_t len_ = 0;
    bool failed_ = false;
};

// Operating systems check for the internet when they join a network. Answering
// "online" keeps the phone on this network with its normal browser.
static bool connectivityCheck(httpd_req_t* req, const std::string& u) {
    if (u == "/hotspot-detect.html" || u == "/library/test/success.html") {  // Apple
        httpd_resp_set_type(req, "text/html");
        httpd_resp_sendstr(req, "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
        return true;
    }
    if (u == "/generate_204" || u == "/gen_204") {  // Android, Chrome
        httpd_resp_set_status(req, "204 No Content");
        httpd_resp_send(req, nullptr, 0);
        return true;
    }
    if (u == "/ncsi.txt") { httpd_resp_sendstr(req, "Microsoft NCSI"); return true; }
    if (u == "/connecttest.txt") { httpd_resp_sendstr(req, "Microsoft Connect Test"); return true; }
    return false;
}

static void splitUri(httpd_req_t* req, std::string* path, std::string* query) {
    std::string u = req->uri;
    size_t q = u.find('?');
    *path = u.substr(0, q);
    *query = q == std::string::npos ? "" : u.substr(q + 1);
}

// Every request at the library's address: the API, else the app's files.
static esp_err_t appHandler(httpd_req_t* req) {
    osl::Request r;
    splitUri(req, &r.path, &r.query);
    r.method = req->method == HTTP_POST ? "POST" : "GET";
    if (connectivityCheck(req, r.path)) return ESP_OK;

    if (r.path.compare(0, 5, "/api/") == 0) {
        char* body = nullptr;
        size_t len = req->content_len;
        if (req->method == HTTP_POST) {
            if (len > API_MAX_BODY) {
                ChunkReply out(req);
                out.begin(413, "application/json");
                out.write("{\"error\":\"too much in one request\"}");
                return out.finish();
            }
            body = (char*)malloc(len ? len : 1);
            if (!body) {
                ChunkReply out(req);
                out.begin(503, "application/json");
                out.write("{\"error\":\"busy\"}");
                return out.finish();
            }
            size_t got = 0;
            while (got < len) {
                int n = httpd_req_recv(req, body + got, len - got);
                if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
                if (n <= 0) {
                    free(body);
                    return ESP_FAIL;
                }
                got += n;
            }
            r.body = body;
            r.bodyLen = len;
        }
        ChunkReply out(req);
        {
            // ops the API stores are durable (fsync) before the reply says they were taken
            StoreLock lock;
            api().handle(r, millis(), out);
        }
        free(body);
        return out.finish();
    }

    if (req->method != HTTP_GET) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_sendstr(req, "not found");
    }
    std::string u = r.path;
    if (u.find("..") != std::string::npos) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad path");
    }
    if (u.empty() || u.back() == '/') u += "index.html";
    std::string path = WWW + u;
    // The app's routes are in the hash (#/document/...), so a path without an extension
    // is only ever the start page asked for another way.
    if (!fileExists(path) && u.find('.', u.rfind('/')) == std::string::npos) path = std::string(WWW) + "/index.html";
    return sendFile(req, path);
}

// Port 80 when the library is elsewhere: connectivity checks, the test CA, and a redirect.
static esp_err_t plainHandler(httpd_req_t* req) {
    std::string path, query;
    splitUri(req, &path, &query);
    if (connectivityCheck(req, path)) return ESP_OK;
    if (path == "/ca.pem" && fileExists("/littlefs/tls/ca.pem")) return sendFile(req, "/littlefs/tls/ca.pem");
    std::string to = std::string(libraryAddress()) + path;
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

#if LIBRARY_HTTPS
static char *certPem = nullptr, *keyPem = nullptr;
static size_t certLen = 0, keyLen = 0;

static bool loadFile(const char* path, char** out, size_t* len) {
    FILE* f = fopen(path, "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    *out = (char*)malloc(n + 1);
    bool ok = *out && fread(*out, 1, n, f) == (size_t)n;
    fclose(f);
    if (!ok) return false;
    (*out)[n] = 0;
    *len = n + 1;  // esp_https_server wants the terminating NUL counted
    return true;
}
#endif

bool webStart() {
    httpd_config_t base = HTTPD_DEFAULT_CONFIG();
    base.uri_match_fn = httpd_uri_match_wildcard;
    base.lru_purge_enable = true;
    base.stack_size = 12288;

#if LIBRARY_HTTPS
    if (!loadFile("/littlefs/tls/cert.pem", &certPem, &certLen) || !loadFile("/littlefs/tls/key.pem", &keyPem, &keyLen)) return false;
    // Filled in field by field: HTTPD_SSL_CONFIG_DEFAULT() is a C designated initializer
    // that the board's C++ compiler (GCC 8) refuses.
    httpd_ssl_config_t conf;
    memset(&conf, 0, sizeof conf);
    conf.httpd = base;
    conf.httpd.server_port = 0;  // set from port_secure by the server
    conf.httpd.ctrl_port = base.ctrl_port + 1;
    conf.httpd.max_open_sockets = 3;  // each TLS session needs ~40 KB of RAM
    conf.cacert_pem = (const uint8_t*)certPem;  // in IDF 4.4 this field is the server certificate
    conf.cacert_len = certLen;
    conf.prvtkey_pem = (const uint8_t*)keyPem;
    conf.prvtkey_len = keyLen;
    conf.transport_mode = HTTPD_SSL_TRANSPORT_SECURE;
    conf.port_secure = 443;
    conf.port_insecure = 80;
    if (httpd_ssl_start(&appServer, &conf) != ESP_OK) return false;
    const int appPort = 443;
#else
    httpd_config_t conf = base;
    conf.server_port = LIBRARY_PORT;
    conf.max_open_sockets = 5;
    if (httpd_start(&appServer, &conf) != ESP_OK) return false;
    const int appPort = LIBRARY_PORT;
#endif
    reg(appServer, "/*", HTTP_GET, appHandler);
    reg(appServer, "/*", HTTP_POST, appHandler);

    if (appPort != 80) {
        httpd_config_t plain = base;
        plain.server_port = 80;
        plain.ctrl_port = base.ctrl_port + 2;
        plain.max_open_sockets = 2;
        if (httpd_start(&plainServer, &plain) == ESP_OK) reg(plainServer, "/*", HTTP_GET, plainHandler);
    }
    return true;
}
