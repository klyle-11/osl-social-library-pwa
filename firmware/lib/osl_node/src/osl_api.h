// The drop point's answers to the app: the same API the library node serves
// (node/server.ts), so the app needs no separate code for drop points.
//
//   GET  /api/health                  {"ok":true}
//   GET  /api/info                    {"secure":..., "addresses":[...], "host":"", "node":{...}}
//   GET  /api/ops?after=&user=&viewing=   ops from the library, a cursor, who is here
//   POST /api/ops {"ops":[...]}       store phones' ops for the library; "keep" lists ops left with the phone
//   GET  /api/directory               the libraries carried here, and whether this one is open
//   POST /api/unlock {"password"}     a protected library's password: opens it for this browser (a cookie)
//   POST /api/lock                    shuts it again for this browser
//   POST /api/media                   507 noMedia: files wait on the phone for the library
//   POST /api/pair, /api/showing, /api/upload   503: only at the library
//   GET  /api/status                  counters, for testing
// Another library's are the same under /api/l/<id>/ (osl_libraries.h); one not carried here
// answers 404, so a phone never hands its notes to the wrong library.
//
// The drop point is a write-only inbox: it hands phones only ops that came to it
// from the library, so an op coming back means it reached the library.
//
// Plain C++ with no board dependencies: the board's web server (src/droppoint/web.cpp)
// and the desktop simulator (test/droppoint_sim.cpp) both pass requests in here.

#pragma once
#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

#include "osl_store.h"

namespace osl {

class Libraries;
struct Library;

class Writer {
   public:
    virtual ~Writer() {}
    virtual void write(const char* s, size_t n) = 0;
    void write(const char* s);
};

// A reply: header() any number of times, then begin() once with the status, then the body.
class Reply : public Writer {
   public:
    virtual void header(const char* name, const std::string& value) = 0;
    virtual void begin(int status, const char* contentType) = 0;
};

struct Request {
    const char* method = "GET";
    std::string path;   // "/api/ops"
    std::string query;  // "after=...&user=..." (still percent-encoded)
    std::string cookie; // the Cookie header: an unlocked library's token is in it
    const char* body = nullptr;
    size_t bodyLen = 0;
};

// Who has asked recently, and what they had open. Memory only; never stored or sent by radio.
class Presence {
   public:
    static const uint32_t WINDOW_MS = 10000;  // as PRESENCE_WINDOW_MS in core/presence.ts
    static const size_t MAX = 32;
    void hello(const std::string& user, const std::string& viewing, uint32_t nowMs);
    void write(Writer& w, uint32_t nowMs);  // {"online":[...],"showing":null}
    size_t count(uint32_t nowMs);

   private:
    struct Entry {
        std::string user, viewing;
        uint32_t seen;
    };
    std::vector<Entry> entries_;
    void forget(uint32_t nowMs);
};

struct ApiConfig {
    const char* nodeId = "drop";      // the cursor's log id: "drop-a1b2c3"
    const char* address = "";         // how phones reach the library: "https://library.example.org"
    bool secure = false;
    size_t maxOpsPerReply = 200;      // a long return path is handed out over several polls
    size_t maxOpBytes = MAX_OP_BYTES; // an op bigger than this stays with the phone
    // Optional per-device limit (spam guard). Return false to leave the op with the phone.
    bool (*allow)(void* ctx, const char* user) = nullptr;
    void* allowCtx = nullptr;
    // Writes the body of /api/status (a JSON object). Optional.
    void (*status)(void* ctx, Writer& w) = nullptr;
    void* statusCtx = nullptr;
};

class Api {
   public:
    Api(Libraries& libraries, const ApiConfig& cfg) : libraries_(libraries), cfg_(cfg) {}

    // Answers an /api/ request and returns true; returns false for anything else
    // (the app's own files, served by the caller).
    bool handle(const Request& req, uint32_t nowMs, Reply& out);

   private:
    Libraries& libraries_;
    ApiConfig cfg_;

    void getOps(Library& l, const Request& req, uint32_t nowMs, Reply& out);
    void postOps(Library& l, const Request& req, Reply& out);
    void directory(Library& l, const Request& req, Reply& out);
    void unlock(Library& l, const Request& req, uint32_t nowMs, Reply& out);
    void locked(Reply& out, const Library& l);
    void writeNode(Writer& w);
    uint32_t since(const Store& store, const std::string& after);
};

// Helpers, exposed for tests.
std::string queryParam(const std::string& query, const char* name);  // percent-decoded, "" if absent
void writeJsonString(Writer& w, const char* s, size_t n);
void writeJsonString(Writer& w, const std::string& s);

}  // namespace osl
