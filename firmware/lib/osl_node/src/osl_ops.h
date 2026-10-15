// Op validation for the drop point: the same rules as core/ops.ts in the app.
//
// Where the two could disagree, this side is the stricter one. An op the drop
// point won't take is not lost: it stays in the phone's outbox and goes to the
// library directly (the reply's "keep" list). The reverse would send an op over
// the radio that the library then refuses.

#pragma once
#include <ArduinoJson.h>

#include <stddef.h>

namespace osl {

// Returns why the op is invalid, or nullptr if it is valid.
const char* validateOp(JsonObjectConst op);

// Length of UTF-8 text in UTF-16 code units: what JavaScript's .length counts.
size_t utf16Length(const char* s);

}  // namespace osl
