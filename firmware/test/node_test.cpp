// Desktop tests for the drop point: op validation, its op log, and its answers to the app.
//   sh firmware/test/run.sh
#include <unistd.h>  // mkdtemp on macOS
#include <ArduinoJson.h>

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include "../lib/osl_node/src/osl_api.h"
#include "../lib/osl_node/src/osl_ops.h"
#include "../lib/osl_node/src/osl_store.h"

using namespace osl;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

struct StrReply : Reply {
    int status = 0;
    std::string type, s;
    void begin(int st, const char* t) override { status = st; type = t; }
    void write(const char* p, size_t n) override { s.append(p, n); }
};

static std::string ann(const char* id, const char* body = "hi", const char* access = "public") {
    std::string user(id, strrchr(id, ':') - id);
    return std::string("{\"id\":\"") + id + "\",\"type\":\"annotation\",\"user\":\"" + user +
           "\",\"timestamp\":\"2026-10-04T14:22:05.000Z\",\"target\":\"steward:1\",\"body\":\"" + body + "\",\"access\":\"" +
           access + "\"}";
}

// One request through the API, with the reply parsed.
static JsonDocument call(Api& api, const char* method, const std::string& pathAndQuery, const std::string& body = "",
                         int* status = nullptr, uint32_t now = 1000) {
    Request r;
    r.method = method;
    size_t q = pathAndQuery.find('?');
    r.path = pathAndQuery.substr(0, q);
    if (q != std::string::npos) r.query = pathAndQuery.substr(q + 1);
    r.body = body.data();
    r.bodyLen = body.size();
    StrReply out;
    bool handled = api.handle(r, now, out);
    JsonDocument d;
    if (!handled) { d["handled"] = false; return d; }
    if (status) *status = out.status;
    CHECK(out.type == "application/json");
    DeserializationError e = deserializeJson(d, out.s);
    if (e) printf("  not JSON: %s\n", out.s.c_str());
    CHECK(!e);
    return d;
}

static std::string newDir() {
    char tmpl[] = "/tmp/osl-node-XXXXXX";
    return mkdtemp(tmpl);
}

int main() {
    // ---- validation: the same cases as the app (core/fixtures/validation.json) ----
    {
        std::ifstream f("../../core/fixtures/validation.json");
        std::stringstream text;
        text << f.rdbuf();
        JsonDocument cases;
        CHECK(!deserializeJson(cases, text.str()));
        CHECK(cases.size() > 30);
        for (JsonObjectConst c : cases.as<JsonArrayConst>()) {
            const char* why = validateOp(c["op"].as<JsonObjectConst>());
            bool valid = !why;
            if (valid != c["valid"].as<bool>()) {
                printf("  FAIL validation case \"%s\": app says %s, drop point says %s\n", c["case"].as<const char*>(),
                       c["valid"].as<bool>() ? "valid" : "invalid", why ? why : "valid");
                failures++;
            }
        }
        CHECK(utf16Length("a\xc3\xa9\xf0\x9f\x98\x80") == 4);  // a, é, 😀 (two units)
    }

    // ---- the API: phones hand in ops; only the library's ops are handed back ----
    std::string dir = newDir();
    {
        Store s;
        CHECK(s.begin(dir.c_str(), 1 << 20));
        Presence presence;
        ApiConfig cfg;
        cfg.nodeId = "drop-1";
        cfg.address = "http://192.168.1.50:8080";
        Api api(s, presence, cfg);

        int status = 0;
        auto d = call(api, "POST", "/api/ops",
                      "{\"ops\":[" + ann("P:1") + "," + ann("P:2") + ",{\"id\":\"bad\"}," + ann("P:3", "secret", "private") + "]}", &status);
        CHECK(status == 200);
        CHECK(d["added"] == 2);
        CHECK(d["keep"].size() == 2);  // the invalid one and the private one stay with the phone
        CHECK(d["keep"][0] == "bad" && d["keep"][1] == "P:3");
        CHECK(d["node"]["role"] == "droppoint" && d["node"]["id"] == "drop-1");
        CHECK(d["cursor"] == "drop-1.2");
        d = call(api, "POST", "/api/ops", "{\"ops\":[" + ann("P:2") + "]}");  // a lost reply: the phone sends it again
        CHECK(d["duplicates"] == 1 && d["keep"].size() == 0);
        CHECK(s.count(Store::PHONE) == 2 && s.waiting() == 2);

        // phones' ops are not handed back (write-only inbox), and presence comes with the poll
        d = call(api, "GET", "/api/ops?after=&user=phone-A&viewing=steward%3A1");
        CHECK(d["ops"].size() == 0);
        CHECK(d["presence"]["online"][0]["user"] == "phone-A");
        CHECK(d["presence"]["online"][0]["viewing"] == "steward:1");
        CHECK(d["presence"]["showing"].isNull());

        // the library's ops arrive by radio and are handed out
        std::string z1 = ann("lib:1"), p1 = ann("P:1");
        CHECK(s.add(Store::ARCHIVE, "lib:1", z1.c_str(), z1.size()) == Store::ADDED);
        CHECK(s.add(Store::ARCHIVE, "lib:1", z1.c_str(), z1.size()) == Store::DUPLICATE);
        CHECK(s.add(Store::ARCHIVE, "P:1", p1.c_str(), p1.size()) == Store::ADDED);  // P:1 reached the library
        d = call(api, "GET", "/api/ops?after=lib.57%2Cdrop-1.2&user=phone-A&viewing=");
        CHECK(d["ops"].size() == 2 && d["ops"][0]["id"] == "lib:1" && d["ops"][1]["id"] == "P:1");
        CHECK(d["cursor"] == "drop-1.4");
        d = call(api, "GET", "/api/ops?after=drop-1.4");
        CHECK(d["ops"].size() == 0 && d["cursor"] == "drop-1.4");
        d = call(api, "GET", "/api/ops?after=drop-1.99");  // from an earlier log on this board: from the start
        CHECK(d["ops"].size() == 2);
        d = call(api, "GET", "/api/ops?after=drop-10.1,57");  // another node's cursor, an old-style one
        CHECK(d["ops"].size() == 2);

        // a long return path is handed out a page at a time
        cfg.maxOpsPerReply = 1;
        Api paged(s, presence, cfg);
        d = call(paged, "GET", "/api/ops?after=");
        CHECK(d["ops"].size() == 1 && d["cursor"] == "drop-1.3");
        d = call(paged, "GET", "/api/ops?after=drop-1.3");
        CHECK(d["ops"].size() == 1 && d["ops"][0]["id"] == "P:1" && d["cursor"] == "drop-1.4");

        // what only the library does
        call(api, "POST", "/api/media", "{}", &status);
        CHECK(status == 507);
        CHECK(call(api, "POST", "/api/media", "{}")["noMedia"] == true);
        call(api, "POST", "/api/pair", "{}", &status);
        CHECK(status == 503);
        call(api, "POST", "/api/ops", "not json", &status);
        CHECK(status == 400);
        call(api, "GET", "/api/nothing", "", &status);
        CHECK(status == 404);
        CHECK(call(api, "GET", "/index.html")["handled"] == false);
        d = call(api, "GET", "/api/info");
        CHECK(d["secure"] == false && d["addresses"][0] == "http://192.168.1.50:8080");
        CHECK(call(api, "GET", "/api/health")["ok"] == true);

        // forwarding queue, in order
        uint32_t seq;
        std::string json;
        CHECK(s.peekForward(&seq, &json) && seq == 1 && json.find("\"P:1\"") != std::string::npos);
        s.forwarded(1);
        CHECK(s.peekForward(&seq, &json) && seq == 2 && json.find("\"P:2\"") != std::string::npos);
    }

    // ---- presence: forgotten after the window, one entry per device, bounded ----
    {
        Presence p;
        p.hello("a", "", 0);
        p.hello("a", "x", 5000);
        p.hello("b", "", 6000);
        CHECK(p.count(6000) == 2);
        CHECK(p.count(15001) == 1);  // a was last seen at 5000
        CHECK(p.count(16001) == 0);
        for (int i = 0; i < 100; i++) p.hello("d" + std::to_string(i), "", 20000 + i);
        CHECK(p.count(20100) == Presence::MAX);
    }

    // ---- restart: everything rebuilt from flash, forward position kept ----
    {
        FILE* f = fopen((dir + "/ops.log").c_str(), "a");  // a power cut in the middle of a write
        fputs("5\tp\tP:9\t{\"id\":\"P:9\",\"ty", f);
        fclose(f);

        Store s;
        CHECK(s.begin(dir.c_str(), 1 << 20));
        CHECK(s.lastSeq() == 4);
        CHECK(s.count(Store::PHONE) == 2 && s.count(Store::ARCHIVE) == 2);
        CHECK(s.waiting() == 1);
        uint32_t seq;
        std::string json;
        CHECK(s.peekForward(&seq, &json) && seq == 2);
        CHECK(s.add(Store::PHONE, "P:2", json.c_str(), json.size()) == Store::DUPLICATE);
        std::string p3 = ann("P:3");
        CHECK(s.add(Store::PHONE, "P:3", p3.c_str(), p3.size()) == Store::ADDED);
        s.forwarded(2);
        CHECK(s.peekForward(&seq, &json) && seq == 5);
        CHECK(s.add(Store::PHONE, "P:4", "{\"a\":\n1}", 8) == Store::FAILED);  // newlines would break the log
    }

    // ---- flash cap: the drop point leaves ops with the phone instead of filling up ----
    {
        std::string d2 = newDir();
        Store s;
        CHECK(s.begin(d2.c_str(), 450));
        Presence presence;
        ApiConfig cfg;
        Api api(s, presence, cfg);
        auto d = call(api, "POST", "/api/ops", "{\"ops\":[" + ann("Q:1") + "," + ann("Q:2") + "," + ann("Q:3") + "]}");
        CHECK(d["added"] == 2 && d["keep"].size() == 1 && d["keep"][0] == "Q:3");
    }

    // ---- too big for the radio, and the spam guard: left with the phone ----
    {
        std::string d3 = newDir();
        Store s;
        CHECK(s.begin(d3.c_str(), 1 << 20));
        Presence presence;
        ApiConfig cfg;
        cfg.maxOpBytes = 300;
        static int seen = 0;
        cfg.allow = [](void*, const char*) { return ++seen <= 2; };
        Api api(s, presence, cfg);
        std::string big(250, 'x');
        auto d = call(api, "POST", "/api/ops",
                      "{\"ops\":[" + ann("R:1") + "," + ann("R:2", big.c_str()) + "," + ann("R:3") + "," + ann("R:4") + "]}");
        CHECK(d["added"] == 2);
        CHECK(d["keep"].size() == 2 && d["keep"][0] == "R:2" && d["keep"][1] == "R:4");
    }

    // ---- query strings ----
    CHECK(queryParam("after=a.1%2Cb.2&user=x+y", "after") == "a.1,b.2");
    CHECK(queryParam("after=a.1%2Cb.2&user=x+y", "user") == "x y");
    CHECK(queryParam("user=x&username=y", "username") == "y");
    CHECK(queryParam("user=%", "user") == "%");
    CHECK(queryParam("", "user") == "");

    printf("%s node tests\n", failures ? "FAIL" : "PASS");
    return failures ? 1 : 0;
}
