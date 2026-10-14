// Drop point (gate seven, step B + C): the ESP32-S3 out in the neighbourhood.
//
//  - Runs a Wi-Fi network and answers every DNS name with itself, so
//    https://LIBRARY_DOMAIN reaches this board when there is no internet.
//  - Serves the app and the same /sync endpoint as the archive, over HTTPS with
//    the archive's name and certificate (web.cpp).
//  - Stores phones' ops in flash (write-only inbox) and forwards them to the
//    archive over LoRa, one at a time, deleting nothing until the archive says
//    the op is durable.
//  - Receives the archive's moderated ops over LoRa (the return path) and hands
//    only those out to phones.

#include <Arduino.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <WiFi.h>

#include <map>
#include <string>

#include "config.h"
#include "droppoint.h"
#include "lora_io.h"
#include "osl_link.h"
#include "osl_sync.h"

osl::Store store;
String nodeId;

static SemaphoreHandle_t storeMutex;
StoreLock::StoreLock() { xSemaphoreTake(storeMutex, portMAX_DELAY); }
StoreLock::~StoreLock() { xSemaphoreGive(storeMutex); }

static LoRaIO io;
static osl::Link radioLink(io);  // not "link": that name is taken by POSIX link()
static DNSServer dns;
static bool radioOk = false;
static uint32_t fwdMsg = 0, fwdSeq = 0;
static uint32_t receivedFromArchive = 0, forwardedToArchive = 0;

// ---- spam guard: ops per author per hour (called from the web task, under StoreLock) ----

bool allowAuthor(void*, const char* author) {
    static std::map<std::string, std::pair<uint32_t, uint32_t>> seen;  // author -> (window start, count)
    if (!author) return false;
    uint32_t now = millis();
    if (seen.size() > 200) seen.clear();
    auto& e = seen[author];
    if (now - e.first > 3600000UL || e.second == 0) e = {now, 0};
    return ++e.second <= OPS_PER_AUTHOR_PER_HOUR;
}

void fillStatus(JsonDocument& d) {
    const osl::LinkStats& s = radioLink.stats();
    d["node"] = nodeId;
    d["role"] = "droppoint";
    d["ops"] = store.lastSeq();
    d["fromPhones"] = store.count(osl::Store::PHONE);
    d["fromArchive"] = store.count(osl::Store::ARCHIVE);
    d["waitingToForward"] = store.waiting();
    d["forwardedThisBoot"] = forwardedToArchive;
    d["receivedThisBoot"] = receivedFromArchive;
    d["logBytes"] = store.bytes();
    d["flashFree"] = LittleFS.totalBytes() - LittleFS.usedBytes();
    d["heapFree"] = ESP.getFreeHeap();
    d["phonesConnected"] = WiFi.softAPgetStationNum();
    d["uptimeSec"] = millis() / 1000;
    JsonObject r = d["radio"].to<JsonObject>();
    r["ok"] = radioOk;
    r["rssi"] = io.lastRssi();
    r["snr"] = io.lastSnr();
    r["framesSent"] = s.framesSent;
    r["framesReceived"] = s.framesReceived;
    r["badFrames"] = s.badFrames;
    r["retransmits"] = s.retransmits;
    r["polls"] = s.polls;
}

// ---- radio: ops from the archive ----

static void onDeliver(void*, uint32_t msgId, const uint8_t* data, size_t len) {
    if (len < 2 || data[0] != KIND_OP) {
        radioLink.markDurable(msgId);
        return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, (const char*)data + 1, len - 1) || osl::validateOp(doc.as<JsonObjectConst>())) {
        Serial.println("dropped an invalid op from the archive");
        radioLink.markDurable(msgId);  // nothing useful to keep; stop the retries
        return;
    }
    std::string json;
    serializeJson(doc, json);  // normalised to one line
    osl::Store::Result r;
    {
        StoreLock lock;
        r = store.add(osl::Store::ARCHIVE, doc["id"].as<const char*>(), json.data(), json.size());
    }
    if (r == osl::Store::ADDED || r == osl::Store::DUPLICATE) {
        receivedFromArchive++;
        radioLink.markDurable(msgId);
    } else {
        Serial.println("could not store an op from the archive (flash full?); it will be resent");
    }
}

// ---- radio: our forwarded op is durable at the archive ----

static void onRemoteDurable(void*, uint32_t msgId) {
    if (msgId != fwdMsg) return;
    StoreLock lock;
    store.forwarded(fwdSeq);
    forwardedToArchive++;
    fwdMsg = 0;
}

static void forwardNext() {
    if (fwdMsg || radioLink.busy()) return;
    uint32_t seq;
    std::string json;
    {
        StoreLock lock;
        if (!store.peekForward(&seq, &json)) return;
    }
    std::string msg(1, (char)KIND_OP);
    msg += json;
    fwdMsg = radioLink.send((const uint8_t*)msg.data(), msg.size());
    if (fwdMsg) fwdSeq = seq;
}

void setup() {
    Serial.begin(115200);
    storeMutex = xSemaphoreCreateMutex();

    uint8_t mac[6];
    WiFi.macAddress(mac);
    char id[16];
    snprintf(id, sizeof id, "drop-%02x%02x%02x", mac[3], mac[4], mac[5]);
    nodeId = id;

    if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
    LittleFS.mkdir("/osl");
    size_t logSize = 0;
    if (File f = LittleFS.open("/osl/ops.log", "r")) {
        logSize = f.size();
        f.close();
    }
    size_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
    size_t maxBytes = logSize + (freeBytes > OPS_RESERVE_BYTES ? freeBytes - OPS_RESERVE_BYTES : 0);
    if (!store.begin("/littlefs/osl", maxBytes)) Serial.println("op log could not be opened");
    Serial.printf("%s: %u ops, %u waiting to forward, log %u of %u bytes\n", nodeId.c_str(), (unsigned)store.lastSeq(),
                  (unsigned)store.waiting(), (unsigned)store.bytes(), (unsigned)maxBytes);

    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, strlen(AP_PASSWORD) ? AP_PASSWORD : nullptr, AP_CHANNEL, 0, AP_MAX_CLIENTS);
    dns.setErrorReplyCode(DNSReplyCode::NoError);
    dns.start(53, "*", WiFi.softAPIP());  // every name, including LIBRARY_DOMAIN, is this board
    Serial.printf("Wi-Fi \"%s\" up; https://%s/ -> %s\n", AP_SSID, LIBRARY_DOMAIN, WiFi.softAPIP().toString().c_str());

    if (!webStart()) Serial.println("web server failed to start (missing /tls/cert.pem or /tls/key.pem? run uploadfs)");

    radioOk = io.begin();
    if (!radioOk) Serial.printf("radio init failed (%d): check pins in config.h\n", io.lastError());
    radioLink.onDeliver(onDeliver, nullptr);
    radioLink.onRemoteDurable(onRemoteDurable, nullptr);
}

void loop() {
    dns.processNextRequest();
    io.poll(radioLink);
    radioLink.tick();
    forwardNext();

    static uint32_t lastLog = 0;
    if (millis() - lastLog > 30000) {
        lastLog = millis();
        JsonDocument d;
        {
            StoreLock lock;
            fillStatus(d);
        }
        serializeJson(d, Serial);
        Serial.println();
    }
    delay(1);  // let the Wi-Fi and web server tasks run
}
