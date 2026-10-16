// Modem (gate seven, step A): the ESP32-S3 plugged into the Pi by USB.
// It only frames, sends, receives and hands over. All storage and every
// decision stay on the Pi (node/server.ts and node/radio.ts).
//
// USB serial protocol, one JSON object per line, 115200 baud: lib/osl_modem/src/osl_modem.h,
// and {"t":"hello", ...} from here, every 30 s and on ping.

#include <Arduino.h>
#include <ArduinoJson.h>

#include <string>

#include "config.h"
#include "lora_io.h"
#include "osl_link.h"
#include "osl_modem.h"

static LoRaIO io;
static osl::Link radioLink(io);  // not "link": that name is taken by POSIX link()
static std::string line;
static bool radioOk = false;

static void toPi(void*, const std::string& l) {
    Serial.write((const uint8_t*)l.data(), l.size());
    Serial.println();
}

// lines from the Pi become radio messages and back (lib/osl_modem: tested in the rehearsal)
static osl::ModemRelay relay(radioLink, toPi, nullptr);

static void hello() {
    const osl::LinkStats& s = radioLink.stats();
    JsonDocument d;
    d["t"] = "hello";
    d["role"] = "modem";
    d["radio"] = radioOk;
    d["radioError"] = io.lastError();
    d["rssi"] = io.lastRssi();
    d["snr"] = io.lastSnr();
    d["queued"] = relay.queued();
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
    relay.deliver(msgId, data, len, io.lastRssi(), io.lastSnr());
}

static void onRemoteDurable(void*, uint32_t msgId) { relay.remoteDurable(msgId); }

void setup() {
    Serial.setRxBufferSize(16384);
    Serial.begin(115200);
    radioOk = io.begin();
    radioLink.onDeliver(onDeliver, nullptr);
    radioLink.onRemoteDurable(onRemoteDurable, nullptr);
    if (!radioOk) toPi(nullptr, "{\"t\":\"log\",\"msg\":\"radio init failed: check pins in config.h\"}");
    hello();
}

void loop() {
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\n') {
            if (!line.empty() && relay.line(line)) hello();
            line.clear();
        } else if (c != '\r' && line.size() < 12000) {
            line.push_back(c);
        }
    }

    io.poll(radioLink);
    radioLink.tick();
    relay.pump();

    static uint32_t lastHello = 0;
    if (millis() - lastHello > 30000) {
        lastHello = millis();
        hello();
    }
}
