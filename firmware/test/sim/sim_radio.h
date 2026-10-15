// A pretend radio for the desktop simulators: each frame is one UDP datagram on
// localhost, optionally lost on the way. The link layer above it (osl_link) is the
// real one, the same code the boards run.
#pragma once
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <random>

#include "../../lib/osl_link/src/osl_link.h"

class SimRadio : public osl::LinkIO {
   public:
    // listen on `myPort`, send to `peerPort`; `loss` is the share of frames that vanish (0..1)
    SimRadio(int myPort, int peerPort, double loss = 0) : loss_(loss), rng_(std::random_device{}()) {
        fd_ = socket(AF_INET, SOCK_DGRAM, 0);
        sockaddr_in me{};
        me.sin_family = AF_INET;
        me.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        me.sin_port = htons(myPort);
        if (fd_ < 0 || bind(fd_, (sockaddr*)&me, sizeof me) != 0) {
            perror("radio: bind");
            exit(1);
        }
        fcntl(fd_, F_SETFL, O_NONBLOCK);
        peer_ = me;
        peer_.sin_port = htons(peerPort);
    }

    bool transmit(const uint8_t* frame, size_t len) override {
        if (off) return true;  // radio silence: the frame is lost, as on air
        if (std::uniform_real_distribution<double>(0, 1)(rng_) >= loss_) sendto(fd_, frame, len, 0, (sockaddr*)&peer_, sizeof peer_);
        return true;
    }
    uint32_t millis() override {
        using namespace std::chrono;
        return (uint32_t)duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
    }
    uint32_t random32() override { return rng_(); }

    // hand every frame that arrived to the link
    void poll(osl::Link& link) {
        uint8_t buf[512];
        ssize_t n;
        while ((n = recv(fd_, buf, sizeof buf, 0)) > 0) {
            if (!off) link.onFrame(buf, (size_t)n);
        }
    }
    int fd() const { return fd_; }

    bool off = false;  // out of range: nothing sent or heard

   private:
    int fd_;
    sockaddr_in peer_;
    double loss_;
    std::mt19937 rng_;
};

// Faster than on air, so a rehearsal takes seconds rather than minutes.
inline osl::LinkTimings simTimings() {
    osl::LinkTimings t;
    t.statusWaitMs = 800;
    t.durableWaitMs = 3000;
    t.maxBackoffMs = 4000;
    t.rxQuietMs = 300;
    t.redeliverMs = 5000;
    return t;
}
