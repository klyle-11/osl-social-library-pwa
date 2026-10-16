#include "osl_ops.h"

#include <stdint.h>
#include <string.h>

namespace osl {

// Same numbers as LIMITS in core/ops.ts.
static const size_t BODY = 1000, NAME = 80, TITLE = 200, TEXT = 1000, URL = 2000;

static const char* const TYPES[] = {"document", "annotation", "add-to-collection", "remove-from-collection",
                                    "name-collection", "name-user", "hide", "describe", "collection-access"};
static const char* const DESCRIBE_FIELDS[] = {"title", "subtitle", "author", "type", "year", "description", "alt", "thumbnail", "editors", "prompts"};

static bool oneOf(const char* s, const char* const* list, size_t n) {
    if (!s) return false;
    for (size_t i = 0; i < n; i++)
        if (!strcmp(s, list[i])) return true;
    return false;
}

// Decodes one UTF-8 character; returns its length in bytes (0 at the end or on a bad byte).
static size_t decode(const char* s, uint32_t* cp) {
    const uint8_t* u = (const uint8_t*)s;
    if (!u[0]) return 0;
    if (u[0] < 0x80) { *cp = u[0]; return 1; }
    size_t n = (u[0] & 0xE0) == 0xC0 ? 2 : (u[0] & 0xF0) == 0xE0 ? 3 : (u[0] & 0xF8) == 0xF0 ? 4 : 0;
    if (!n) return 0;
    uint32_t c = u[0] & (0x7F >> n);
    for (size_t i = 1; i < n; i++) {
        if ((u[i] & 0xC0) != 0x80) return 0;
        c = (c << 6) | (u[i] & 0x3F);
    }
    *cp = c;
    return n;
}

size_t utf16Length(const char* s) {
    size_t units = 0;
    uint32_t cp;
    while (*s) {
        size_t n = decode(s, &cp);
        if (!n) { units++; s++; continue; }  // a stray byte: count it, so nothing is under-counted
        units += cp >= 0x10000 ? 2 : 1;
        s += n;
    }
    return units;
}

// What JavaScript's trim() removes.
static bool isSpace(uint32_t c) {
    return c == 0x09 || c == 0x0A || c == 0x0B || c == 0x0C || c == 0x0D || c == 0x20 || c == 0xA0 || c == 0x1680 ||
           (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 ||
           c == 0xFEFF;
}

static bool blank(const char* s) {
    uint32_t cp;
    while (*s) {
        size_t n = decode(s, &cp);
        if (!n || !isSpace(cp)) return false;
        s += n;
    }
    return true;
}

// Mirrors str() in core/ops.ts. `key` is for the message only.
static const char* str(JsonObjectConst o, const char* key, size_t max, bool required, const char* notString,
                       const char* empty, const char* tooLong) {
    JsonVariantConst v = o[key];
    if (v.isNull() && !required) return nullptr;
    if (!v.is<const char*>()) return notString;
    const char* s = v.as<const char*>();
    if (required && blank(s)) return empty;
    if (utf16Length(s) > max) return tooLong;
    return nullptr;
}

#define STR(o, key, max) str(o, key, max, true, key " must be a string", key " is empty", key " is too long")
#define OPT(o, key, max) str(o, key, max, false, key " must be a string", key " is empty", key " is too long")
#define TRY(e) do { const char* err_ = (e); if (err_) return err_; } while (0)

static const char* collectionId(JsonObjectConst o) {
    TRY(STR(o, "collectionId", 200));
    const char* id = o["collectionId"];
    const char* slash = strchr(id, '/');
    if (!slash || slash == id || !slash[1]) return "collectionId must look like owner/name";
    return nullptr;
}

// Who may see or add to a collection: "everyone", "owner" or "people:..." (core/access.ts).
static const char* audience(JsonObjectConst o, const char* key, const char* notString, const char* bad) {
    JsonVariantConst v = o[key];
    if (!v.is<const char*>()) return notString;
    const char* s = v.as<const char*>();
    if (utf16Length(s) > TEXT) return "value is too long";
    if (!strcmp(s, "everyone") || !strcmp(s, "owner") || !strncmp(s, "people:", 7)) return nullptr;
    return bad;
}

// "<user>:<counter>": the counter is digits only and at least 1. Writes the user part's length.
static bool opId(const char* id, size_t* userLen) {
    const char* colon = strrchr(id, ':');
    if (!colon || colon == id || !colon[1]) return false;
    bool nonzero = false;
    for (const char* p = colon + 1; *p; p++) {
        if (*p < '0' || *p > '9') return false;
        if (*p != '0') nonzero = true;
    }
    if (!nonzero || strlen(colon + 1) > 15) return false;
    *userLen = colon - id;
    return true;
}

// YYYY-MM-DDTHH:MM:SS(.fraction)Z
static bool isoUtc(const char* s) {
    static const char* shape = "dddd-dd-ddTdd:dd:dd";
    size_t i = 0;
    for (; shape[i]; i++) {
        char c = s[i];
        if (shape[i] == 'd' ? (c < '0' || c > '9') : c != shape[i]) return false;
    }
    if (s[i] == '.') {
        if (s[++i] < '0' || s[i] > '9') return false;
        while (s[i] >= '0' && s[i] <= '9') i++;
    }
    return s[i] == 'Z' && !s[i + 1];
}

const char* validateOp(JsonObjectConst o) {
    if (o.isNull()) return "not an object";
    const char* type = o["type"].is<const char*>() ? o["type"].as<const char*>() : nullptr;
    if (!oneOf(type, TYPES, sizeof TYPES / sizeof *TYPES)) return "unknown type";
    if (!o["id"].is<const char*>()) return "id must be a string";
    const char* id = o["id"];
    size_t userLen;
    if (!opId(id, &userLen)) return "id must look like user:counter";
    const char* user = o["user"].is<const char*>() ? o["user"].as<const char*>() : nullptr;
    if (!user || strlen(user) != userLen || strncmp(user, id, userLen)) return "user must match the id's device";
    if (!o["timestamp"].is<const char*>() || !isoUtc(o["timestamp"])) return "timestamp must be ISO 8601 UTC";

    if (!strcmp(type, "document")) {
        TRY(STR(o, "fileType", 100));
        TRY(OPT(o, "url", URL));
        TRY(OPT(o, "hash", 200));
        JsonObjectConst p = o["properties"];
        if (p.isNull()) return "properties missing";
        TRY(STR(p, "title", TITLE));
        TRY(OPT(p, "author", TITLE));
        TRY(OPT(p, "subtitle", TITLE));
        TRY(OPT(p, "year", 20));
        TRY(OPT(p, "description", TEXT));
        TRY(OPT(p, "alt", TEXT));
        TRY(OPT(p, "thumbnail", 200));
        TRY(OPT(p, "editors", TEXT));
        TRY(OPT(p, "prompts", TEXT));
        if (!p["type"].is<const char*>()) return "properties.type must be a string";
        return nullptr;
    }
    if (!strcmp(type, "annotation")) {
        TRY(STR(o, "target", 200));
        TRY(STR(o, "body", BODY));
        TRY(OPT(o, "replyTo", 200));
        static const char* const ACCESS[] = {"public", "private", "anonymous"};
        const char* access = o["access"].is<const char*>() ? o["access"].as<const char*>() : nullptr;
        if (!oneOf(access, ACCESS, 3)) return "access must be public, private or anonymous";
        return nullptr;
    }
    if (!strcmp(type, "add-to-collection") || !strcmp(type, "remove-from-collection")) {
        TRY(collectionId(o));
        return STR(o, "documentId", 200);
    }
    if (!strcmp(type, "name-collection")) {
        TRY(collectionId(o));
        return STR(o, "name", NAME);
    }
    if (!strcmp(type, "name-user")) return STR(o, "name", NAME);
    if (!strcmp(type, "hide")) return STR(o, "target", 200);
    if (!strcmp(type, "collection-access")) {
        TRY(collectionId(o));
        TRY(audience(o, "see", "see must be a string", "see must be everyone, owner or people:"));
        return audience(o, "add", "add must be a string", "add must be everyone, owner or people:");
    }
    // describe
    TRY(STR(o, "target", 200));
    const char* field = o["field"].is<const char*>() ? o["field"].as<const char*>() : nullptr;
    if (!oneOf(field, DESCRIBE_FIELDS, sizeof DESCRIBE_FIELDS / sizeof *DESCRIBE_FIELDS)) return "field can't be described";
    if (!o["value"].is<const char*>()) return "value must be a string";
    const char* value = o["value"];
    if (!strcmp(field, "title") && blank(value)) return "title is empty";
    size_t max = !strcmp(field, "description") || !strcmp(field, "alt") || !strcmp(field, "editors") || !strcmp(field, "prompts") ? TEXT : !strcmp(field, "year") ? 20 : TITLE;
    return utf16Length(value) > max ? "value is too long" : nullptr;
}

}  // namespace osl
