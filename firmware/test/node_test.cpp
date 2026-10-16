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

#include "../lib/osl_link/src/osl_kinds.h"
#include "../lib/osl_node/src/osl_api.h"
#include "../lib/osl_node/src/osl_crypto.h"
#include "../lib/osl_node/src/osl_libraries.h"
#include "../lib/osl_node/src/osl_ops.h"
#include "../lib/osl_node/src/osl_status.h"
#include "../lib/osl_node/src/osl_store.h"

using namespace osl;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

struct StrReply : Reply {
    int status = 0;
    std::string type, s, cookie;
    void header(const char* name, const std::string& value) override { if (!strcmp(name, "Set-Cookie")) cookie = value; }
    void begin(int st, const char* t) override { status = st; type = t; }
    void write(const char* p, size_t n) override { s.append(p, n); }
};

// tokens for the tests: not random, just different
static void fakeRandom(uint8_t* out, size_t n) {
    static uint8_t next = 1;
    for (size_t i = 0; i < n; i++) out[i] = next++;
}

static std::string ann(const char* id, const char* body = "hi", const char* access = "public") {
    std::string user(id, strrchr(id, ':') - id);
    return std::string("{\"id\":\"") + id + "\",\"type\":\"annotation\",\"user\":\"" + user +
           "\",\"timestamp\":\"2026-10-04T14:22:05.000Z\",\"target\":\"steward:1\",\"body\":\"" + body + "\",\"access\":\"" +
           access + "\"}";
}

// One request through the API, with the reply parsed.
static std::string lastCookie;   // the Set-Cookie of the last call, if any

static JsonDocument call(Api& api, const char* method, const std::string& pathAndQuery, const std::string& body = "",
                         int* status = nullptr, uint32_t now = 1000, const std::string& cookie = "") {
    Request r;
    r.method = method;
    r.cookie = cookie;
    size_t q = pathAndQuery.find('?');
    r.path = pathAndQuery.substr(0, q);
    if (q != std::string::npos) r.query = pathAndQuery.substr(q + 1);
    r.body = body.data();
    r.bodyLen = body.size();
    StrReply out;
    bool handled = api.handle(r, now, out);
    lastCookie = out.cookie;
    JsonDocument d;
    if (!handled) { d["handled"] = false; return d; }
    if (status) *status = out.status;
    CHECK(out.type == "application/json");
    DeserializationError e = deserializeJson(d, out.s);
    if (e) printf("  not JSON: %s\n", out.s.c_str());
    CHECK(!e);
    return d;
}

static bool fileExists(const std::string& path) {
    FILE* f = fopen(path.c_str(), "r");
    if (f) fclose(f);
    return f != nullptr;
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
        Libraries libs;
        CHECK(libs.begin(dir.c_str(), 1 << 20, fakeRandom));
        Store& s = libs.main().store;
        ApiConfig cfg;
        cfg.nodeId = "drop-1";
        cfg.address = "http://192.168.1.50:8080";
        Api api(libs, cfg);

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
        Api paged(libs, cfg);
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
        Libraries libs;
        CHECK(libs.begin(d2.c_str(), 450, fakeRandom));
        ApiConfig cfg;
        Api api(libs, cfg);
        auto d = call(api, "POST", "/api/ops", "{\"ops\":[" + ann("Q:1") + "," + ann("Q:2") + "," + ann("Q:3") + "]}");
        CHECK(d["added"] == 2 && d["keep"].size() == 1 && d["keep"][0] == "Q:3");
    }

    // ---- too big for the radio, and the spam guard: left with the phone ----
    {
        std::string d3 = newDir();
        Libraries libs;
        CHECK(libs.begin(d3.c_str(), 1 << 20, fakeRandom));
        ApiConfig cfg;
        cfg.maxOpBytes = 300;
        static int seen = 0;
        cfg.allow = [](void*, const char*) { return ++seen <= 2; };
        Api api(libs, cfg);
        std::string big(250, 'x');
        auto d = call(api, "POST", "/api/ops",
                      "{\"ops\":[" + ann("R:1") + "," + ann("R:2", big.c_str()) + "," + ann("R:3") + "," + ann("R:4") + "]}");
        CHECK(d["added"] == 2);
        CHECK(d["keep"].size() == 2 && d["keep"][0] == "R:2" && d["keep"][1] == "R:4");
    }

    // ---- the heartbeat: one radio fragment, readable JSON ----
    {
        DropStatus st;
        st.id = "drop-a1b2c3";
        st.name = "Community garden \"annex\"";
        st.app = "a4092bd8ec7f";
        st.every = 120;
        st.up = 86400;
        st.waiting = 3;
        st.ops = 1200;
        st.flashFree = 812000;
        st.phones = 2;
        st.heard = true;
        st.rssi = -97.54f;
        st.snr = 6.25f;
        std::string m = statusMessage(st);
        CHECK(m.size() + 1 <= 200);  // with the kind byte, one fragment
        JsonDocument d;
        CHECK(!deserializeJson(d, m));
        CHECK(d["id"] == "drop-a1b2c3" && d["name"] == "Community garden \"annex\"" && d["every"] == 120);
        CHECK(d["waiting"] == 3 && d["phones"] == 2 && d["app"] == "a4092bd8ec7f");
        CHECK(d["rssi"].as<float>() > -97.6f && d["rssi"].as<float>() < -97.4f);
        st.heard = false;
        JsonDocument quiet;
        deserializeJson(quiet, statusMessage(st));
        CHECK(quiet["rssi"].isNull());  // nothing heard yet: no made-up signal

        const char* sw = "(()=>{var e=`osl-shell-a4092bd8ec7f`,s=[\"./\"]";
        CHECK(appVersionIn(sw, strlen(sw)) == "a4092bd8ec7f");
        CHECK(appVersionIn("no version here", 15) == "");
    }

    // ---- a library's password, checked as the library made it (core/fixtures/library-passwords.json) ----
    {
        Sha256 h;
        h.update((const uint8_t*)"abc", 3);
        uint8_t out[32];
        h.finish(out);
        CHECK(out[0] == 0xba && out[1] == 0x78 && out[31] == 0xad);   // FIPS 180-2's "abc"
        std::ifstream f("../../core/fixtures/library-passwords.json");
        std::stringstream text;
        text << f.rdbuf();
        JsonDocument cases;
        CHECK(!deserializeJson(cases, text.str()));
        CHECK(cases.size() >= 8);
        for (JsonObjectConst c : cases.as<JsonArrayConst>()) {
            bool got = verifyLibraryPassword(c["hash"].as<std::string>(), c["password"].as<std::string>());
            if (got != c["valid"].as<bool>()) printf("  password case \"%s\": got %d\n", c["case"].as<const char*>(), got);
            CHECK(got == c["valid"].as<bool>());
        }
    }

    // ---- libraries: the list from the library, a password per library, a log each ----
    {
        std::ifstream f("../../core/fixtures/library-passwords.json");
        std::stringstream text;
        text << f.rdbuf();
        JsonDocument cases;
        deserializeJson(cases, text.str());
        std::string poems = cases[0]["hash"].as<std::string>();   // "poems", 1000 iterations

        std::string d4 = newDir();
        Libraries libs;
        CHECK(libs.begin(d4.c_str(), 1 << 20, fakeRandom));
        ApiConfig cfg;
        cfg.nodeId = "drop-4";
        Api api(libs, cfg);
        auto fromLibrary = [&](uint8_t kind, const std::string& body) {
            std::string m(1, (char)kind);
            m += body;
            return libs.fromLibrary((const uint8_t*)m.data(), m.size());
        };
        int status = 0;

        // before the list: only main; another library's paths are unknown here
        call(api, "GET", "/api/l/poetry/ops?after=", "", &status);
        CHECK(status == 404);

        CHECK(fromLibrary(KIND_LIBS, "{\"libs\":[{\"id\":\"main\",\"name\":\"Maroon library\",\"hash\":\"\"},"
                                     "{\"id\":\"poetry\",\"name\":\"Poetry club\",\"hash\":\"" + poems + "\"},"
                                     "{\"id\":\"zines\",\"name\":\"Zines\",\"hash\":\"\"}]}"));
        CHECK(libs.listed().size() == 3 && libs.main().name == "Maroon library");
        call(api, "GET", "/api/l/zines/ops?after=", "", &status);
        CHECK(status == 200);
        auto d = call(api, "GET", "/api/l/poetry/ops?after=", "", &status);
        CHECK(status == 401 && d["locked"] == true && d["library"]["name"] == "Poetry club");
        d = call(api, "GET", "/api/l/poetry/directory");
        CHECK(d["droppoint"] == true && d["library"]["locked"] == true && d["library"]["protected"] == true);
        CHECK(d["libraries"].size() == 3 && d["libraries"][1]["open"] == false && d["me"].isNull());
        call(api, "POST", "/api/l/poetry/ops", "{\"ops\":[" + ann("G:1") + "]}", &status);
        CHECK(status == 401);   // shut both ways

        // the password opens it for this browser only
        call(api, "POST", "/api/l/poetry/unlock", "{\"password\":\"poem\"}", &status);
        CHECK(status == 403 && lastCookie.empty());
        call(api, "POST", "/api/l/poetry/unlock", "{\"password\":\"poems\"}", &status);
        CHECK(status == 200 && lastCookie.compare(0, 5, "osld=") == 0 && lastCookie.find("HttpOnly") != std::string::npos);
        std::string cookie = "other=1; " + lastCookie.substr(0, lastCookie.find(';'));
        d = call(api, "GET", "/api/l/poetry/directory", "", nullptr, 1000, cookie);
        CHECK(d["library"]["locked"] == false);
        call(api, "GET", "/api/l/poetry/ops?after=", "", &status, 1000, cookie);
        CHECK(status == 200);
        call(api, "GET", "/api/l/poetry/ops?after=", "", &status, 1000, "osld=someoneelse");
        CHECK(status == 401);

        // its ops: from the library by radio, from phones to the library, never mixed with main's
        std::string lib1 = ann("lib:7", "a poem");
        CHECK(fromLibrary(KIND_LIB_OP, "poetry\n" + lib1));
        CHECK(fromLibrary(KIND_OP, ann("lib:8", "for main")));
        d = call(api, "GET", "/api/l/poetry/ops?after=", "", nullptr, 1000, cookie);
        CHECK(d["ops"].size() == 1 && d["ops"][0]["id"] == "lib:7");
        d = call(api, "GET", "/api/ops?after=");
        CHECK(d["ops"].size() == 1 && d["ops"][0]["id"] == "lib:8");
        d = call(api, "POST", "/api/l/poetry/ops", "{\"ops\":[" + ann("G:1") + "]}", &status, 1000, cookie);
        CHECK(status == 200 && d["added"] == 1);
        call(api, "POST", "/api/ops", "{\"ops\":[" + ann("G:2") + "]}");
        std::string msg, which;
        uint32_t seq;
        std::vector<std::string> sent;
        while (libs.nextForward(&msg, &which, &seq)) {
            sent.push_back(which + " " + std::to_string((int)msg[0]) + " " + msg.substr(1, msg.find('{') - 1));
            libs.forwarded(which, seq);
        }
        CHECK(sent.size() == 2);
        CHECK(sent.size() == 2 && (sent[0] == "main 1 " || sent[1] == "main 1 "));
        CHECK(sent.size() == 2 && (sent[0] == "poetry 3 poetry\n" || sent[1] == "poetry 3 poetry\n"));

        // too many wrong passwords: wait a minute
        for (int i = 0; i < 5; i++) call(api, "POST", "/api/l/poetry/unlock", "{\"password\":\"x\"}", nullptr, 2000);
        call(api, "POST", "/api/l/poetry/unlock", "{\"password\":\"poems\"}", &status, 3000);
        CHECK(status == 429);
        call(api, "POST", "/api/l/poetry/unlock", "{\"password\":\"poems\"}", &status, 70000);
        CHECK(status == 200);

        // shut again on this browser
        call(api, "POST", "/api/l/poetry/lock", "{}", nullptr, 70000, cookie);
        call(api, "GET", "/api/l/poetry/ops?after=", "", &status, 70000, cookie);
        CHECK(status == 401);

        // a library's op before its list: kept, but shut to everyone until the list says how to open it
        CHECK(fromLibrary(KIND_LIB_OP, "secret\n" + ann("lib:9")));
        call(api, "GET", "/api/l/secret/ops?after=", "", &status);
        CHECK(status == 401);
        call(api, "POST", "/api/l/secret/unlock", "{\"password\":\"\"}", &status);
        CHECK(status == 403);

        // a new password closes it on every browser that had the old one
        call(api, "POST", "/api/l/poetry/unlock", "{\"password\":\"poems\"}", nullptr, 70000, cookie);
        call(api, "GET", "/api/l/poetry/ops?after=", "", &status, 70000, cookie);
        CHECK(status == 200);
        std::string other = cases[4]["hash"].as<std::string>();   // "poems" again, with another salt
        CHECK(fromLibrary(KIND_LIBS, "{\"libs\":[{\"id\":\"main\",\"name\":\"Maroon library\",\"hash\":\"\"},"
                                     "{\"id\":\"poetry\",\"name\":\"Poetry club\",\"hash\":\"" + other + "\"},"
                                     "{\"id\":\"zines\",\"name\":\"Zines\",\"hash\":\"\"}]}"));
        call(api, "GET", "/api/l/poetry/ops?after=", "", &status, 70000, cookie);
        CHECK(status == 401);

        // taken off the list: shut at once; its log erased once nothing in it waits to go
        call(api, "POST", "/api/l/zines/ops", "{\"ops\":[" + ann("Z:1") + "]}");
        CHECK(fromLibrary(KIND_LIBS, "{\"libs\":[{\"id\":\"main\",\"hash\":\"\"},{\"id\":\"poetry\",\"name\":\"Poetry club\",\"hash\":\"" + other + "\"}]}"));
        call(api, "GET", "/api/l/zines/ops?after=", "", &status);
        CHECK(status == 404);
        CHECK(fileExists(d4 + "/l/zines/ops.log"));
        CHECK(libs.nextForward(&msg, &which, &seq) && which == "zines");
        libs.forwarded(which, seq);
        CHECK(!fileExists(d4 + "/l/zines/ops.log"));
        CHECK(!libs.nextForward(&msg, &which, &seq));

        // a restart carries the same libraries, with their passwords and their logs
        Libraries again;
        CHECK(again.begin(d4.c_str(), 1 << 20, fakeRandom));
        CHECK(again.find("poetry") && again.find("poetry")->hash == other && again.find("poetry")->store.count(Store::ARCHIVE) == 1);
        CHECK(!again.find("zines"));
        CHECK(again.main().store.count(Store::ARCHIVE) == 1);
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
