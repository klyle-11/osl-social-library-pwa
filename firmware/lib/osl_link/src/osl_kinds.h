// What a radio message is: its first byte. The same numbers on every board, the
// simulators and node/radio.ts's partner, the modem.
#pragma once
#include <stdint.h>

namespace osl {
constexpr uint8_t KIND_OP = 1;      // the main library's op: <kind><op json>
constexpr uint8_t KIND_STATUS = 2;  // a drop point's heartbeat (osl_status.h), only shown
constexpr uint8_t KIND_LIB_OP = 3;  // another library's op: <kind><library id>\n<op json>
constexpr uint8_t KIND_LIBS = 4;    // the libraries a drop point carries: <kind>{"libs":[{"id","name","hash"}]}
}  // namespace osl
