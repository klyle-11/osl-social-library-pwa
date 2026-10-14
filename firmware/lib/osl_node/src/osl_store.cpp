#include "osl_store.h"

#include "osl_link.h"  // crc16

#include <stdlib.h>
#include <string.h>
#include <unistd.h>

namespace osl {

static const size_t LINE_MAX_BYTES = MAX_OP_BYTES + 200;

bool Store::parseLine(char* line, size_t n, uint32_t* seq, char* src, const char** id, size_t* jsonStart, size_t* jsonLen) {
    if (n < 12 || line[n - 1] != '\n') return false;
    char* t1 = strchr(line, '\t');
    char* t2 = t1 ? strchr(t1 + 1, '\t') : nullptr;
    char* t3 = t2 ? strchr(t2 + 1, '\t') : nullptr;
    char* crcField = line + n - 6;  // "\tXXXX\n"
    if (!t3 || t2 != t1 + 2 || crcField <= t3 || *crcField != '\t') return false;
    size_t start = t3 + 1 - line, len = crcField - (t3 + 1);
    char hex[5] = {crcField[1], crcField[2], crcField[3], crcField[4], 0};
    if (strtoul(hex, nullptr, 16) != crc16((const uint8_t*)line + start, len)) return false;
    *t3 = 0;
    *seq = strtoul(line, nullptr, 10);
    *src = t1[1];
    *id = t2 + 1;
    *jsonStart = start;
    *jsonLen = len;
    return true;
}

uint64_t Store::hashId(const char* id) {
    uint64_t h = 1469598103934665603ULL;  // FNV-1a 64
    for (; *id; id++) h = (h ^ (uint8_t)*id) * 1099511628211ULL;
    return h;
}

bool Store::begin(const char* dir, size_t maxBytes) {
    dir_ = dir;
    maxBytes_ = maxBytes;

    FILE* f = fopen((dir_ + "/fwd").c_str(), "r");
    if (f) {
        unsigned long v = 0;
        if (fscanf(f, "%lu", &v) == 1) fwdSeq_ = v;
        fclose(f);
    }

    std::string path = dir_ + "/ops.log";
    log_ = fopen(path.c_str(), "a+");
    if (!log_) return false;
    fseek(log_, 0, SEEK_SET);

    char* line = (char*)malloc(LINE_MAX_BYTES);
    if (!line) return false;
    long pos = 0;
    int last = '\n';
    while (fgets(line, LINE_MAX_BYTES, log_)) {
        size_t n = strlen(line);
        long start = pos;
        pos += n;
        last = line[n - 1];
        uint32_t seq;
        char src;
        const char* id;
        size_t js, jl;
        if (!parseLine(line, n, &seq, &src, &id, &js, &jl)) continue;  // torn by a power cut: never acked, skip
        uint64_t h = hashId(id);
        anyIds_.insert(h);
        if (src == ARCHIVE) {
            archiveIds_.insert(h);
            archiveCount_++;
        } else {
            phoneCount_++;
            if (seq > fwdSeq_) fwd_.push_back({seq, start + (long)js, (uint32_t)jl});
        }
        if (seq > seq_) seq_ = seq;
    }
    free(line);
    bytes_ = pos;
    if (last != '\n') {  // make sure the next line starts cleanly after a torn one
        fputc('\n', log_);
        fflush(log_);
        bytes_++;
    }
    return true;
}

Store::Result Store::add(Src src, const char* id, const char* json, size_t len) {
    if (!log_ || !id || !*id || len == 0 || len > MAX_OP_BYTES || memchr(json, '\n', len)) return FAILED;
    uint64_t h = hashId(id);
    if (src == PHONE && anyIds_.count(h)) return DUPLICATE;
    if (src == ARCHIVE && archiveIds_.count(h)) return DUPLICATE;
    if (bytes_ + len + 64 > maxBytes_) return FULL;

    if (fseek(log_, 0, SEEK_END) != 0) return FAILED;
    uint32_t seq = seq_ + 1;
    int head = fprintf(log_, "%lu\t%c\t%s\t", (unsigned long)seq, (char)src, id);
    if (head < 0) return FAILED;
    long jsonOff = (long)bytes_ + head;
    if (fwrite(json, 1, len, log_) != len) return FAILED;
    int tail = fprintf(log_, "\t%04x\n", crc16((const uint8_t*)json, len));
    if (tail < 0) return FAILED;
    if (fflush(log_) != 0 || fsync(fileno(log_)) != 0) return FAILED;  // durable before anyone is told "ok"

    seq_ = seq;
    bytes_ += head + len + tail;
    anyIds_.insert(h);
    if (src == ARCHIVE) {
        archiveIds_.insert(h);
        archiveCount_++;
    } else {
        phoneCount_++;
        fwd_.push_back({seq, jsonOff, (uint32_t)len});
    }
    return ADDED;
}

void Store::forEach(uint32_t since, uint32_t upto, bool includePhone, OpFn fn, void* ctx) {
    if (!log_) return;
    char* line = (char*)malloc(LINE_MAX_BYTES);
    if (!line) return;
    fseek(log_, 0, SEEK_SET);
    while (fgets(line, LINE_MAX_BYTES, log_)) {
        size_t n = strlen(line);
        uint32_t seq;
        char src;
        const char* id;
        size_t js, jl;
        if (!parseLine(line, n, &seq, &src, &id, &js, &jl)) continue;
        if (seq <= since || seq > upto) continue;
        if (src != ARCHIVE && !includePhone) continue;
        fn(ctx, line + js, jl);
    }
    free(line);
    fseek(log_, 0, SEEK_END);
}

bool Store::peekForward(uint32_t* seq, std::string* json) {
    if (fwd_.empty() || !log_) return false;
    const Entry& e = fwd_.front();
    json->resize(e.len);
    if (fseek(log_, e.offset, SEEK_SET) != 0 || fread(&(*json)[0], 1, e.len, log_) != e.len) {
        fseek(log_, 0, SEEK_END);
        return false;
    }
    fseek(log_, 0, SEEK_END);
    *seq = e.seq;
    return true;
}

void Store::forwarded(uint32_t seq) {
    while (!fwd_.empty() && fwd_.front().seq <= seq) fwd_.pop_front();
    if (seq > fwdSeq_) {
        fwdSeq_ = seq;
        saveFwd();
    }
}

bool Store::saveFwd() {
    std::string tmp = dir_ + "/fwd.tmp", path = dir_ + "/fwd";
    FILE* f = fopen(tmp.c_str(), "w");
    if (!f) return false;
    fprintf(f, "%lu\n", (unsigned long)fwdSeq_);
    fflush(f);
    fsync(fileno(f));
    fclose(f);
    if (rename(tmp.c_str(), path.c_str()) != 0) {  // some filesystems won't rename over a file
        remove(path.c_str());
        return rename(tmp.c_str(), path.c_str()) == 0;
    }
    return true;
}

}  // namespace osl
