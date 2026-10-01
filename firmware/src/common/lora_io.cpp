#include "lora_io.h"

#include <RadioLib.h>
#include <SPI.h>

#include "config.h"

static SX1262 radio = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RST, PIN_LORA_BUSY, SPI);
static volatile bool irq = false;

static void IRAM_ATTR onDio1() { irq = true; }

bool LoRaIO::begin() {
    SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
    lastError_ = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR, LORA_SYNC_WORD, LORA_POWER_DBM, LORA_PREAMBLE, LORA_TCXO_V);
    if (lastError_ != RADIOLIB_ERR_NONE) return false;
    radio.setDio2AsRfSwitch(true);
    radio.setCRC(2);  // hardware CRC as well as the link's own
    radio.setPacketReceivedAction(onDio1);
    irq = false;
    lastError_ = radio.startReceive();
    return lastError_ == RADIOLIB_ERR_NONE;
}

void LoRaIO::poll(osl::Link& link) {
    if (!irq) return;
    irq = false;
    uint8_t buf[osl::MAX_FRAME];
    size_t len = radio.getPacketLength();
    if (len > 0 && len <= sizeof buf) {
        int16_t st = radio.readData(buf, len);
        if (st == RADIOLIB_ERR_NONE) {
            lastRssi_ = radio.getRSSI();
            lastSnr_ = radio.getSNR();
            link.onFrame(buf, len);
        }
    }
    radio.startReceive();
}

bool LoRaIO::transmit(const uint8_t* frame, size_t len) {
    // Listen before talk: if someone is mid-packet, back off and let the link retry.
    int16_t cad = radio.scanChannel();
    irq = false;  // CAD-done also raises DIO1
    if (cad == RADIOLIB_LORA_DETECTED) {
        radio.startReceive();
        return false;
    }
    lastError_ = radio.transmit(frame, len);
    irq = false;  // TX-done raised DIO1 too; it is not a received packet
    radio.startReceive();
    return lastError_ == RADIOLIB_ERR_NONE;
}
