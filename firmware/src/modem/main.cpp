// Modem (gate seven, step A): the ESP32-S3 plugged into the Pi by USB.
// It only frames, sends, receives and hands over. All storage and every
// decision stay on the Pi (server.js + radio-bridge.js).
//
// USB serial protocol, one JSON object per line, 115200 baud:
//   Pi -> modem   {"t":"send","id":"<op id>","op":{...}}   send an op to the drop point
//                 {"t":"durable","m":<msg>}                  the Pi has stored message <msg>
//                 {"t":"ping"}
//   modem -> Pi   {"t":"recv","m":<msg>,"op":{...}}         an op arrived; reply "durable" once stored
//                 {"t":"sent","id":"<op id>"}                the drop point has stored it durably
//                 {"t":"hello", ...}                         status, every 30 s and on ping
//                 {"t":"log","msg":"..."}

#include <Arduino.h>
#include <ArduinoJson.h>

#include <deque>
#include <string>

#include "config.h"
#include "lora_io.h"
#include "osl_link.h"

static LoRaIO io;
static osl::Link radioLink(io);  // not "link": that name is taken by POSIX link()

struct Outgoing {
    std::string id;
    std::string msg;  // KIND_OP + op json
};
static std::deque<Outgoing> queue;
static uint32_t inflightMsg = 0;
static std::string inflightId;
static std::string line;
static bool radioOk = false;

static void logLine(const char* msg) {
    JsonDocument d;
    d["t"] = "log";
    d["msg"] = msg;
    serializeJson(d, Serial);
    Serial.println();
}

static void hello() {
    const osl::LinkStats& s = radioLink.stats();
    JsonDocument d;
    d["t"] = "hello";
    d["role"] = "modem";
    d["radio"] = radioOk;
    d["radioError"] = io.lastError();
    d["rssi"] = io.lastRssi();
    d["snr"] = io.lastSnr();
    d["queued"] = queue.size() + (inflightMsg ? 1 : 0);
    JsonObject st = d["stats"].to<JsonObject>();
    st["framesSent"] = s.framesSent;
    st["framesReceived"] = s.framesReceived;
    st["badFrames"] = s.badFrames;
    st["messagesSent"] = s.messagesSent;
    st["messagesDelivered"] = s.messagesDelivered;
    st["retransmits"] = s.retransmits;
    st["polls"] = s.polls;
    serializeJson(d, Serial);
    Serial.println();
}

static void onDeliver(void*, uint32_t msgId, const uint8_t* data, size_t len) {
    if (len < 2 || data[0] != KIND_OP) {
        radioLink.markDurable(msgId);  // unknown kind: nothing to keep
        return;
    }
    JsonDocument check;
    if (deserializeJson(check, (const char*)data + 1, len - 1) || !check.is<JsonObject>()) {
        logLine("dropped a message that is not a JSON op");
        radioLink.markDurable(msgId);
        return;
    }
    // Embed the op exactly as received.
    Serial.print("{\"t\":\"recv\",\"m\":");
    Serial.print(msgId);
    Serial.print(",\"op\":");
    Serial.write(data + 1, len - 1);
    Serial.println("}");
    // Durable comes later, when the Pi says so. If the Pi is not listening the
    // drop point keeps polling and the message is delivered again.
}

static void onRemoteDurable(void*, uint32_t msgId) {
    if (msgId != inflightMsg) return;
    JsonDocument d;
    d["t"] = "sent";
    d["id"] = inflightId;
    serializeJson(d, Serial);
    Serial.println();
    inflightMsg = 0;
    inflightId.clear();
}

static void handleLine(const std::string& l) {
    JsonDocument d;
    if (deserializeJson(d, l)) return logLine("bad line from Pi");
    const char* t = d["t"] | "";
    if (!strcmp(t, "send")) {
        const char* id = d["id"] | "";
        if (!*id || !d["op"].is<JsonObject>()) return logLine("send needs id and op");
        if (inflightId == id) return;  // Pi re-sent while we are still working on it
        for (auto& o : queue)
            if (o.id == id) return;
        if (queue.size() >= 8) return logLine("queue full");
        Outgoing o;
        o.id = id;
        o.msg.push_back((char)KIND_OP);
        serializeJson(d["op"], o.msg);
        if (o.msg.size() > osl::MAX_MESSAGE) return logLine("op too large for the radio link");
        queue.push_back(o);
    } else if (!strcmp(t, "durable")) {
        radioLink.markDurable(d["m"].as<uint32_t>());
    } else if (!strcmp(t, "ping")) {
        hello();
    }
}

void setup() {
    Serial.setRxBufferSize(16384);
    Serial.begin(115200);
    radioOk = io.begin();
    radioLink.onDeliver(onDeliver, nullptr);
    radioLink.onRemoteDurable(onRemoteDurable, nullptr);
    if (!radioOk) logLine("radio init failed: check pins in config.h");
    hello();
}

void loop() {
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\n') {
            if (!line.empty()) handleLine(line);
            line.clear();
        } else if (c != '\r' && line.size() < 12000) {
            line.push_back(c);
        }
    }

    io.poll(radioLink);
    radioLink.tick();

    if (!radioLink.busy() && !inflightMsg && !queue.empty()) {
        Outgoing& o = queue.front();
        inflightMsg = radioLink.send((const uint8_t*)o.msg.data(), o.msg.size());
        if (inflightMsg) inflightId = o.id;
        queue.pop_front();
    }

    static uint32_t lastHello = 0;
    if (millis() - lastHello > 30000) {
        lastHello = millis();
        hello();
    }
}
