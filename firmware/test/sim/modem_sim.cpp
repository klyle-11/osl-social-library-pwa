// The Pi's LoRa modem, on a computer: the same USB-serial protocol as
// firmware/src/modem/main.cpp, on a pseudo-terminal the node opens with RADIO_PORT,
// and the real link layer over a pretend radio (sim_radio.h).
//   modem_sim <my udp port> <drop point's udp port> [loss 0..1]
// Prints the pseudo-terminal's path on its first line.
#include <ArduinoJson.h>
#include <fcntl.h>
#include <poll.h>
#include <stdlib.h>
#include <termios.h>
#include <unistd.h>

#include <deque>
#include <string>

#include "sim_radio.h"

static constexpr uint8_t KIND_OP = 1;  // as lora_io.h

static int pty = -1;
static osl::Link* radioLink;

struct Outgoing {
    std::string id, msg;
};
static std::deque<Outgoing> queue;
static uint32_t inflightMsg = 0;
static std::string inflightId;

static void out(const std::string& line) {
    std::string l = line + "\n";
    if (write(pty, l.data(), l.size()) < 0) { /* nobody listening yet: as a board with no Pi */ }
}

static void logLine(const char* msg) {
    JsonDocument d;
    d["t"] = "log";
    d["msg"] = msg;
    std::string s;
    serializeJson(d, s);
    out(s);
}

static void hello() {
    out("{\"t\":\"hello\",\"role\":\"modem\",\"radio\":true,\"sim\":true}");
}

static void onDeliver(void*, uint32_t msgId, const uint8_t* data, size_t len) {
    if (len < 2 || data[0] != KIND_OP) {
        logLine("dropped a radio message of an unknown kind");
        radioLink->markDurable(msgId);
        return;
    }
    JsonDocument check;
    if (deserializeJson(check, (const char*)data + 1, len - 1) || !check.is<JsonObject>()) {
        logLine("dropped a message that is not a JSON op");
        radioLink->markDurable(msgId);
        return;
    }
    out("{\"t\":\"recv\",\"m\":" + std::to_string(msgId) + ",\"op\":" + std::string((const char*)data + 1, len - 1) + "}");
}

static void onRemoteDurable(void*, uint32_t msgId) {
    if (msgId != inflightMsg) return;
    JsonDocument d;
    d["t"] = "sent";
    d["id"] = inflightId;
    std::string s;
    serializeJson(d, s);
    out(s);
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
        if (inflightId == id) return;
        for (auto& o : queue)
            if (o.id == id) return;
        if (queue.size() >= 8) return logLine("queue full");
        Outgoing o;
        o.id = id;
        // ArduinoJson 7's serializeJson replaces a string's contents rather than appending,
        // so the op goes into its own string first; the kind byte must stay in front.
        std::string json;
        serializeJson(d["op"], json);
        o.msg.push_back((char)KIND_OP);
        o.msg += json;
        if (o.msg.size() > osl::MAX_MESSAGE) return logLine("op too large for the radio link");
        queue.push_back(o);
    } else if (!strcmp(t, "durable")) {
        radioLink->markDurable(d["m"].as<uint32_t>());
    } else if (!strcmp(t, "ping")) {
        hello();
    }
}

int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: modem_sim <my udp port> <peer udp port> [loss]\n");
        return 2;
    }
    SimRadio io(atoi(argv[1]), atoi(argv[2]), argc > 3 ? atof(argv[3]) : 0);
    osl::Link link(io, simTimings());
    radioLink = &link;
    link.onDeliver(onDeliver, nullptr);
    link.onRemoteDurable(onRemoteDurable, nullptr);

    pty = posix_openpt(O_RDWR | O_NOCTTY);
    if (pty < 0 || grantpt(pty) || unlockpt(pty)) {
        perror("pty");
        return 1;
    }
    termios tio;
    tcgetattr(pty, &tio);
    cfmakeraw(&tio);
    tcsetattr(pty, TCSANOW, &tio);
    printf("%s\n", ptsname(pty));
    fflush(stdout);
    // Hold the other end open too, so the pty never hangs up while the node isn't
    // connected (as a USB board stays powered with nobody reading it).
    int keep = open(ptsname(pty), O_RDWR | O_NOCTTY);
    (void)keep;

    std::string line;
    for (;;) {
        pollfd fds[2] = {{pty, POLLIN, 0}, {io.fd(), POLLIN, 0}};
        poll(fds, 2, 20);
        if (fds[0].revents & POLLIN) {
            char buf[1024];
            ssize_t n = read(pty, buf, sizeof buf);
            for (ssize_t i = 0; i < n; i++) {
                if (buf[i] == '\n') {
                    if (!line.empty()) handleLine(line);
                    line.clear();
                } else if (buf[i] != '\r' && line.size() < 12000) {
                    line.push_back(buf[i]);
                }
            }
        }
        io.poll(link);
        link.tick();
        if (!link.busy() && !inflightMsg && !queue.empty()) {
            Outgoing& o = queue.front();
            inflightMsg = link.send((const uint8_t*)o.msg.data(), o.msg.size());
            if (inflightMsg) inflightId = o.id;
            queue.pop_front();
        }
    }
}
