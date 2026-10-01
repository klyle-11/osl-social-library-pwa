// RadioLib SX1262 driver behind the link's LinkIO interface.
#pragma once
#include <Arduino.h>

#include "osl_link.h"

class LoRaIO : public osl::LinkIO {
   public:
    bool begin();
    // Hand any received frame to the link. Call every loop.
    void poll(osl::Link& link);

    bool transmit(const uint8_t* frame, size_t len) override;
    uint32_t millis() override { return ::millis(); }
    uint32_t random32() override { return esp_random(); }

    int16_t lastError() const { return lastError_; }
    float lastRssi() const { return lastRssi_; }
    float lastSnr() const { return lastSnr_; }

   private:
    int16_t lastError_ = 0;
    float lastRssi_ = 0, lastSnr_ = 0;
};

// Both roles tag the first byte of every link message with its kind.
constexpr uint8_t KIND_OP = 1;
