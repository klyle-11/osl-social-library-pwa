// Durable op log for the drop point. Plain C stdio, so it works on LittleFS
// (through ESP-IDF's VFS) and on a desktop for tests.
//
// ops.log is append-only, one op per line:   <seq>\t<src>\t<id>\t<op json>\t<crc>\n
//   crc is CRC-16 of the op json (4 hex digits); a line torn by a power cut fails it
//   src 'p' = handed in by a phone here, waiting to travel to the archive
//   src 'a' = came from the archive (moderated); the only kind shown to phones
// fwd holds the seq of the last phone op the archive confirmed durable.

#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

#include <deque>
#include <string>
#include <unordered_set>

namespace osl {

constexpr size_t MAX_OP_BYTES = 4000;  // must fit one link message (4800) with room to spare

class Store {
   public:
    enum Src : char { PHONE = 'p', ARCHIVE = 'a' };
    enum Result { ADDED, DUPLICATE, FULL, FAILED };

    // dir must exist. maxBytes caps ops.log so flash never fills completely.
    bool begin(const char* dir, size_t maxBytes);

    Result add(Src src, const char* id, const char* json, size_t len);

    uint32_t lastSeq() const { return seq_; }
    size_t count(Src src) const { return src == PHONE ? phoneCount_ : archiveCount_; }
    size_t waiting() const { return fwd_.size(); }
    size_t bytes() const { return bytes_; }

    // Calls fn for each op with seq in (since, upto] from the archive (and from phones if includePhone).
    typedef void (*OpFn)(void* ctx, const char* json, size_t len);
    void forEach(uint32_t since, uint32_t upto, bool includePhone, OpFn fn, void* ctx);

    // Forwarding to the archive, strictly in order, one at a time.
    bool peekForward(uint32_t* seq, std::string* json);
    void forwarded(uint32_t seq);

   private:
    struct Entry {
        uint32_t seq;
        long offset;  // start of the op json in ops.log
        uint32_t len;
    };
    std::string dir_;
    FILE* log_ = nullptr;
    uint32_t seq_ = 0, fwdSeq_ = 0;
    size_t bytes_ = 0, maxBytes_ = 0, phoneCount_ = 0, archiveCount_ = 0;
    std::unordered_set<uint64_t> anyIds_, archiveIds_;
    std::deque<Entry> fwd_;

    static uint64_t hashId(const char* id);
    // Splits a complete line; returns false if it is torn or malformed.
    static bool parseLine(char* line, size_t n, uint32_t* seq, char* src, const char** id, size_t* jsonStart, size_t* jsonLen);
    bool saveFwd();
};

}  // namespace osl
