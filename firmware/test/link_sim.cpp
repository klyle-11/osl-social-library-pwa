// Desktop simulation of the LoRa link: two Link instances over a fake radio that
// drops, corrupts and duplicates frames, with a virtual clock. Checks that every
// message in both directions arrives intact and is confirmed durable.
//
//   sh firmware/test/run.sh
#include <algorithm>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <map>
#include <string>
#include <vector>

#include "../lib/osl_link/src/osl_link.h"

using namespace osl;

static uint32_t clockMs = 0;
static uint32_t rng = 12345;
static uint32_t rnd() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; }

struct Air;
struct End : LinkIO {
    Air* air; int side;
    bool transmit(const uint8_t* f, size_t len) override;
    uint32_t millis() override { return clockMs; }
    uint32_t random32() override { return rnd(); }
};

struct Air {
    double loss, corrupt, dup;
    std::deque<std::vector<uint8_t>> toSide[2];
    uint32_t sent = 0;
};

bool End::transmit(const uint8_t* f, size_t len) {
    if (rnd() % 100 < 5) return false;  // channel busy sometimes
    air->sent++;
    clockMs += 2 + len * 2;              // airtime
    if (rnd() % 1000 < air->loss * 1000) return true;
    std::vector<uint8_t> v(f, f + len);
    if (rnd() % 1000 < air->corrupt * 1000) v[rnd() % len] ^= 0x5A;
    air->toSide[1 - side].push_back(v);
    if (rnd() % 1000 < air->dup * 1000) air->toSide[1 - side].push_back(v);
    return true;
}

struct Upper {
    Link* link;
    std::map<std::string, int> received;  // payload -> times delivered
    std::vector<uint32_t> durableLater;   // simulate slow storage (the Pi)
    bool slow;
    int confirmed = 0;
};

static void onDeliver(void* ctx, uint32_t id, const uint8_t* d, size_t n) {
    Upper* u = (Upper*)ctx;
    u->received[std::string((const char*)d, n)]++;
    if (u->slow) u->durableLater.push_back(id);
    else u->link->markDurable(id);
}
static void onDurable(void* ctx, uint32_t) { ((Upper*)ctx)->confirmed++; }

static std::string makeMsg(int side, int i) {
    std::string s = "{\"id\":\"side" + std::to_string(side) + ":" + std::to_string(i) + "\",\"body\":\"";
    size_t len = 20 + rnd() % 2500;  // 1 to 13 fragments
    while (s.size() < len) s += (char)('a' + rnd() % 26);
    return s + "\"}";
}

static int run(double loss, double corrupt, double dup, int perSide) {
    Air air;
    air.loss = loss; air.corrupt = corrupt; air.dup = dup;
    End e0, e1;
    e0.air = e1.air = &air;
    e0.side = 0; e1.side = 1;
    Link l0(e0), l1(e1);
    Upper u0{&l0, {}, {}, false}, u1{&l1, {}, {}, true};  // side 1 is the "Pi": durable comes later
    l0.onDeliver(onDeliver, &u0); l0.onRemoteDurable(onDurable, &u0);
    l1.onDeliver(onDeliver, &u1); l1.onRemoteDurable(onDurable, &u1);

    std::vector<std::string> out[2];
    for (int i = 0; i < perSide; i++) { out[0].push_back(makeMsg(0, i)); out[1].push_back(makeMsg(1, i)); }
    size_t next[2] = {0, 0};
    Link* links[2] = {&l0, &l1};
    Upper* ups[2] = {&u0, &u1};

    for (long step = 0; step < 60000000; step++) {
        for (int s = 0; s < 2; s++) {
            if (!links[s]->busy() && next[s] < out[s].size() && ups[s]->confirmed == (int)next[s]) {
                const std::string& m = out[s][next[s]++];
                assert(links[s]->send((const uint8_t*)m.data(), m.size()));
            }
            while (!air.toSide[s].empty()) {
                auto f = air.toSide[s].front(); air.toSide[s].pop_front();
                links[s]->onFrame(f.data(), f.size());
            }
            links[s]->tick();
        }
        if (step % 50 == 0 && !u1.durableLater.empty()) {  // the Pi confirms in batches
            for (uint32_t id : u1.durableLater) l1.markDurable(id);
            u1.durableLater.clear();
        }
        clockMs += 1;
        if (u0.confirmed == perSide && u1.confirmed == perSide) break;
    }

    int ok = 1;
    for (int s = 0; s < 2; s++) {
        Upper* rx = ups[1 - s];
        for (auto& m : out[s])
            if (!rx->received.count(m)) { printf("  side %d message missing\n", s); ok = 0; }
        if (ups[s]->confirmed != perSide) { printf("  side %d: only %d/%d confirmed durable\n", s, ups[s]->confirmed, perSide); ok = 0; }
        for (auto& kv : rx->received)
            if (std::find(out[s].begin(), out[s].end(), kv.first) == out[s].end()) { printf("  corrupted message delivered!\n"); ok = 0; }
    }
    const LinkStats& a = l0.stats();
    printf("%s loss=%.0f%% corrupt=%.0f%% dup=%.0f%%: %d msgs each way, %u frames, %u retransmits, %u polls, %.1f min simulated\n",
           ok ? "PASS" : "FAIL", loss * 100, corrupt * 100, dup * 100, perSide, air.sent, a.retransmits + l1.stats().retransmits,
           a.polls + l1.stats().polls, clockMs / 60000.0);
    return ok;
}

int main() {
    int ok = 1;
    ok &= run(0.0, 0.0, 0.0, 40);
    ok &= run(0.10, 0.02, 0.02, 40);
    ok &= run(0.30, 0.05, 0.05, 40);
    ok &= run(0.50, 0.05, 0.10, 20);
    return ok ? 0 : 1;
}
