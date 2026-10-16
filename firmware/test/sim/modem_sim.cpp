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

#include <string>

#include "../../lib/osl_modem/src/osl_modem.h"
#include "sim_radio.h"

static int pty = -1;
static SimRadio* radioIO;
static osl::ModemRelay* relay;

static void out(void*, const std::string& line) {
    std::string l = line + "\n";
    if (write(pty, l.data(), l.size()) < 0) { /* nobody listening yet: as a board with no Pi */ }
}

static void hello() {
    out(nullptr, "{\"t\":\"hello\",\"role\":\"modem\",\"radio\":true,\"sim\":true}");
}

static void onDeliver(void*, uint32_t msgId, const uint8_t* data, size_t len) { relay->deliver(msgId, data, len, radioIO->rssi, radioIO->snr); }
static void onRemoteDurable(void*, uint32_t msgId) { relay->remoteDurable(msgId); }

int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: modem_sim <my udp port> <peer udp port> [loss]\n");
        return 2;
    }
    SimRadio io(atoi(argv[1]), atoi(argv[2]), argc > 3 ? atof(argv[3]) : 0);
    osl::Link link(io, simTimings());
    radioIO = &io;
    osl::ModemRelay r(link, out, nullptr);
    relay = &r;
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
                    if (!line.empty() && relay->line(line)) hello();
                    line.clear();
                } else if (buf[i] != '\r' && line.size() < 12000) {
                    line.push_back(buf[i]);
                }
            }
        }
        io.poll(link);
        link.tick();
        relay->pump();
    }
}
