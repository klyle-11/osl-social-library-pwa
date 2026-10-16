// Checking a library's password at a drop point (docs/libraries-and-accounts.md): the
// library sends its PBKDF2-SHA256 hash, "pbkdf2-sha256$<iterations>$<salt>$<hash>" with
// base64url salt and hash, as node/passwords.ts makes it. Plain C++, no board code, so
// the same check runs on the board and in the tests.
#pragma once
#include <stddef.h>
#include <stdint.h>

#include <string>

namespace osl {

struct Sha256 {
    uint32_t h[8];
    uint8_t buf[64];
    uint64_t bytes = 0;
    size_t used = 0;
    Sha256();
    void update(const uint8_t* data, size_t len);
    void finish(uint8_t out[32]);
};

void pbkdf2Sha256(const uint8_t* password, size_t passwordLen, const uint8_t* salt, size_t saltLen, uint32_t iterations,
                  uint8_t* out, size_t outLen);

// "" for anything that isn't base64url
std::string base64urlDecode(const std::string& s);

// true only for the right password against a hash in the format above; anything else
// (another format, a count past `maxIterations`) is false
bool verifyLibraryPassword(const std::string& stored, const std::string& password, uint32_t maxIterations = 1000000);

}  // namespace osl
