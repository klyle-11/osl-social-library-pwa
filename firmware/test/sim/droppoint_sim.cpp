// A drop point, on a computer: the same op log, API and forwarding as
// firmware/src/droppoint/main.cpp (osl_store, osl_api, osl_link), behind a small
// HTTP server instead of the board's, and a pretend radio (sim_radio.h).
//   droppoint_sim <http port> <www dir> <data dir> <my udp port> <modem's udp port> [loss 0..1]
// Test only: POST /sim/radio?on=0|1 takes the radio out of range and back.
#include <ArduinoJson.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include "../../lib/osl_node/src/osl_api.h"
#include "../../lib/osl_node/src/osl_ops.h"
#include "../../lib/osl_node/src/osl_store.h"
#include "sim_radio.h"

static constexpr uint8_t KIND_OP = 1;
static const char* NODE_ID = "drop-51a51a";

static osl::Store store;
static osl::Link* radioLink;
static SimRadio* radio;
static uint32_t fwdMsg = 0, fwdSeq = 0;
static unsigned forwarded = 0, received = 0;

// ---- radio: as main.cpp ----

static void onDeliver(void*, uint32_t msgId, const uint8_t* data, size_t len) {
    if (len < 2 || data[0] != KIND_OP) {
        fprintf(stderr, "drop point: dropped a radio message of an unknown kind\n");
        radioLink->markDurable(msgId);
        return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, (const char*)data + 1, len - 1) || osl::validateOp(doc.as<JsonObjectConst>())) {
        fprintf(stderr, "drop point: dropped an invalid op from the library\n");
        radioLink->markDurable(msgId);
        return;
    }
    std::string json;
    serializeJson(doc, json);
    osl::Store::Result r = store.add(osl::Store::ARCHIVE, doc["id"].as<const char*>(), json.data(), json.size());
    if (r == osl::Store::ADDED || r == osl::Store::DUPLICATE) {
        received++;
        radioLink->markDurable(msgId);
    }
}

static void onRemoteDurable(void*, uint32_t msgId) {
    if (msgId != fwdMsg) return;
    store.forwarded(fwdSeq);
    forwarded++;
    fwdMsg = 0;
}

static void forwardNext() {
    if (fwdMsg || radioLink->busy()) return;
    uint32_t seq;
    std::string json;
    if (!store.peekForward(&seq, &json)) return;
    std::string msg(1, (char)KIND_OP);
    msg += json;
    fwdMsg = radioLink->send((const uint8_t*)msg.data(), msg.size());
    if (fwdMsg) fwdSeq = seq;
}

static void writeStatus(void*, osl::Writer& w) {
    char buf[256];
    snprintf(buf, sizeof buf,
             "{\"node\":\"%s\",\"role\":\"droppoint\",\"sim\":true,\"waitingToForward\":%u,\"forwardedThisBoot\":%u,"
             "\"receivedThisBoot\":%u,\"radio\":{\"ok\":%s}}",
             NODE_ID, (unsigned)store.waiting(), forwarded, received, radio->off ? "false" : "true");
    w.write(buf);
}

// ---- a small HTTP/1.1 server: one request per connection ----

struct BufReply : osl::Reply {
    int status = 200;
    std::string type = "application/json", body;
    void begin(int s, const char* t) override { status = s; type = t; }
    void write(const char* p, size_t n) override { body.append(p, n); }
};

static const char* reason(int s) {
    switch (s) {
        case 200: return "OK";
        case 400: return "Bad Request";
        case 404: return "Not Found";
        case 413: return "Payload Too Large";
        case 503: return "Service Unavailable";
        case 507: return "Insufficient Storage";
        default: return "Error";
    }
}

static const char* contentType(const std::string& p) {
    auto ends = [&](const char* e) { size_t n = strlen(e); return p.size() >= n && !p.compare(p.size() - n, n, e); };
    if (ends(".html")) return "text/html; charset=utf-8";
    if (ends(".js")) return "text/javascript; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".json")) return "application/json; charset=utf-8";
    if (ends(".webmanifest")) return "application/manifest+json";
    if (ends(".png")) return "image/png";
    return "application/octet-stream";
}

static void respond(int fd, int status, const std::string& type, const std::string& body) {
    std::string head = "HTTP/1.1 " + std::to_string(status) + " " + reason(status) + "\r\nContent-Type: " + type +
                       "\r\nContent-Length: " + std::to_string(body.size()) + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
    std::string all = head + body;
    for (size_t sent = 0; sent < all.size();) {
        ssize_t n = send(fd, all.data() + sent, all.size() - sent, MSG_NOSIGNAL);
        if (n <= 0) break;
        sent += n;
    }
}

static void serve(int fd, osl::Api& api, const std::string& www) {
    std::string req;
    char buf[4096];
    size_t headerEnd = std::string::npos, need = 0;
    while (true) {  // headers, then the body by Content-Length
        ssize_t n = recv(fd, buf, sizeof buf, 0);
        if (n <= 0) return;
        req.append(buf, n);
        if (headerEnd == std::string::npos && (headerEnd = req.find("\r\n\r\n")) != std::string::npos) {
            std::string lower = req.substr(0, headerEnd);
            for (char& c : lower) c = tolower(c);
            size_t cl = lower.find("content-length:");
            need = headerEnd + 4 + (cl == std::string::npos ? 0 : strtoul(lower.c_str() + cl + 15, nullptr, 10));
        }
        if (headerEnd != std::string::npos && req.size() >= need) break;
        if (req.size() > 64 * 1024) return respond(fd, 413, "text/plain", "too large");
    }
    std::string method = req.substr(0, req.find(' '));
    size_t a = req.find(' ') + 1, b = req.find(' ', a);
    std::string uri = req.substr(a, b - a);

    osl::Request r;
    r.method = method == "POST" ? "POST" : "GET";
    size_t q = uri.find('?');
    r.path = uri.substr(0, q);
    if (q != std::string::npos) r.query = uri.substr(q + 1);
    std::string body = req.substr(headerEnd + 4);
    r.body = body.data();
    r.bodyLen = body.size();

    if (r.path == "/sim/radio" && method == "POST") {
        radio->off = osl::queryParam(r.query, "on") == "0";
        return respond(fd, 200, "application/json", radio->off ? "{\"radio\":\"off\"}" : "{\"radio\":\"on\"}");
    }
    BufReply out;
    if (api.handle(r, radio->millis(), out)) return respond(fd, out.status, out.type, out.body);

    std::string path = r.path;
    if (path.find("..") != std::string::npos) return respond(fd, 400, "text/plain", "bad path");
    if (path.empty() || path.back() == '/') path += "index.html";
    std::ifstream f(www + path, std::ios::binary);
    if (!f) return respond(fd, 404, "application/json", "{\"error\":\"not at this drop point\"}");
    std::stringstream ss;
    ss << f.rdbuf();
    respond(fd, 200, contentType(path), ss.str());
}

int main(int argc, char** argv) {
    if (argc < 6) {
        fprintf(stderr, "usage: droppoint_sim <http port> <www dir> <data dir> <udp port> <modem udp port> [loss]\n");
        return 2;
    }
    signal(SIGPIPE, SIG_IGN);
    std::string www = argv[2];
    if (!store.begin(argv[3], 1 << 20)) {
        fprintf(stderr, "op log could not be opened in %s\n", argv[3]);
        return 1;
    }
    SimRadio io(atoi(argv[4]), atoi(argv[5]), argc > 6 ? atof(argv[6]) : 0);
    radio = &io;
    osl::Link link(io, simTimings());
    radioLink = &link;
    link.onDeliver(onDeliver, nullptr);
    link.onRemoteDurable(onRemoteDurable, nullptr);

    osl::Presence presence;
    osl::ApiConfig cfg;
    cfg.nodeId = NODE_ID;
    std::string address = std::string("http://localhost:") + argv[1];
    cfg.address = address.c_str();
    cfg.status = writeStatus;
    osl::Api api(store, presence, cfg);

    int server = socket(AF_INET, SOCK_STREAM, 0);
    int yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(atoi(argv[1]));
    if (bind(server, (sockaddr*)&addr, sizeof addr) || listen(server, 16)) {
        perror("http: bind");
        return 1;
    }
    printf("drop point %s on http://localhost:%s, %u ops, %u waiting to forward\n", NODE_ID, argv[1], (unsigned)store.lastSeq(),
           (unsigned)store.waiting());
    fflush(stdout);

    for (;;) {
        pollfd fds[2] = {{server, POLLIN, 0}, {io.fd(), POLLIN, 0}};
        poll(fds, 2, 20);
        if (fds[0].revents & POLLIN) {
            int c = accept(server, nullptr, nullptr);
            if (c >= 0) {
                timeval tv{2, 0};
                setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
                serve(c, api, www);
                close(c);
            }
        }
        io.poll(link);
        link.tick();
        forwardNext();
    }
}
