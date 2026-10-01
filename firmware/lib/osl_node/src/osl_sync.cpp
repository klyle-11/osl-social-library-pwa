#include "osl_sync.h"

#include <string.h>

namespace osl {

void Writer::write(const char* s) { write(s, strlen(s)); }

static bool isStr(JsonVariantConst v) { return v.is<const char*>(); }

static bool isIsoDate(const char* s) {
    // YYYY-MM-DDTHH:MM ... (what Date.toISOString() produces)
    static const char* shape = "dddd-dd-ddTdd:dd";
    if (!s || strlen(s) < 16) return false;
    for (int i = 0; shape[i]; i++) {
        if (shape[i] == 'd' ? (s[i] < '0' || s[i] > '9') : s[i] != shape[i]) return false;
    }
    return true;
}

static bool isOpId(const char* s) {
    // <device>:<counter>  (mirrors /^[^:]+:\d+$/)
    if (!s) return false;
    const char* colon = strchr(s, ':');
    if (!colon || colon == s || !colon[1]) return false;
    for (const char* p = colon + 1; *p; p++)
        if (*p < '0' || *p > '9') return false;
    return true;
}

const char* validateOp(JsonObjectConst op) {
    if (op.isNull()) return "not an object";
    if (!isOpId(op["id"])) return "bad id";
    const char* type = op["type"];
    if (!type) return "bad type";
    const char* author = op["author"];
    if (!author || !*author) return "bad author";
    if (!isIsoDate(op["created"])) return "bad created";
    if (!strcmp(type, "item")) {
        if (!isStr(op["properties"]["title"])) return "item needs properties.title";
        if (!isStr(op["url"]) && !isStr(op["hash"])) return "item needs url or hash";
        return nullptr;
    }
    if (!strcmp(type, "comment")) {
        if (!isStr(op["target"])) return "comment needs target";
        const char* body = op["body"];
        if (!body || !*body) return "comment needs body";
        const char* access = op["access"];
        if (!access || (strcmp(access, "public") && strcmp(access, "private") && strcmp(access, "anonymous"))) return "bad access";
        return nullptr;
    }
    if (!strcmp(type, "add-to-collection")) {
        if (!isStr(op["target"]) || !isStr(op["item"])) return "needs target and item";
        return nullptr;
    }
    if (!strcmp(type, "name-collection")) {
        if (!isStr(op["target"]) || !isStr(op["name"])) return "needs target and name";
        return nullptr;
    }
    if (!strcmp(type, "hide")) {
        if (!isStr(op["target"])) return "hide needs target";
        return nullptr;
    }
    return "bad type";
}

int applySync(Store& store, const char* body, size_t len, const SyncOptions& opt, SyncResult* out) {
    JsonDocument doc;
    if (deserializeJson(doc, body, len) || !doc.is<JsonObject>()) return 400;

    // Cursors are per node: a phone's cursor for the archive means nothing here.
    out->since = doc["cursors"][opt.nodeId] | 0u;

    std::string json;
    for (JsonObjectConst op : doc["ops"].as<JsonArrayConst>()) {
        const char* id = op["id"] | "";
        const char* err = validateOp(op);
        if (!err && measureJson(op) > MAX_OP_BYTES) err = "too large";
        if (!err && opt.allow && !opt.allow(opt.allowCtx, op["author"])) err = "rate limited";
        if (err) {
            out->rejected.push_back({id, err});
            continue;
        }
        json.clear();
        serializeJson(op, json);
        Store::Result r = store.add(Store::PHONE, id, json.data(), json.size());
        if (r == Store::ADDED || r == Store::DUPLICATE) out->acked.push_back(id);
        // FULL / FAILED: not acked, so the phone keeps it in its outbox and tries again later.
    }
    out->cursor = store.lastSeq();
    return 200;
}

static void writeJsonString(Writer& w, const std::string& s) {
    JsonDocument d;
    d.set(s.c_str());
    std::string q;
    serializeJson(d, q);
    w.write(q.data(), q.size());
}

struct OpsCtx {
    Writer* w;
    bool first;
};
static void writeOp(void* ctx, const char* json, size_t len) {
    OpsCtx* c = (OpsCtx*)ctx;
    if (!c->first) c->w->write(",", 1);
    c->first = false;
    c->w->write(json, len);
}

void writeSyncReply(Store& store, const SyncOptions& opt, const SyncResult& r, Writer& w) {
    char num[16];
    w.write("{\"node\":");
    writeJsonString(w, opt.nodeId);
    snprintf(num, sizeof num, "%lu", (unsigned long)r.cursor);
    w.write(",\"cursor\":");
    w.write(num);
    w.write(",\"acked\":[");
    for (size_t i = 0; i < r.acked.size(); i++) {
        if (i) w.write(",", 1);
        writeJsonString(w, r.acked[i]);
    }
    w.write("],\"rejected\":[");
    for (size_t i = 0; i < r.rejected.size(); i++) {
        if (i) w.write(",", 1);
        w.write("{\"id\":");
        writeJsonString(w, r.rejected[i].first);
        w.write(",\"error\":");
        writeJsonString(w, r.rejected[i].second);
        w.write("}");
    }
    w.write("],\"ops\":[");
    OpsCtx ctx{&w, true};
    store.forEach(r.since, r.cursor, opt.shareLocal, writeOp, &ctx);
    w.write("]}");
}

}  // namespace osl
