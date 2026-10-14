#include "osl_link.h"

#include <string.h>

namespace osl {

uint16_t crc16(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++) crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    return crc;
}

static void put32(uint8_t* p, uint32_t v) {
    p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24;
}
static uint32_t get32(const uint8_t* p) {
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}
static size_t seal(uint8_t* f, size_t len) {
    uint16_t c = crc16(f, len);
    f[len] = c >> 8;
    f[len + 1] = c & 0xFF;
    return len + 2;
}

uint32_t Link::backoff(uint32_t base) {
    uint32_t ms = base << (tx_.rounds < 4 ? tx_.rounds : 4);
    if (ms > t_.maxBackoffMs) ms = t_.maxBackoffMs;
    return ms + io_.random32() % (ms / 4 + 1);  // jitter so both ends don't collide forever
}

bool Link::isDone(uint32_t id) const {
    for (size_t i = 0; i < DONE; i++)
        if (done_[i] == id && id) return true;
    return false;
}

int Link::findPending(uint32_t id) const {
    for (size_t i = 0; i < PENDING; i++)
        if (pending_[i].id == id && id) return (int)i;
    return -1;
}

uint32_t Link::send(const uint8_t* data, size_t len) {
    if (busy() || len == 0 || len > MAX_MESSAGE) return 0;
    uint32_t id;
    do id = io_.random32(); while (id == 0);
    memcpy(tx_.buf, data, len);
    tx_.id = id;
    tx_.len = len;
    tx_.count = (len + FRAG_PAYLOAD - 1) / FRAG_PAYLOAD;
    tx_.toSend = full(tx_.count);
    tx_.rounds = 0;
    tx_.state = TX_SENDING;
    stats_.messagesSent++;
    return id;
}

void Link::markDurable(uint32_t msgId) {
    int p = findPending(msgId);
    if (p >= 0) pending_[p].id = 0;
    if (!isDone(msgId)) {
        done_[doneNext_] = msgId;
        doneNext_ = (doneNext_ + 1) % DONE;
    }
    queueCtrl(DURABLE, msgId);
}

void Link::queueCtrl(uint8_t type, uint32_t id, uint8_t count, uint32_t bitmap) {
    if (ctrlCount_ == CTRL) {  // drop the oldest; the peer will POLL again
        memmove(ctrl_[0], ctrl_[1], sizeof(ctrl_[0]) * (CTRL - 1));
        memmove(ctrlLen_, ctrlLen_ + 1, sizeof(ctrlLen_[0]) * (CTRL - 1));
        ctrlCount_--;
    }
    uint8_t* f = ctrl_[ctrlCount_];
    f[0] = MAGIC;
    f[1] = type;
    put32(f + 2, id);
    size_t n = 6;
    if (type == STATUS) {
        f[6] = count;
        put32(f + 7, bitmap);
        n = 11;
    } else if (type == POLL) {
        f[6] = count;
        n = 7;
    }
    ctrlLen_[ctrlCount_++] = seal(f, n);
}

bool Link::sendFragment(uint8_t index) {
    uint8_t f[MAX_FRAME];
    size_t off = (size_t)index * FRAG_PAYLOAD;
    size_t n = tx_.len - off < FRAG_PAYLOAD ? tx_.len - off : FRAG_PAYLOAD;
    f[0] = MAGIC;
    f[1] = DATA;
    put32(f + 2, tx_.id);
    f[6] = index;
    f[7] = tx_.count;
    memcpy(f + 8, tx_.buf + off, n);
    size_t len = seal(f, 8 + n);
    if (!io_.transmit(f, len)) return false;
    stats_.framesSent++;
    return true;
}

void Link::sendStatusFor(uint32_t id, uint8_t count) {
    if (isDone(id)) return queueCtrl(DURABLE, id);
    if (findPending(id) >= 0) return queueCtrl(STATUS, id, count, full(count));
    if (rx_.id == id) return queueCtrl(STATUS, id, rx_.count, rx_.have);
    queueCtrl(STATUS, id, count, 0);  // never heard of it: send everything
}

void Link::handleData(uint32_t id, const uint8_t* f, size_t len) {
    uint8_t index = f[6], count = f[7];
    size_t n = len - 10;
    if (count == 0 || count > MAX_FRAGS || index >= count || n > FRAG_PAYLOAD) return;
    if (index + 1 < count && n != FRAG_PAYLOAD) return;

    if (isDone(id)) return queueCtrl(DURABLE, id);    // our DURABLE was lost
    if (findPending(id) >= 0) return queueCtrl(STATUS, id, count, full(count));

    if (rx_.id != id || rx_.count != count) {  // a new message replaces any unfinished one
        rx_.id = id;
        rx_.count = count;
        rx_.have = 0;
    }
    memcpy(rx_.buf + (size_t)index * FRAG_PAYLOAD, f + 8, n);
    if (index == count - 1) rx_.lastLen = n;
    rx_.have |= 1u << index;

    if (rx_.have != full(count)) {
        // Last fragment seen (or quiet for a while): report what we have.
        rx_.statusDue = index == count - 1 ? io_.millis() : io_.millis() + t_.rxQuietMs;
        if (!rx_.statusDue) rx_.statusDue = 1;
        return;
    }

    // Complete. Remember it as pending, then hand it up.
    rx_.statusDue = 0;
    rx_.id = 0;
    size_t total = (size_t)(count - 1) * FRAG_PAYLOAD + rx_.lastLen;
    int slot = 0;
    for (size_t i = 0; i < PENDING; i++)
        if (!pending_[i].id || due(io_.millis(), pending_[i].at + t_.redeliverMs)) { slot = (int)i; break; }
    pending_[slot] = {id, io_.millis()};
    stats_.messagesDelivered++;
    if (deliver_) deliver_(deliverCtx_, id, rx_.buf, total);
    if (findPending(id) >= 0) queueCtrl(STATUS, id, count, full(count));  // not durable yet
}

void Link::onFrame(const uint8_t* f, size_t len) {
    if (len < 8 || f[0] != MAGIC || crc16(f, len - 2) != (uint16_t)(f[len - 2] << 8 | f[len - 1])) {
        stats_.badFrames++;
        return;
    }
    stats_.framesReceived++;
    uint32_t id = get32(f + 2);
    switch (f[1]) {
        case DATA:
            if (len >= 11) handleData(id, f, len);
            break;
        case POLL: {
            if (len < 9) break;
            int p = findPending(id);
            if (p >= 0 && due(io_.millis(), pending_[p].at + t_.redeliverMs)) {
                pending_[p].id = 0;  // upper layer never confirmed: forget it so it gets resent
            }
            sendStatusFor(id, f[6]);
            break;
        }
        case STATUS: {
            if (len < 13 || id != tx_.id || tx_.state == TX_IDLE || tx_.state == TX_SENDING) break;
            uint32_t missing = ~get32(f + 7) & full(tx_.count);
            tx_.rounds = 0;
            if (missing) {
                tx_.toSend = missing;
                tx_.state = TX_SENDING;
                stats_.retransmits++;
            } else {
                tx_.state = TX_WAIT_DURABLE;
                tx_.deadline = io_.millis() + backoff(t_.durableWaitMs);
            }
            break;
        }
        case DURABLE:
            if (id == tx_.id && tx_.state != TX_IDLE) {
                tx_.state = TX_IDLE;
                tx_.id = 0;
                if (durable_) durable_(durableCtx_, id);
            }
            break;
        default:
            stats_.badFrames++;
    }
}

void Link::tick() {
    uint32_t now = io_.millis();

    // 1. Control frames first: they are short and unblock the other side.
    while (ctrlCount_) {
        if (!io_.transmit(ctrl_[0], ctrlLen_[0])) return;
        stats_.framesSent++;
        memmove(ctrl_[0], ctrl_[1], sizeof(ctrl_[0]) * (CTRL - 1));
        memmove(ctrlLen_, ctrlLen_ + 1, sizeof(ctrlLen_[0]) * (CTRL - 1));
        ctrlCount_--;
    }

    // 2. Receiver: report progress after the burst ends.
    if (rx_.statusDue && due(now, rx_.statusDue)) {
        rx_.statusDue = 0;
        queueCtrl(STATUS, rx_.id, rx_.count, rx_.have);
        return;
    }

    // 3. Sender.
    switch (tx_.state) {
        case TX_SENDING:
            for (uint8_t i = 0; i < tx_.count; i++) {
                if (!(tx_.toSend & (1u << i))) continue;
                if (!sendFragment(i)) return;  // channel busy: try next tick
                tx_.toSend &= ~(1u << i);
                return;  // one frame per tick keeps the loop responsive
            }
            tx_.state = TX_WAIT_STATUS;
            tx_.deadline = io_.millis() + backoff(t_.statusWaitMs);
            break;
        case TX_WAIT_STATUS:
        case TX_WAIT_DURABLE:
            if (due(now, tx_.deadline)) {
                tx_.rounds++;
                stats_.polls++;
                queueCtrl(POLL, tx_.id, tx_.count);
                tx_.deadline = now + backoff(tx_.state == TX_WAIT_STATUS ? t_.statusWaitMs : t_.durableWaitMs);
            }
            break;
        default:
            break;
    }
}

}  // namespace osl
