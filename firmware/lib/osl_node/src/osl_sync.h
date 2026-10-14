// The phone-facing /sync exchange for the drop point, plus op validation.
// Same contract as src/contract.js and the same reply shape as server.js:
//   request  {"ops":[...], "cursors":{"<node id>": n}}
//   reply    {"node":"...","cursor":n,"acked":[ids],"rejected":[{id,error}],"ops":[...]}
// The drop point is a write-only inbox: it accepts phones' ops for the archive,
// and only hands out ops that came back from the archive (already moderated).

#pragma once
#include <ArduinoJson.h>

#include <string>
#include <vector>

#include "osl_store.h"

namespace osl {

// Returns an error message, or nullptr if the op matches the contract.
const char* validateOp(JsonObjectConst op);

class Writer {
   public:
    virtual ~Writer() {}
    virtual void write(const char* s, size_t n) = 0;
    void write(const char* s);
};

struct SyncOptions {
    const char* nodeId = "drop";
    bool shareLocal = false;  // also hand out other phones' unmoderated ops
    // Optional per-author limit (spam guard). Return false to refuse an op.
    bool (*allow)(void* ctx, const char* author) = nullptr;
    void* allowCtx = nullptr;
};

struct SyncResult {
    uint32_t since = 0, cursor = 0;
    std::vector<std::string> acked;
    std::vector<std::pair<std::string, std::string>> rejected;  // id, error
};

// Phase 1: parse and store. Returns an HTTP status (200, or 400 for a bad request).
int applySync(Store& store, const char* body, size_t len, const SyncOptions& opt, SyncResult* out);

// Phase 2: stream the reply.
void writeSyncReply(Store& store, const SyncOptions& opt, const SyncResult& r, Writer& w);

}  // namespace osl
