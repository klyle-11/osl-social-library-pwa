#include "osl_modem.h"

#include <ArduinoJson.h>
#include <stdio.h>
#include <string.h>

#include "osl_kinds.h"

namespace osl {

static const char* LIBS_ID = "#libs";   // the list goes in the same queue as ops, under this name

void ModemRelay::log(const char* msg) {
    JsonDocument d;
    d["t"] = "log";
    d["msg"] = msg;
    std::string s;
    serializeJson(d, s);
    out_(ctx_, s);
}

bool ModemRelay::line(const std::string& l) {
    JsonDocument d;
    if (deserializeJson(d, l)) { log("bad line from Pi"); return false; }
    const char* t = d["t"] | "";
    if (!strcmp(t, "send")) {
        const char* id = d["id"] | "";
        const char* library = d["l"] | "main";
        if (!*id || !d["op"].is<JsonObject>()) { log("send needs id and op"); return false; }
        if (inflightId_ == id) return false;   // the Pi sent it again while we are still on it
        for (auto& o : queue_)
            if (o.id == id) return false;
        if (queue_.size() >= MAX_QUEUE) { log("queue full"); return false; }
        Outgoing o;
        o.id = id;
        // ArduinoJson 7's serializeJson replaces a string's contents rather than appending,
        // so the op goes into its own string first; the kind byte must stay in front.
        std::string json;
        serializeJson(d["op"], json);
        if (!strcmp(library, "main")) {
            o.msg.push_back((char)KIND_OP);
        } else {
            o.msg.push_back((char)KIND_LIB_OP);
            o.msg += library;
            o.msg.push_back('\n');
        }
        o.msg += json;
        if (o.msg.size() > MAX_MESSAGE) { log("op too large for the radio link"); return false; }
        queue_.push_back(o);
    } else if (!strcmp(t, "libs")) {
        if (!d["libs"].is<JsonArray>()) { log("libs needs a list"); return false; }
        Outgoing o;
        o.id = LIBS_ID;
        std::string json;
        JsonDocument list;
        list["libs"] = d["libs"];
        serializeJson(list, json);
        o.msg.push_back((char)KIND_LIBS);
        o.msg += json;
        if (o.msg.size() > MAX_MESSAGE) { log("the list of libraries is too large for the radio link"); return false; }
        // only the newest list matters: it replaces one still waiting, and goes first
        for (auto it = queue_.begin(); it != queue_.end(); ++it)
            if (it->id == LIBS_ID) { queue_.erase(it); break; }
        queue_.push_front(o);
    } else if (!strcmp(t, "durable")) {
        link_.markDurable(d["m"].as<uint32_t>());
    } else if (!strcmp(t, "ping")) {
        return true;
    }
    return false;
}

void ModemRelay::deliver(uint32_t msgId, const uint8_t* data, size_t len, float rssi, float snr) {
    if (len >= 2 && data[0] == KIND_STATUS) {
        // A drop point's heartbeat: handed to the Pi with how this board heard it.
        // Nothing to keep, so it is durable at once.
        JsonDocument check;
        if (!deserializeJson(check, (const char*)data + 1, len - 1) && check.is<JsonObject>()) {
            char head[96];
            snprintf(head, sizeof head, "{\"t\":\"status\",\"rssi\":%.1f,\"snr\":%.1f,\"status\":", rssi, snr);
            out_(ctx_, head + std::string((const char*)data + 1, len - 1) + "}");
        }
        link_.markDurable(msgId);
        return;
    }
    const char* json = (const char*)data + 1;
    size_t jsonLen = len >= 1 ? len - 1 : 0;
    std::string library;
    if (len >= 2 && data[0] == KIND_LIB_OP) {
        const char* nl = (const char*)memchr(json, '\n', jsonLen);
        if (!nl || nl == json || nl - json > 32) {
            log("dropped another library's op without its library");
            link_.markDurable(msgId);
            return;
        }
        library.assign(json, nl - json);
        jsonLen -= nl + 1 - json;
        json = nl + 1;
    } else if (len < 2 || data[0] != KIND_OP) {
        log("dropped a radio message of an unknown kind");
        link_.markDurable(msgId);   // unknown kind: nothing to keep
        return;
    }
    JsonDocument check;
    if (deserializeJson(check, json, jsonLen) || !check.is<JsonObject>()) {
        log("dropped a message that is not a JSON op");
        link_.markDurable(msgId);
        return;
    }
    // The op exactly as received. Durable comes later, when the Pi says so: if the Pi is
    // not listening, the drop point keeps asking and the message is delivered again.
    std::string line = "{\"t\":\"recv\",\"m\":" + std::to_string(msgId);
    if (!library.empty()) {
        JsonDocument l;
        l.set(library);
        std::string quoted;
        serializeJson(l, quoted);
        line += ",\"l\":" + quoted;
    }
    line += ",\"op\":" + std::string(json, jsonLen) + "}";
    out_(ctx_, line);
}

void ModemRelay::remoteDurable(uint32_t msgId) {
    if (msgId != inflight_) return;
    JsonDocument d;
    d["t"] = "sent";
    d["id"] = inflightId_;
    std::string s;
    serializeJson(d, s);
    out_(ctx_, s);
    inflight_ = 0;
    inflightId_.clear();
}

void ModemRelay::pump() {
    if (link_.busy() || inflight_ || queue_.empty()) return;
    Outgoing& o = queue_.front();
    inflight_ = link_.send((const uint8_t*)o.msg.data(), o.msg.size());
    if (inflight_) inflightId_ = o.id;
    queue_.pop_front();
}

}  // namespace osl
