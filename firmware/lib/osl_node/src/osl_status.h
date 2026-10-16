// The drop point's heartbeat: a small status message it sends the library by radio
// every few minutes, so the library can list it as connected (or not heard since…)
// even when nobody is writing. One radio fragment; never stored, only shown.
//
// Plain C++ with no board dependencies (tested in test/node_test.cpp).
#pragma once
#include <stddef.h>
#include <stdint.h>

#include <string>

namespace osl {

// The first byte of a link message says what it is (see src/common/lora_io.h).
constexpr uint8_t KIND_STATUS = 2;

struct DropStatus {
    std::string id;          // "drop-a1b2c3", from the board's MAC
    std::string name;        // DROP_NAME in config.h: "Community garden"
    std::string app;         // the app version in its flash ("a4092bd8ec7f"), "" if none
    uint32_t every = 0;      // seconds between heartbeats, so the library knows when to worry
    uint32_t up = 0;         // seconds since it started
    uint32_t waiting = 0;    // phones' ops not yet across the radio
    uint32_t ops = 0;        // ops in its log
    uint32_t flashFree = 0;  // bytes
    uint32_t phones = 0;     // phones using the app there right now
    bool heard = false;      // has it heard the library's radio since it started?
    float rssi = 0, snr = 0; // how it hears the library (the last frame)
};

// The message body (JSON, one line, no kind byte).
std::string statusMessage(const DropStatus& s);

// The app version in a built sw.js ("osl-shell-<hex>"), or "".
std::string appVersionIn(const char* text, size_t len);

}  // namespace osl
