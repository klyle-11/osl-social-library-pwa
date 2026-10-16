// Drop point (gate seven, step B + C): the ESP32-S3 out in the neighbourhood.
//
//  - Runs a Wi-Fi network and answers every DNS name with itself, and takes the
//    library's own address (config.h), so a phone reaches this board exactly where
//    it would reach the library: same address, same app, same saved work.
//  - Serves the app and the library's /api/ops (web.cpp, osl::Api).
//  - Stores phones' ops in flash (write-only inbox) and forwards them to the
//    library over LoRa, one at a time, deleting nothing until the library says
//    the op is durable.
//  - Receives the library's ops over LoRa (the return path) and hands only those
//    out to phones: an op coming back tells a phone it reached the library.
//  - Carries the libraries the library lists (lib/osl_node/src/osl_libraries.h), each
//    in its own log; a protected one only for browsers that gave its password here.

#include <Arduino.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <WiFi.h>

#include <map>
#include <string>

#include "config.h"
#include "droppoint.h"
#include "lora_io.h"
#include "osl_libraries.h"
#include "osl_link.h"
#include "osl_ops.h"
#include "osl_status.h"

#if __has_include(<esp_random.h>)
#include <esp_random.h>  // esp_fill_random (in esp_system.h on older IDF)
#endif

static_assert(KIND_STATUS == osl::KIND_STATUS && KIND_OP == osl::KIND_OP, "lora_io.h and osl_kinds.h must agree");

static osl::Libraries libraries;
static osl::Api* theApi = nullptr;
static String nodeId;   // "drop-a1b2c3": also the log id in this drop point's cursors
static String address;  // where phones reach the library (and so this board)

static SemaphoreHandle_t storeMutex;
StoreLock::StoreLock() { xSemaphoreTake(storeMutex, portMAX_DELAY); }
StoreLock::~StoreLock() { xSemaphoreGive(storeMutex); }

static LoRaIO io;
static osl::Link radioLink(io);  // not "link": that name is taken by POSIX link()
static DNSServer dns;
static bool radioOk = false;
static uint32_t fwdMsg = 0, fwdSeq = 0;
static std::string fwdLib;
static uint32_t statusMsg = 0, lastStatus = 0;
static std::string appVersion;  // of the app in flash, so the library can tell a stale copy
static uint32_t receivedFromArchive = 0, forwardedToArchive = 0;

osl::Api& api() { return *theApi; }
const char* libraryAddress() { return address.c_str(); }

// ---- spam guard: ops per author per hour (called from the web task, under StoreLock) ----

static bool allowAuthor(void*, const char* author) {
    static std::map<std::string, std::pair<uint32_t, uint32_t>> seen;  // author -> (window start, count)
    if (!author) return false;
    uint32_t now = millis();
    if (seen.size() > 200) seen.clear();
    auto& e = seen[author];
    if (now - e.first > 3600000UL || e.second == 0) e = {now, 0};
    return ++e.second <= OPS_PER_AUTHOR_PER_HOUR;
}

static void fillStatus(JsonDocument& d) {
    const osl::LinkStats& s = radioLink.stats();
    d["node"] = nodeId;
    d["role"] = "droppoint";
    d["ops"] = libraries.lastSeq();
    d["fromPhones"] = libraries.count(osl::Store::PHONE);
    d["fromArchive"] = libraries.count(osl::Store::ARCHIVE);
    d["waitingToForward"] = libraries.waiting();
    d["libraries"] = libraries.listed().size();
    d["forwardedThisBoot"] = forwardedToArchive;
    d["receivedThisBoot"] = receivedFromArchive;
    d["logBytes"] = libraries.bytes();
    d["flashFree"] = LittleFS.totalBytes() - LittleFS.usedBytes();
    d["heapFree"] = ESP.getFreeHeap();
    d["phonesConnected"] = WiFi.softAPgetStationNum();
    size_t using_ = 0;
    for (osl::Library* l : libraries.listed()) using_ += l->presence.count(millis());
    d["phonesUsingTheApp"] = using_;
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

// /api/status (called by osl::Api from the web task, holding StoreLock)
static void writeStatus(void*, osl::Writer& w) {
    JsonDocument d;
    fillStatus(d);
    std::string out;
    serializeJson(d, out);
    w.write(out.data(), out.size());
}

// ---- radio: ops and the list of libraries from the archive ----

static void onDeliver(void*, uint32_t msgId, const uint8_t* data, size_t len) {
    bool durable;
    {
        StoreLock lock;
        durable = libraries.fromLibrary(data, len);
    }
    if (durable) {
        receivedFromArchive++;
        radioLink.markDurable(msgId);
    } else {
        Serial.println("could not store an op from the library (flash full?); it will be resent");
    }
}

// ---- radio: our forwarded op is durable at the archive ----

static void onRemoteDurable(void*, uint32_t msgId) {
    if (msgId == statusMsg) {
        statusMsg = 0;
        return;
    }
    if (msgId != fwdMsg) return;
    StoreLock lock;
    libraries.forwarded(fwdLib, fwdSeq);
    forwardedToArchive++;
    fwdMsg = 0;
}

// The heartbeat, every STATUS_INTERVAL_S (the first soon after starting). It goes
// ahead of the next queued op, so a long queue never hides the drop point.
static void sendStatusIfDue() {
    if (!radioOk || statusMsg || fwdMsg || radioLink.busy()) return;
    uint32_t now = millis();
    if (lastStatus ? now - lastStatus < STATUS_INTERVAL_S * 1000UL : now < 10000) return;
    osl::DropStatus st;
    st.id = nodeId.c_str();
    st.name = DROP_NAME;
    st.app = appVersion;
    st.every = STATUS_INTERVAL_S;
    st.up = now / 1000;
    {
        StoreLock lock;
        st.waiting = libraries.waiting();
        st.ops = libraries.lastSeq();
        st.phones = 0;
        for (osl::Library* l : libraries.listed()) st.phones += l->presence.count(now);
    }
    st.flashFree = LittleFS.totalBytes() - LittleFS.usedBytes();
    st.heard = radioLink.stats().framesReceived > 0;
    st.rssi = io.lastRssi();
    st.snr = io.lastSnr();
    std::string msg(1, (char)KIND_STATUS);
    msg += osl::statusMessage(st);
    statusMsg = radioLink.send((const uint8_t*)msg.data(), msg.size());
    lastStatus = now;
}

static void forwardNext() {
    if (fwdMsg || radioLink.busy()) return;
    uint32_t seq;
    std::string msg, lib;
    {
        StoreLock lock;
        if (!libraries.nextForward(&msg, &lib, &seq)) return;
    }
    fwdMsg = radioLink.send((const uint8_t*)msg.data(), msg.size());
    if (fwdMsg) {
        fwdSeq = seq;
        fwdLib = lib;
    }
}

static void randomBytes(uint8_t* out, size_t n) { esp_fill_random(out, n); }

// Every library's log shares the flash: none may eat into what is kept free.
static bool roomFor(size_t bytes) {
    size_t total = LittleFS.totalBytes(), used = LittleFS.usedBytes();
    return used < total && total - used > OPS_RESERVE_BYTES + bytes;
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
    if (!libraries.begin("/littlefs/osl", maxBytes, randomBytes, roomFor)) Serial.println("op log could not be opened");
    if (FILE* sw = fopen("/littlefs/www/sw.js", "rb")) {
        std::string text(4096, '\0');
        text.resize(fread(&text[0], 1, text.size(), sw));
        fclose(sw);
        appVersion = osl::appVersionIn(text.data(), text.size());
    }
    Serial.printf("%s: %u ops, %u waiting to forward, logs %u bytes (each up to %u), %u libraries\n", nodeId.c_str(),
                  (unsigned)libraries.lastSeq(), (unsigned)libraries.waiting(), (unsigned)libraries.bytes(), (unsigned)maxBytes,
                  (unsigned)libraries.listed().size());

    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, strlen(AP_PASSWORD) ? AP_PASSWORD : nullptr, AP_CHANNEL, 0, AP_MAX_CLIENTS);
#if LIBRARY_HTTPS
    address = String("https://") + LIBRARY_DOMAIN;
#else
    // this network takes the library's own address, so the app's address is the same here
    IPAddress ip;
    if (ip.fromString(LIBRARY_ADDRESS)) WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0));
    else Serial.println("LIBRARY_ADDRESS in config.h is not an IP address");
    // phones look up a .local name by asking the network (mDNS), not the DNS server
    // below: answer as the library's name too, so http://osl.local opens here as at the Pi
    if (MDNS.begin(LIBRARY_NAME)) MDNS.addService("http", "tcp", LIBRARY_PORT);
    else Serial.println("mDNS failed to start: phones will need the address in numbers");
    address = String("http://") + LIBRARY_NAME + ".local";
    if (LIBRARY_PORT != 80) {
        address += ':';
        address += String(LIBRARY_PORT);
    }
#endif
    dns.setErrorReplyCode(DNSReplyCode::NoError);
    dns.start(53, "*", WiFi.softAPIP());  // every name is this board
    Serial.printf("Wi-Fi \"%s\" up; %s -> %s\n", AP_SSID, address.c_str(), WiFi.softAPIP().toString().c_str());

    static osl::ApiConfig cfg;
    cfg.nodeId = nodeId.c_str();
    cfg.address = address.c_str();
    cfg.secure = LIBRARY_HTTPS;
    cfg.maxOpBytes = osl::MAX_OP_BYTES;
    cfg.allow = allowAuthor;
    cfg.status = writeStatus;
    theApi = new osl::Api(libraries, cfg);

    if (!webStart()) Serial.println(LIBRARY_HTTPS ? "web server failed to start (missing /tls/cert.pem or /tls/key.pem? run uploadfs)"
                                                  : "web server failed to start");

    radioOk = io.begin();
    if (!radioOk) Serial.printf("radio init failed (%d): check pins in config.h\n", io.lastError());
    radioLink.onDeliver(onDeliver, nullptr);
    radioLink.onRemoteDurable(onRemoteDurable, nullptr);
}

void loop() {
    dns.processNextRequest();
    io.poll(radioLink);
    radioLink.tick();
    sendStatusIfDue();
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
