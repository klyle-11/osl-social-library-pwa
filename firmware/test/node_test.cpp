// Desktop tests for the drop point's op log and /sync handling.
//   sh firmware/test/run.sh
#include <ArduinoJson.h>

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "../lib/osl_node/src/osl_store.h"
#include "../lib/osl_node/src/osl_sync.h"

using namespace osl;

struct StrWriter : Writer {
    std::string s;
    void write(const char* p, size_t n) override { s.append(p, n); }
};

static int failures = 0;
#define CHECK(c) do { if (!(c)) { printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

static std::string op(const char* id, const char* type = "comment", const char* extra = "\"target\":\"seed:1\",\"body\":\"hi\",\"access\":\"public\"") {
    std::string author(id, strchr(id, ':') - id);
    return std::string("{\"id\":\"") + id + "\",\"type\":\"" + type + "\",\"author\":\"" + author +
           "\",\"created\":\"2026-10-04T14:22:05.000Z\"," + extra + "}";
}

static JsonDocument reply(Store& s, const std::string& body, SyncOptions o = SyncOptions()) {
    SyncResult r;
    int status = applySync(s, body.data(), body.size(), o, &r);
    JsonDocument d;
    if (status != 200) { d["status"] = status; return d; }
    StrWriter w;
    writeSyncReply(s, o, r, w);
    DeserializationError e = deserializeJson(d, w.s);
    CHECK(!e);  // reply is valid JSON
    return d;
}

int main() {
    char tmpl[] = "/tmp/osl-node-XXXXXX";
    std::string dir = mkdtemp(tmpl);

    // validation mirrors src/contract.js
    {
        auto v = [](const std::string& j) { JsonDocument d; deserializeJson(d, j); return validateOp(d.as<JsonObjectConst>()); };
        CHECK(!v(op("A:1")));
        CHECK(!v(op("A:2", "item", "\"url\":\"https://x\",\"properties\":{\"title\":\"T\"}")));
        CHECK(!v(op("A:3", "name-collection", "\"target\":\"A/x\",\"name\":\"X\"")));
        CHECK(v(op("A:x")));                                        // counter must be digits
        CHECK(v(op("A:4", "comment", "\"target\":\"x\",\"body\":\"\",\"access\":\"public\"")));
        CHECK(v(op("A:5", "comment", "\"target\":\"x\",\"body\":\"b\",\"access\":\"secret\"")));
        CHECK(v(op("A:6", "item", "\"properties\":{\"title\":\"T\"}")));  // needs url or hash
        CHECK(v(op("A:7", "delete", "\"target\":\"x\"")));
        CHECK(v("{\"id\":\"A:8\",\"type\":\"hide\",\"author\":\"A\",\"created\":\"yesterday\",\"target\":\"x\"}"));
    }

    // phones hand in ops: stored once, not shown back to phones (write-only inbox)
    {
        Store s;
        CHECK(s.begin(dir.c_str(), 1 << 20));
        SyncOptions o;
        o.nodeId = "drop-1";
        auto d = reply(s, "{\"ops\":[" + op("P:1") + "," + op("P:2") + ",{\"id\":\"bad\"}],\"cursors\":{}}", o);
        CHECK(d["acked"].size() == 2);
        CHECK(d["rejected"].size() == 1);
        CHECK(d["ops"].size() == 0);
        CHECK(d["node"] == "drop-1");
        CHECK(d["cursor"] == 2);
        d = reply(s, "{\"ops\":[" + op("P:2") + "]}", o);  // lost reply, phone resends
        CHECK(d["acked"].size() == 1);
        CHECK(s.count(Store::PHONE) == 2);
        CHECK(s.waiting() == 2);

        // the archive sends moderated ops back over the radio
        CHECK(s.add(Store::ARCHIVE, "Z:1", op("Z:1").c_str(), op("Z:1").size()) == Store::ADDED);
        CHECK(s.add(Store::ARCHIVE, "Z:1", op("Z:1").c_str(), op("Z:1").size()) == Store::DUPLICATE);
        CHECK(s.add(Store::ARCHIVE, "P:1", op("P:1").c_str(), op("P:1").size()) == Store::ADDED);  // approved copy
        d = reply(s, "{\"ops\":[],\"cursors\":{\"drop-1\":2,\"archive\":900}}", o);
        CHECK(d["ops"].size() == 2);
        CHECK(d["ops"][0]["id"] == "Z:1");
        CHECK(d["cursor"] == 4);
        d = reply(s, "{\"ops\":[],\"cursors\":{\"drop-1\":4}}", o);
        CHECK(d["ops"].size() == 0);
        d = reply(s, "{\"ops\":[],\"since\":4}", o);  // old clients: no cursor for this node -> everything
        CHECK(d["ops"].size() == 2);
        o.shareLocal = true;
        d = reply(s, "{\"ops\":[]}", o);
        CHECK(d["ops"].size() == 4);
        CHECK(reply(s, "not json", o)["status"] == 400);

        // forwarding queue, in order
        uint32_t seq;
        std::string json;
        CHECK(s.peekForward(&seq, &json) && seq == 1 && json.find("\"P:1\"") != std::string::npos);
        s.forwarded(1);
        CHECK(s.peekForward(&seq, &json) && seq == 2 && json.find("\"P:2\"") != std::string::npos);
    }

    // restart: everything rebuilt from flash, forward position kept
    {
        // simulate a power cut in the middle of a write
        FILE* f = fopen((dir + "/ops.log").c_str(), "a");
        fputs("5\tp\tP:9\t{\"id\":\"P:9\",\"ty", f);  // no crc, no newline
        fclose(f);

        Store s;
        CHECK(s.begin(dir.c_str(), 1 << 20));
        CHECK(s.lastSeq() == 4);
        CHECK(s.count(Store::PHONE) == 2 && s.count(Store::ARCHIVE) == 2);
        CHECK(s.waiting() == 1);
        uint32_t seq;
        std::string json;
        CHECK(s.peekForward(&seq, &json) && seq == 2);
        JsonDocument d;
        CHECK(!deserializeJson(d, json) && d["id"] == "P:2");
        CHECK(s.add(Store::PHONE, "P:2", json.c_str(), json.size()) == Store::DUPLICATE);
        CHECK(s.add(Store::PHONE, "P:3", op("P:3").c_str(), op("P:3").size()) == Store::ADDED);
        s.forwarded(2);
        CHECK(s.peekForward(&seq, &json) && seq == 5);
        CHECK(s.add(Store::PHONE, "P:4", "{\"a\":\n1}", 8) == Store::FAILED);  // newlines would break the log
    }
    {
        Store s;  // the torn line is skipped, the next line is intact
        CHECK(s.begin(dir.c_str(), 1 << 20));
        CHECK(s.lastSeq() == 5 && s.waiting() == 1);
        SyncOptions o;
        auto d = reply(s, "{\"ops\":[],\"cursors\":{}}", o);
        CHECK(d["ops"].size() == 2);
    }

    // storage cap: refuse instead of filling flash; the phone keeps its op
    {
        char t2[] = "/tmp/osl-node-XXXXXX";
        Store s;
        CHECK(s.begin(mkdtemp(t2), 400));
        auto d = reply(s, "{\"ops\":[" + op("Q:1") + "," + op("Q:2") + "," + op("Q:3") + "]}");
        CHECK(d["acked"].size() == 2);
    }

    // spam guard
    {
        char t3[] = "/tmp/osl-node-XXXXXX";
        Store s;
        CHECK(s.begin(mkdtemp(t3), 1 << 20));
        SyncOptions o;
        static int seen = 0;
        o.allow = [](void*, const char*) { return ++seen <= 2; };
        auto d = reply(s, "{\"ops\":[" + op("R:1") + "," + op("R:2") + "," + op("R:3") + "]}", o);
        CHECK(d["acked"].size() == 2 && d["rejected"][0]["error"] == "rate limited");
    }

    printf("%s node tests\n", failures ? "FAIL" : "PASS");
    return failures ? 1 : 0;
}
