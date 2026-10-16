#include "osl_api.h"

#include <ArduinoJson.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>

#include "osl_libraries.h"
#include "osl_ops.h"

namespace osl {

void Writer::write(const char* s) { write(s, strlen(s)); }

void writeJsonString(Writer& w, const char* s, size_t n) {
    static const char* hex = "0123456789abcdef";
    w.write("\"", 1);
    size_t from = 0;
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c >= 0x20 && c != '"' && c != '\\') continue;
        if (i > from) w.write(s + from, i - from);
        char esc[7] = {'\\', (char)c, 0};
        if (c < 0x20) {
            esc[1] = 'u'; esc[2] = '0'; esc[3] = '0'; esc[4] = hex[c >> 4]; esc[5] = hex[c & 15]; esc[6] = 0;
        }
        w.write(esc);
        from = i + 1;
    }
    if (n > from) w.write(s + from, n - from);
    w.write("\"", 1);
}

void writeJsonString(Writer& w, const std::string& s) { writeJsonString(w, s.data(), s.size()); }

static int hexValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

std::string queryParam(const std::string& query, const char* name) {
    size_t nlen = strlen(name), i = 0;
    while (i <= query.size()) {
        size_t end = query.find('&', i);
        if (end == std::string::npos) end = query.size();
        if (end - i > nlen && query.compare(i, nlen, name) == 0 && query[i + nlen] == '=') {
            std::string out;
            for (size_t j = i + nlen + 1; j < end; j++) {
                char c = query[j];
                int a, b;
                if (c == '+') out += ' ';
                else if (c == '%' && j + 2 < end && (a = hexValue(query[j + 1])) >= 0 && (b = hexValue(query[j + 2])) >= 0) {
                    out += (char)(a * 16 + b);
                    j += 2;
                } else out += c;
            }
            return out;
        }
        i = end + 1;
    }
    return "";
}

// ---- presence ----

void Presence::forget(uint32_t now) {
    entries_.erase(std::remove_if(entries_.begin(), entries_.end(), [&](const Entry& e) { return now - e.seen > WINDOW_MS; }),
                   entries_.end());
}

void Presence::hello(const std::string& user, const std::string& viewing, uint32_t now) {
    if (user.empty()) return;
    std::string u = user.substr(0, 64), v = viewing.substr(0, 200);
    for (Entry& e : entries_) {
        if (e.user == u) {
            e.viewing = v;
            e.seen = now;
            return;
        }
    }
    forget(now);
    if (entries_.size() >= MAX) {  // full: the one seen longest ago makes room
        auto oldest = std::min_element(entries_.begin(), entries_.end(), [&](const Entry& a, const Entry& b) {
            return now - a.seen > now - b.seen;
        });
        entries_.erase(oldest);
    }
    entries_.push_back({u, v, now});
}

size_t Presence::count(uint32_t now) {
    forget(now);
    return entries_.size();
}

void Presence::write(Writer& w, uint32_t now) {
    forget(now);
    std::vector<const Entry*> sorted;
    for (const Entry& e : entries_) sorted.push_back(&e);
    std::sort(sorted.begin(), sorted.end(), [](const Entry* a, const Entry* b) { return a->user < b->user; });
    w.write("{\"online\":[");
    for (size_t i = 0; i < sorted.size(); i++) {
        if (i) w.write(",");
        w.write("{\"user\":");
        writeJsonString(w, sorted[i]->user);
        w.write(",\"viewing\":");
        writeJsonString(w, sorted[i]->viewing);
        w.write("}");
    }
    w.write("],\"showing\":null}");  // the big screen is at the library
}

// ---- the API ----

static void error(Reply& out, int status, const char* message, const char* extra = nullptr) {
    out.begin(status, "application/json");
    out.write("{\"error\":");
    writeJsonString(out, message, strlen(message));
    if (extra) out.write(extra);
    out.write("}");
}

void Api::writeNode(Writer& w) {
    w.write("{\"id\":");
    writeJsonString(w, cfg_.nodeId, strlen(cfg_.nodeId));
    w.write(",\"role\":\"droppoint\"}");
}

// The position in this drop point's log a phone has read up to, out of every cursor it
// sent ("lib.57,drop-a1b2c3.12"); 0 for none, or for one from an earlier log. As core/cursor.ts.
uint32_t Api::since(const Store& store, const std::string& after) {
    size_t idLen = strlen(cfg_.nodeId), i = 0;
    while (i <= after.size()) {
        size_t end = after.find(',', i);
        if (end == std::string::npos) end = after.size();
        size_t dot = after.rfind('.', end == 0 ? 0 : end - 1);
        if (dot != std::string::npos && dot >= i && dot - i == idLen && after.compare(i, idLen, cfg_.nodeId) == 0 && dot + 1 < end) {
            uint32_t at = 0;
            bool ok = end - dot - 1 <= 9;
            for (size_t j = dot + 1; j < end && ok; j++) {
                if (after[j] < '0' || after[j] > '9') ok = false;
                else at = at * 10 + (after[j] - '0');
            }
            if (ok) return at <= store.lastSeq() ? at : 0;
        }
        i = end + 1;
    }
    return 0;
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

void Api::getOps(Library& l, const Request& req, uint32_t now, Reply& out) {
    std::string user = queryParam(req.query, "user");
    if (!user.empty()) l.presence.hello(user, queryParam(req.query, "viewing"), now);
    uint32_t from = since(l.store, queryParam(req.query, "after"));

    out.begin(200, "application/json");
    out.write("{\"ops\":[");
    OpsCtx ctx{&out, true};
    // only what came from the library; a long list goes out over several polls
    uint32_t upto = l.store.forEach(from, l.store.lastSeq(), false, writeOp, &ctx, cfg_.maxOpsPerReply);
    char cursor[24];
    snprintf(cursor, sizeof cursor, ".%lu", (unsigned long)upto);
    out.write("],\"cursor\":\"");
    out.write(cfg_.nodeId);  // a node id is plain ASCII (see main.cpp)
    out.write(cursor);
    out.write("\",\"presence\":");
    l.presence.write(out, now);
    out.write(",\"node\":");
    writeNode(out);
    out.write("}");
}

void Api::postOps(Library& l, const Request& req, Reply& out) {
    JsonDocument doc;
    if (deserializeJson(doc, req.body, req.bodyLen) || !doc["ops"].is<JsonArrayConst>()) {
        return error(out, 400, "expected { ops: [...] }");
    }
    size_t added = 0, duplicates = 0;
    std::vector<std::string> keep;
    std::string json;
    for (JsonVariantConst v : doc["ops"].as<JsonArrayConst>()) {
        JsonObjectConst op = v.as<JsonObjectConst>();
        const char* id = op["id"].is<const char*>() ? op["id"].as<const char*>() : nullptr;
        if (!id) continue;  // nothing to keep it by; the phone's own check would never have sent it
        // The drop point never decides an op's fate: anything it won't take stays with the
        // phone, and the library (which has the final say) gets it directly.
        bool take = !validateOp(op);
        if (take && op["type"] == "annotation" && op["access"] == "private") take = false;  // never leaves the phone
        if (take) {
            json.clear();
            serializeJson(op, json);
            take = json.size() <= cfg_.maxOpBytes;  // too big for the radio
        }
        if (take && cfg_.allow) take = cfg_.allow(cfg_.allowCtx, op["user"]);
        if (take) take = libraries_.room(json.size() + 64);   // the flash is shared by every library's log
        Store::Result r = take ? l.store.add(Store::PHONE, id, json.data(), json.size()) : Store::FAILED;
        if (r == Store::ADDED) added++;
        else if (r == Store::DUPLICATE) duplicates++;
        else keep.push_back(id);  // FULL, FAILED, or not taken
    }

    char num[96];
    out.begin(200, "application/json");
    snprintf(num, sizeof num, "{\"added\":%u,\"duplicates\":%u,\"conflicts\":0,\"rejected\":[],\"keep\":[", (unsigned)added,
             (unsigned)duplicates);
    out.write(num);
    for (size_t i = 0; i < keep.size(); i++) {
        if (i) out.write(",");
        writeJsonString(out, keep[i]);
    }
    snprintf(num, sizeof num, ".%lu", (unsigned long)l.store.lastSeq());
    out.write("],\"cursor\":\"");
    out.write(cfg_.nodeId);
    out.write(num);
    out.write("\",\"node\":");
    writeNode(out);
    out.write("}");
}

// What the app needs to know here: which libraries this drop point carries, and whether
// this one is open to this browser. Accounts are at the library: nobody is signed in here.
void Api::directory(Library& l, const Request& req, Reply& out) {
    out.begin(200, "application/json");
    out.write("{\"revision\":0,\"droppoint\":true,\"libraries\":[");
    bool first = true;
    for (Library* x : libraries_.listed()) {
        if (!first) out.write(",");
        first = false;
        out.write("{\"id\":");
        writeJsonString(out, x->id);
        out.write(",\"name\":");
        writeJsonString(out, x->name);
        out.write(x->hash.empty() ? ",\"protected\":false" : ",\"protected\":true");
        out.write(libraries_.isOpen(*x, req.cookie) ? ",\"open\":true}" : ",\"open\":false}");
    }
    out.write("],\"me\":null,\"signup\":false,\"setup\":false,\"library\":{\"id\":");
    writeJsonString(out, l.id);
    out.write(",\"name\":");
    writeJsonString(out, l.name);
    out.write(l.hash.empty() ? ",\"protected\":false" : ",\"protected\":true");
    out.write(libraries_.isOpen(l, req.cookie) ? ",\"locked\":false}}" : ",\"locked\":true}}");
}

void Api::unlock(Library& l, const Request& req, uint32_t now, Reply& out) {
    JsonDocument doc;
    if (deserializeJson(doc, req.body, req.bodyLen) || !doc["password"].is<const char*>()) return error(out, 400, "expected { password }");
    std::string cookie;
    switch (libraries_.unlock(l, doc["password"].as<const char*>(), req.cookie, now, &cookie)) {
        case Libraries::OPENED:
            if (!cookie.empty()) out.header("Set-Cookie", cookie);
            out.begin(200, "application/json");
            out.write("{\"ok\":true}");
            return;
        case Libraries::WAIT:
            return error(out, 429, "Too many wrong tries. Wait a minute and try again.");
        default:
            return error(out, 403, l.hash == "?" ? "This drop point hasn't heard how to open this library yet. Try at the library."
                                                 : "That isn't this library's password.");
    }
}

void Api::locked(Reply& out, const Library& l) {
    out.begin(401, "application/json");
    out.write("{\"error\":\"This library is protected. Enter its password.\",\"locked\":true,\"library\":{\"id\":");
    writeJsonString(out, l.id);
    out.write(",\"name\":");
    writeJsonString(out, l.name);
    out.write("},\"node\":");   // so a phone knows it is at a drop point, where accounts don't work
    writeNode(out);
    out.write("}");
}

bool Api::handle(const Request& req, uint32_t now, Reply& out) {
    std::string p = req.path;
    if (p.compare(0, 5, "/api/") != 0) return false;
    bool get = !strcmp(req.method, "GET") || !strcmp(req.method, "HEAD"), post = !strcmp(req.method, "POST");

    // /api/l/<id>/... is another library's; anything else is the main library's
    Library* l = &libraries_.main();
    if (p.compare(0, 7, "/api/l/") == 0) {
        size_t slash = p.find('/', 7);
        if (slash == std::string::npos) return error(out, 404, "not found"), true;
        l = libraries_.find(p.substr(7, slash - 7));
        if (!l) return error(out, 404, "This library isn't carried at this drop point."), true;
        p = "/api" + p.substr(slash);
    }

    if (p == "/api/health" && get) {
        out.begin(200, "application/json");
        out.write("{\"ok\":true,\"node\":");
        writeNode(out);
        out.write("}");
    } else if (p == "/api/info" && get) {
        out.begin(200, "application/json");
        out.write(cfg_.secure ? "{\"secure\":true,\"addresses\":[" : "{\"secure\":false,\"addresses\":[");
        writeJsonString(out, cfg_.address, strlen(cfg_.address));
        out.write("],\"host\":\"\",\"node\":");
        writeNode(out);
        out.write("}");
    } else if (p == "/api/directory" && get) {
        directory(*l, req, out);
    } else if (p == "/api/unlock" && post) {
        unlock(*l, req, now, out);
    } else if (p == "/api/lock" && post) {
        libraries_.lock(*l, req.cookie);
        out.begin(200, "application/json");
        out.write("{\"ok\":true}");
    } else if (p == "/api/ops" && (get || post)) {
        if (!libraries_.isOpen(*l, req.cookie)) locked(out, *l);
        else if (get) getOps(*l, req, now, out);
        else postOps(*l, req, out);
    } else if (p == "/api/media" && post) {
        error(out, 507, "This drop point doesn't keep files. The photo waits on your phone and goes to the library next time you're there.",
              ",\"noMedia\":true");
    } else if ((p == "/api/pair" || p == "/api/showing" || p == "/api/upload") && post) {
        error(out, 503, "That only works at the library itself, not at a drop point.");
    } else if (p == "/api/status" && get && cfg_.status) {
        out.begin(200, "application/json");
        cfg_.status(cfg_.statusCtx, out);
    } else {
        error(out, 404, "not found");
    }
    return true;
}

}  // namespace osl
