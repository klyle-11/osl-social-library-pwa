// The modem's work, without the board: lines from the Pi become radio messages, and
// radio messages become lines for the Pi. The board (src/modem/main.cpp) and the
// simulator (test/sim/modem_sim.cpp) both run this, so what the rehearsal tests is
// what the board does.
//
// USB serial protocol, one JSON object per line:
//   Pi -> modem   {"t":"send","id":"<op id>","op":{...}}           the main library's op, for the drop point
//                 {"t":"send","id":"<op id>","l":"<library>","op":{...}}   another library's
//                 {"t":"libs","libs":[{"id","name","hash"}]}         the libraries drop points carry
//                 {"t":"durable","m":<msg>}                          the Pi has stored message <msg>
//                 {"t":"ping"}
//   modem -> Pi   {"t":"recv","m":<msg>,"op":{...}}                  an op arrived (+ "l" for another library);
//                                                                    reply "durable" once stored
//                 {"t":"sent","id":"<op id>"}                         the drop point has stored it durably
//                 {"t":"status","rssi":..,"snr":..,"status":{...}}    a drop point's heartbeat
//                 {"t":"log","msg":"..."}
#pragma once
#include <stddef.h>
#include <stdint.h>

#include <deque>
#include <string>

#include "osl_link.h"

namespace osl {

class ModemRelay {
   public:
    typedef void (*Out)(void* ctx, const std::string& line);   // one line to the Pi, without the newline
    ModemRelay(Link& link, Out out, void* ctx) : link_(link), out_(out), ctx_(ctx) {}

    // a line from the Pi; "ping" returns true (the caller says hello)
    bool line(const std::string& l);
    // a message from the radio, and how it was heard
    void deliver(uint32_t msgId, const uint8_t* data, size_t len, float rssi, float snr);
    // the drop point has stored what we sent
    void remoteDurable(uint32_t msgId);
    // sends the next waiting message when the link is free; call it every loop
    void pump();
    size_t queued() const { return queue_.size() + (inflight_ ? 1 : 0); }

    static const size_t MAX_QUEUE = 8;

   private:
    struct Outgoing {
        std::string id, msg;
    };
    Link& link_;
    Out out_;
    void* ctx_;
    std::deque<Outgoing> queue_;
    uint32_t inflight_ = 0;
    std::string inflightId_;
    void log(const char* msg);
};

}  // namespace osl
