#include "osl_status.h"

#include <ArduinoJson.h>
#include <math.h>
#include <string.h>

namespace osl {

std::string statusMessage(const DropStatus& s) {
    JsonDocument d;
    d["id"] = s.id;
    d["name"] = s.name;
    d["app"] = s.app;
    d["every"] = s.every;
    d["up"] = s.up;
    d["waiting"] = s.waiting;
    d["ops"] = s.ops;
    d["flashFree"] = s.flashFree;
    d["phones"] = s.phones;
    if (s.heard) {
        // one decimal is all the radio gives; it keeps the message in one fragment
        d["rssi"] = roundf(s.rssi * 10) / 10;
        d["snr"] = roundf(s.snr * 10) / 10;
    }
    std::string out;
    serializeJson(d, out);
    return out;
}

std::string appVersionIn(const char* text, size_t len) {
    static const char* mark = "osl-shell-";
    size_t m = strlen(mark);
    for (size_t i = 0; i + m < len; i++) {
        if (memcmp(text + i, mark, m) != 0) continue;
        size_t j = i + m;
        while (j < len && ((text[j] >= '0' && text[j] <= '9') || (text[j] >= 'a' && text[j] <= 'f'))) j++;
        if (j > i + m) return std::string(text + i + m, j - i - m);
    }
    return "";
}

}  // namespace osl
