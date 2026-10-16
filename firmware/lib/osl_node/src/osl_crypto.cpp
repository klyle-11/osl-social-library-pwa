#include "osl_crypto.h"

#include <stdlib.h>
#include <string.h>

namespace osl {

// ---- SHA-256 (FIPS 180-4) ----

static const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

static inline uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

static void compress(uint32_t h[8], const uint8_t block[64]) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++)
        w[i] = (uint32_t)block[i * 4] << 24 | (uint32_t)block[i * 4 + 1] << 16 | (uint32_t)block[i * 4 + 2] << 8 | block[i * 4 + 3];
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (int i = 0; i < 64; i++) {
        uint32_t t1 = hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
        uint32_t t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
        hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

Sha256::Sha256() {
    static const uint32_t init[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    memcpy(h, init, sizeof h);
}

void Sha256::update(const uint8_t* data, size_t len) {
    bytes += len;
    while (len) {
        size_t take = 64 - used < len ? 64 - used : len;
        memcpy(buf + used, data, take);
        used += take;
        data += take;
        len -= take;
        if (used == 64) { compress(h, buf); used = 0; }
    }
}

void Sha256::finish(uint8_t out[32]) {
    uint64_t bits = bytes * 8;
    uint8_t pad = 0x80;
    update(&pad, 1);
    uint8_t zero = 0;
    while (used != 56) update(&zero, 1);
    uint8_t len[8];
    for (int i = 0; i < 8; i++) len[i] = (uint8_t)(bits >> (56 - 8 * i));
    update(len, 8);
    for (int i = 0; i < 8; i++) {
        out[i * 4] = h[i] >> 24; out[i * 4 + 1] = h[i] >> 16; out[i * 4 + 2] = h[i] >> 8; out[i * 4 + 3] = h[i];
    }
}

// ---- PBKDF2-HMAC-SHA256 (RFC 8018). The two HMAC keyed states are worked out once,
// so each of the many iterations is two compressions ----

void pbkdf2Sha256(const uint8_t* password, size_t passwordLen, const uint8_t* salt, size_t saltLen, uint32_t iterations,
                  uint8_t* out, size_t outLen) {
    uint8_t key[64] = {0};
    if (passwordLen > 64) {
        Sha256 k;
        k.update(password, passwordLen);
        k.finish(key);
    } else {
        memcpy(key, password, passwordLen);
    }
    uint8_t pad[64];
    Sha256 inner, outer;
    for (int i = 0; i < 64; i++) pad[i] = key[i] ^ 0x36;
    inner.update(pad, 64);
    for (int i = 0; i < 64; i++) pad[i] = key[i] ^ 0x5c;
    outer.update(pad, 64);

    auto hmac = [&](const uint8_t* a, size_t an, const uint8_t* b, size_t bn, uint8_t mac[32]) {
        Sha256 i = inner;
        i.update(a, an);
        if (bn) i.update(b, bn);
        uint8_t ih[32];
        i.finish(ih);
        Sha256 o = outer;
        o.update(ih, 32);
        o.finish(mac);
    };

    for (uint32_t block = 1; outLen; block++) {
        uint8_t count[4] = {(uint8_t)(block >> 24), (uint8_t)(block >> 16), (uint8_t)(block >> 8), (uint8_t)block};
        uint8_t u[32], t[32];
        hmac(salt, saltLen, count, 4, u);
        memcpy(t, u, 32);
        for (uint32_t i = 1; i < iterations; i++) {
            hmac(u, 32, nullptr, 0, u);
            for (int j = 0; j < 32; j++) t[j] ^= u[j];
        }
        size_t take = outLen < 32 ? outLen : 32;
        memcpy(out, t, take);
        out += take;
        outLen -= take;
    }
}

std::string base64urlDecode(const std::string& s) {
    std::string out;
    uint32_t acc = 0;
    int bits = 0;
    for (char c : s) {
        int v = c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52
              : c == '-' ? 62 : c == '_' ? 63 : c == '=' ? -2 : -1;
        if (v == -2) break;
        if (v < 0) return "";
        acc = (acc << 6) | (uint32_t)v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back((char)((acc >> bits) & 0xff));
        }
    }
    return out;
}

bool verifyLibraryPassword(const std::string& stored, const std::string& password, uint32_t maxIterations) {
    // pbkdf2-sha256$<iterations>$<salt>$<hash>
    const char* prefix = "pbkdf2-sha256$";
    if (stored.compare(0, strlen(prefix), prefix) != 0) return false;
    size_t a = strlen(prefix), b = stored.find('$', a), c = b == std::string::npos ? b : stored.find('$', b + 1);
    if (c == std::string::npos || stored.find('$', c + 1) != std::string::npos) return false;
    std::string count = stored.substr(a, b - a);
    if (count.empty() || count.size() > 9 || count.find_first_not_of("0123456789") != std::string::npos) return false;
    uint32_t iterations = (uint32_t)strtoul(count.c_str(), nullptr, 10);
    if (!iterations || iterations > maxIterations) return false;
    std::string salt = base64urlDecode(stored.substr(b + 1, c - b - 1)), want = base64urlDecode(stored.substr(c + 1));
    if (salt.empty() || want.empty() || want.size() > 64) return false;
    uint8_t got[64];
    pbkdf2Sha256((const uint8_t*)password.data(), password.size(), (const uint8_t*)salt.data(), salt.size(), iterations, got, want.size());
    uint8_t diff = 0;  // the whole length, every time
    for (size_t i = 0; i < want.size(); i++) diff |= got[i] ^ (uint8_t)want[i];
    return diff == 0;
}

}  // namespace osl
