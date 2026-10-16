#include "osl_libraries.h"

#include <ArduinoJson.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>

#include "osl_crypto.h"
#include "osl_kinds.h"
#include "osl_ops.h"

namespace osl {

static const uint32_t WRONG_WINDOW_MS = 60000;
static const uint32_t WRONG_PER_WINDOW = 5;
static const char* COOKIE = "osld";

static bool validId(const std::string& id) {
    if (id.empty() || id.size() > 32) return false;
    for (char c : id)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
    return id.front() != '-' && id.back() != '-';
}

std::string dropCookie(const std::string& header) {
    size_t i = 0;
    while (i < header.size()) {
        size_t end = header.find(';', i);
        if (end == std::string::npos) end = header.size();
        size_t s = header.find_first_not_of(' ', i);
        size_t eq = header.find('=', s);
        if (s < end && eq < end && header.compare(s, eq - s, COOKIE) == 0 && eq - s == strlen(COOKIE)) return header.substr(eq + 1, end - eq - 1);
        i = end + 1;
    }
    return "";
}

bool Libraries::begin(const char* root, size_t maxBytes, void (*random)(uint8_t*, size_t), bool (*room)(size_t)) {
    root_ = root;
    maxBytes_ = maxBytes;
    random_ = random;
    room_ = room;
    libs_.clear();
    std::unique_ptr<Library> m(new Library());
    m->id = "main";
    m->name = "Library";
    m->dir = root_;
    bool ok = m->store.begin(root, maxBytes);
    libs_.push_back(std::move(m));

    // the list as last heard, so a restart carries the same libraries
    if (FILE* f = fopen((root_ + "/libraries.json").c_str(), "rb")) {
        std::string text;
        char buf[512];
        size_t n;
        while ((n = fread(buf, 1, sizeof buf, f)) > 0) text.append(buf, n);
        fclose(f);
        JsonDocument d;
        if (!deserializeJson(d, text)) {
            for (JsonObjectConst e : d["libs"].as<JsonArrayConst>()) {
                Library* l = open(e["id"] | "", e["name"] | "", e["hash"] | "");
                if (l) l->listed = e["listed"] | true;
            }
        }
    }
    return ok;
}

Library* Libraries::open(const std::string& id, const std::string& name, const std::string& hash) {
    if (id == "main") {
        if (!name.empty()) main().name = name;
        main().hash = hash;
        return &main();
    }
    if (!validId(id)) return nullptr;
    for (auto& l : libs_)
        if (l->id == id) return l.get();
    if (libs_.size() >= MAX_LIBRARIES) return nullptr;
    std::unique_ptr<Library> l(new Library());
    l->id = id;
    l->name = name.empty() ? id : name;
    l->hash = hash;
    std::string dir = root_ + "/l";
    mkdir(dir.c_str(), 0755);
    l->dir = dir + "/" + id;
    mkdir(l->dir.c_str(), 0755);
    if (!l->store.begin(l->dir.c_str(), maxBytes_)) return nullptr;
    libs_.push_back(std::move(l));
    return libs_.back().get();
}

Library* Libraries::find(const std::string& id) {
    for (auto& l : libs_)
        if (l->id == id && l->listed) return l.get();
    return nullptr;
}

std::vector<Library*> Libraries::listed() {
    std::vector<Library*> out;
    for (auto& l : libs_)
        if (l->listed) out.push_back(l.get());
    return out;
}

bool Libraries::saveList() {
    JsonDocument d;
    JsonArray a = d["libs"].to<JsonArray>();
    for (auto& l : libs_) {
        JsonObject e = a.add<JsonObject>();
        e["id"] = l->id;
        e["name"] = l->name;
        e["hash"] = l->hash;
        if (!l->listed) e["listed"] = false;
    }
    std::string path = root_ + "/libraries.json", tmp = path + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (!f) return false;
    std::string text;
    serializeJson(d, text);
    bool ok = fwrite(text.data(), 1, text.size(), f) == text.size();
    ok = fclose(f) == 0 && ok;
    return ok && rename(tmp.c_str(), path.c_str()) == 0;
}

void Libraries::forget(const std::string& id) {
    for (Session& s : sessions_) s.libs.erase(std::remove(s.libs.begin(), s.libs.end(), id), s.libs.end());
}

// The library's list: names, password hashes, and which libraries to carry. One taken
// off the list is shut at once; its log goes when what phones left in it has gone on.
void Libraries::applyList(const char* json, size_t len) {
    JsonDocument d;
    if (deserializeJson(d, json, len) || !d["libs"].is<JsonArrayConst>()) return;
    std::vector<std::string> named;
    for (JsonObjectConst e : d["libs"].as<JsonArrayConst>()) {
        std::string id = e["id"] | "", hash = e["hash"] | "";
        Library* l = find(id);
        if (!l) {
            for (auto& x : libs_)
                if (x->id == id) l = x.get();   // taken off before and now back
        }
        if (l && l->hash != hash) forget(id);   // a new password closes it again everywhere
        std::string name = e["name"] | "";
        l = open(id, name, hash);
        if (!l) continue;
        l->hash = hash;
        if (!name.empty()) l->name = name;
        l->listed = true;
        named.push_back(id);
    }
    if (std::find(named.begin(), named.end(), "main") == named.end() && !main().hash.empty() && main().hash != "?") {
        // main is always carried; a list without it means main has no password
        forget("main");
        main().hash.clear();
    }
    for (size_t i = 1; i < libs_.size();) {
        Library& l = *libs_[i];
        if (std::find(named.begin(), named.end(), l.id) == named.end() && l.listed) {
            l.listed = false;
            forget(l.id);
        }
        size_t before = libs_.size();
        retireIfDone(l);
        if (libs_.size() == before) i++;
    }
    saveList();
}

// a library off the list, with nothing left to send on: its log is erased from flash
void Libraries::retireIfDone(Library& l) {
    if (l.listed || l.id == "main" || l.store.waiting()) return;
    l.store.close();
    unlink((l.dir + "/ops.log").c_str());
    unlink((l.dir + "/fwd").c_str());
    unlink((l.dir + "/fwd.tmp").c_str());
    rmdir(l.dir.c_str());
    std::string id = l.id;
    libs_.erase(std::remove_if(libs_.begin(), libs_.end(), [&](const std::unique_ptr<Library>& x) { return x->id == id; }), libs_.end());
    saveList();
}

bool Libraries::fromLibrary(const uint8_t* data, size_t len) {
    if (len < 2) return true;
    if (data[0] == KIND_LIBS) {
        applyList((const char*)data + 1, len - 1);
        return true;
    }
    Library* l = nullptr;
    const char* json = (const char*)data + 1;
    size_t jsonLen = len - 1;
    if (data[0] == KIND_OP) {
        l = &main();
    } else if (data[0] == KIND_LIB_OP) {
        const char* nl = (const char*)memchr(json, '\n', jsonLen);
        if (!nl) return true;
        std::string id(json, nl - json);
        jsonLen -= nl + 1 - json;
        json = nl + 1;
        l = find(id);
        // before its list has come: kept, but shut to everyone until the list says how to open it
        if (!l && validId(id)) {
            l = open(id, id, "?");
            if (l) { l->listed = true; saveList(); }
        }
        if (!l) return true;   // can't carry it (too many): it isn't kept, and won't be sent again
    } else {
        return true;   // a kind this drop point doesn't keep
    }
    JsonDocument doc;
    if (deserializeJson(doc, json, jsonLen) || validateOp(doc.as<JsonObjectConst>())) return true;   // nothing useful to keep
    std::string line;
    serializeJson(doc, line);   // normalised to one line
    if (!room(line.size() + 64)) return false;   // flash is full: the library sends it again later
    Store::Result r = l->store.add(Store::ARCHIVE, doc["id"].as<const char*>(), line.data(), line.size());
    return r == Store::ADDED || r == Store::DUPLICATE;
}

bool Libraries::nextForward(std::string* msg, std::string* library, uint32_t* seq) {
    for (size_t k = 0; k < libs_.size(); k++) {
        Library& l = *libs_[(turn_ + k) % libs_.size()];
        std::string json;
        if (!l.store.peekForward(seq, &json)) continue;
        turn_ = (turn_ + k + 1) % libs_.size();
        msg->clear();
        if (l.id == "main") {
            msg->push_back((char)KIND_OP);
        } else {
            msg->push_back((char)KIND_LIB_OP);
            *msg += l.id;
            msg->push_back('\n');
        }
        *msg += json;
        *library = l.id;
        return true;
    }
    return false;
}

void Libraries::forwarded(const std::string& library, uint32_t seq) {
    for (auto& l : libs_) {
        if (l->id != library) continue;
        l->store.forwarded(seq);
        retireIfDone(*l);
        return;
    }
}

const Libraries::Session* Libraries::sessionFor(const std::string& cookieHeader) const {
    std::string token = dropCookie(cookieHeader);
    if (token.empty()) return nullptr;
    for (const Session& s : sessions_)
        if (s.token == token) return &s;
    return nullptr;
}

bool Libraries::isOpen(const Library& l, const std::string& cookieHeader) const {
    if (l.hash.empty()) return true;
    if (l.hash == "?") return false;
    const Session* s = sessionFor(cookieHeader);
    return s && std::find(s->libs.begin(), s->libs.end(), l.id) != s->libs.end();
}

Libraries::Unlock Libraries::unlock(Library& l, const std::string& password, const std::string& cookieHeader, uint32_t now, std::string* setCookie) {
    if (l.hash.empty()) return OPENED;
    if (l.hash == "?") return WRONG;
    if (now - l.wrongSince > WRONG_WINDOW_MS) { l.wrong = 0; l.wrongSince = now; }
    if (l.wrong >= WRONG_PER_WINDOW) return WAIT;
    if (!verifyLibraryPassword(l.hash, password, 300000)) {
        l.wrong++;
        return WRONG;
    }
    Session* s = const_cast<Session*>(sessionFor(cookieHeader));
    if (!s) {
        if (sessions_.size() >= MAX_SESSIONS) {
            auto oldest = std::min_element(sessions_.begin(), sessions_.end(), [&](const Session& a, const Session& b) { return now - a.seen > now - b.seen; });
            sessions_.erase(oldest);
        }
        uint8_t raw[16];
        random_(raw, sizeof raw);
        static const char* hex = "0123456789abcdef";
        std::string token;
        for (uint8_t b : raw) { token.push_back(hex[b >> 4]); token.push_back(hex[b & 15]); }
        sessions_.push_back({token, {}, now});
        s = &sessions_.back();
        // for this visit: a drop point forgets its sessions when it restarts
        *setCookie = std::string(COOKIE) + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400";
    }
    s->seen = now;
    if (std::find(s->libs.begin(), s->libs.end(), l.id) == s->libs.end()) s->libs.push_back(l.id);
    return OPENED;
}

void Libraries::lock(const Library& l, const std::string& cookieHeader) {
    Session* s = const_cast<Session*>(sessionFor(cookieHeader));
    if (s) s->libs.erase(std::remove(s->libs.begin(), s->libs.end(), l.id), s->libs.end());
}

uint32_t Libraries::lastSeq() const {
    uint32_t n = 0;
    for (auto& l : libs_) n += l->store.lastSeq();
    return n;
}
size_t Libraries::waiting() const {
    size_t n = 0;
    for (auto& l : libs_) n += l->store.waiting();
    return n;
}
size_t Libraries::bytes() const {
    size_t n = 0;
    for (auto& l : libs_) n += l->store.bytes();
    return n;
}
size_t Libraries::count(Store::Src src) const {
    size_t n = 0;
    for (auto& l : libs_) n += l->store.count(src);
    return n;
}

}  // namespace osl
