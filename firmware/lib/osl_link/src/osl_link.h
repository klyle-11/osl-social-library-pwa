// Reliable, store-and-forward message link over LoRa (gate seven).
//
// Plain C++ with no Arduino dependencies, so the same code runs on both
// ESP32-S3 boards and in the desktop simulator (firmware/test/link_sim.cpp).
//
// One message (one op) is in flight per direction at a time. A message is cut
// into fragments; the receiver reports which fragments it has (STATUS); the
// sender resends only the missing ones; once the receiver's upper layer has
// stored the message durably it says so (DURABLE) and only then does the
// sender let go. Lost STATUS/DURABLE frames are recovered by POLL.
//
// Radio frame layout (all little endian, max 255 bytes):
//   [0]    0x4F magic
//   [1]    type: 1 DATA, 2 STATUS, 3 DURABLE, 4 POLL
//   [2..5] message id (random u32)
//   DATA:    [6] fragment index, [7] fragment count, [8..] payload
//   STATUS:  [6] fragment count, [7..10] bitmap of fragments held
//   POLL:    [6] fragment count
//   DURABLE: (nothing more)
//   last 2 bytes: CRC-16/CCITT-FALSE over everything before it

#pragma once
#include <stddef.h>
#include <stdint.h>

namespace osl {

constexpr uint8_t MAGIC = 0x4F;
constexpr size_t MAX_FRAME = 255;
constexpr size_t FRAG_PAYLOAD = 200;  // 8 header + 200 + 2 crc = 210 bytes per frame
constexpr size_t MAX_FRAGS = 24;      // bitmap fits in 32 bits
constexpr size_t MAX_MESSAGE = FRAG_PAYLOAD * MAX_FRAGS;  // 4800 bytes

enum FrameType : uint8_t { DATA = 1, STATUS = 2, DURABLE = 3, POLL = 4 };

uint16_t crc16(const uint8_t* data, size_t len);

// What the link needs from the board.
class LinkIO {
   public:
    virtual ~LinkIO() {}
    // Transmit one frame. Return false if the channel is busy; it will be retried.
    virtual bool transmit(const uint8_t* frame, size_t len) = 0;
    virtual uint32_t millis() = 0;
    virtual uint32_t random32() = 0;
};

struct LinkTimings {
    uint32_t statusWaitMs = 4000;     // after sending fragments, how long to wait for STATUS
    uint32_t durableWaitMs = 15000;   // after a full STATUS, how long to wait for DURABLE
    uint32_t maxBackoffMs = 60000;    // retry interval cap (keeps trying forever)
    uint32_t rxQuietMs = 2500;        // receiver sends STATUS after this long with no new fragment
    uint32_t redeliverMs = 30000;     // forget an undurable delivery after this, so it is sent again
};

struct LinkStats {
    uint32_t framesSent = 0, framesReceived = 0, badFrames = 0;
    uint32_t messagesSent = 0, messagesDelivered = 0, retransmits = 0, polls = 0;
};

class Link {
   public:
    typedef void (*DeliverFn)(void* ctx, uint32_t msgId, const uint8_t* data, size_t len);
    typedef void (*DurableFn)(void* ctx, uint32_t msgId);

    Link(LinkIO& io, LinkTimings t = LinkTimings()) : io_(io), t_(t) {}

    void onDeliver(DeliverFn fn, void* ctx) { deliver_ = fn; deliverCtx_ = ctx; }
    void onRemoteDurable(DurableFn fn, void* ctx) { durable_ = fn; durableCtx_ = ctx; }

    // Outgoing side. send() returns the message id, or 0 if busy / too big.
    bool busy() const { return tx_.state != TX_IDLE; }
    uint32_t send(const uint8_t* data, size_t len);

    // Incoming side. Call markDurable once the delivered message is safely stored.
    void markDurable(uint32_t msgId);

    // Feed every received radio frame here, and call tick() often.
    void onFrame(const uint8_t* frame, size_t len);
    void tick();

    const LinkStats& stats() const { return stats_; }

   private:
    enum TxState { TX_IDLE, TX_SENDING, TX_WAIT_STATUS, TX_WAIT_DURABLE };
    struct Tx {
        TxState state = TX_IDLE;
        uint32_t id = 0;
        uint8_t buf[MAX_MESSAGE];
        size_t len = 0;
        uint8_t count = 0;
        uint32_t toSend = 0;   // bitmap of fragments still to transmit this round
        uint32_t deadline = 0;
        uint8_t rounds = 0;    // consecutive timeouts, for backoff
    } tx_;

    struct Rx {
        uint32_t id = 0;
        uint8_t count = 0;
        uint32_t have = 0;
        uint8_t buf[MAX_MESSAGE];
        size_t lastLen = 0;    // length of the final fragment
        uint32_t statusDue = 0;
    } rx_;

    struct Pending { uint32_t id; uint32_t at; };
    static constexpr size_t PENDING = 8, DONE = 64, CTRL = 8;
    Pending pending_[PENDING] = {};   // delivered, not yet durable
    uint32_t done_[DONE] = {};        // recently durable (ring)
    size_t doneNext_ = 0;

    uint8_t ctrl_[CTRL][16];          // queued control frames
    size_t ctrlLen_[CTRL] = {};
    size_t ctrlCount_ = 0;

    LinkIO& io_;
    LinkTimings t_;
    LinkStats stats_;
    DeliverFn deliver_ = nullptr;
    void* deliverCtx_ = nullptr;
    DurableFn durable_ = nullptr;
    void* durableCtx_ = nullptr;

    static bool due(uint32_t now, uint32_t at) { return (int32_t)(now - at) >= 0; }
    static uint32_t full(uint8_t count) { return count >= 32 ? 0xFFFFFFFFu : ((1u << count) - 1); }
    uint32_t backoff(uint32_t base);
    bool isDone(uint32_t id) const;
    int findPending(uint32_t id) const;

    void queueCtrl(uint8_t type, uint32_t id, uint8_t count = 0, uint32_t bitmap = 0);
    bool sendFragment(uint8_t index);
    void handleData(uint32_t id, const uint8_t* f, size_t len);
    void sendStatusFor(uint32_t id, uint8_t count);
};

}  // namespace osl
