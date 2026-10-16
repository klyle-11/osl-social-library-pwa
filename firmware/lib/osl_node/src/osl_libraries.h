// The libraries a drop point carries (docs/libraries-and-accounts.md, "Drop points").
//
// The main library is always here, and its log stays where it always was (<root>/ops.log),
// so a board flashed before keeps its notes. Other libraries come from the library's list
// (a KIND_LIBS radio message): each gets its own log in <root>/l/<id>/. A protected one is
// handed out only to a browser that gave its password here, checked against the PBKDF2
// hash in the list. Accounts stay at the library: here everyone is a guest.
//
// Plain C++ with no board code: the board (src/droppoint/main.cpp), the simulator
// (test/sim/droppoint_sim.cpp) and the tests all use this.
#pragma once
#include <stddef.h>
#include <stdint.h>

#include <memory>
#include <string>
#include <vector>

#include "osl_api.h"
#include "osl_store.h"

namespace osl {

struct Library {
    std::string id, name;
    std::string hash;       // the password's PBKDF2 hash; "" = open; "?" = shut until the list says
    bool listed = true;     // in the library's last list; one taken off only forwards what it still holds
    Store store;
    Presence presence;
    std::string dir;
    uint32_t wrong = 0, wrongSince = 0;   // wrong passwords this minute
};

class Libraries {
   public:
    enum Unlock { OPENED, WRONG, WAIT };

    // `root`: the data folder ("/littlefs/osl"); `maxBytes`: each log's cap; `random`: fills
    // bytes for the unlock tokens (esp_fill_random on the board); `room`: is there flash
    // left for this many more bytes, across every log (null: always)
    bool begin(const char* root, size_t maxBytes, void (*random)(uint8_t*, size_t), bool (*room)(size_t) = nullptr);
    bool room(size_t bytes) const { return !room_ || room_(bytes); }

    Library& main() { return *libs_[0]; }
    Library* find(const std::string& id);   // carried and listed, or null
    std::vector<Library*> listed();

    // A radio message from the library: an op (KIND_OP, KIND_LIB_OP) or the list
    // (KIND_LIBS). True when it can be marked durable: stored, or of no use.
    bool fromLibrary(const uint8_t* data, size_t len);

    // The next phone op to send on, as a radio message, taking the libraries in turn.
    bool nextForward(std::string* msg, std::string* library, uint32_t* seq);
    void forwarded(const std::string& library, uint32_t seq);

    // may the browser with this Cookie header have this library's ops?
    bool isOpen(const Library& l, const std::string& cookieHeader) const;
    // checks the password (a second or so on a board); OPENED fills `setCookie`
    Unlock unlock(Library& l, const std::string& password, const std::string& cookieHeader, uint32_t nowMs, std::string* setCookie);
    void lock(const Library& l, const std::string& cookieHeader);

    // across every library: for /api/status and the heartbeat
    uint32_t lastSeq() const;
    size_t waiting() const;
    size_t bytes() const;
    size_t count(Store::Src src) const;

    static const size_t MAX_LIBRARIES = 16;
    static const size_t MAX_SESSIONS = 32;

   private:
    struct Session {
        std::string token;
        std::vector<std::string> libs;
        uint32_t seen;
    };
    std::vector<std::unique_ptr<Library>> libs_;  // [0] is main
    std::vector<Session> sessions_;
    std::string root_;
    size_t maxBytes_ = 0;
    size_t turn_ = 0;
    void (*random_)(uint8_t*, size_t) = nullptr;
    bool (*room_)(size_t) = nullptr;

    Library* open(const std::string& id, const std::string& name, const std::string& hash);
    void applyList(const char* json, size_t len);
    void retireIfDone(Library& l);
    bool saveList();
    void forget(const std::string& id);   // out of every session (its password changed, or it's gone)
    const Session* sessionFor(const std::string& cookieHeader) const;
};

// the token in "osld=<token>" from a Cookie header ("" if none)
std::string dropCookie(const std::string& cookieHeader);

}  // namespace osl
