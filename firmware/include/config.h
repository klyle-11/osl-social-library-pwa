// Settings for both boards. Change these, then rebuild.
#pragma once

// ---------- Radio (must be identical on both boards) ----------
// US 902-928 MHz ISM band. 500 kHz bandwidth is used so a single fixed channel
// fits the FCC digital-modulation rules (no 400 ms dwell limit). Check the rules
// for your country and your antenna before deploying; this is your responsibility.
#define LORA_FREQ_MHZ 915.0
#define LORA_BW_KHZ 500.0
#define LORA_SF 9            // higher = longer range, slower (7..12)
#define LORA_CR 7            // coding rate 4/7
#define LORA_SYNC_WORD 0x12  // private network
#define LORA_POWER_DBM 14    // up to 22 on SX1262; start low, raise if range needs it
#define LORA_PREAMBLE 8

// ---------- Pins ----------
#if defined(BOARD_HELTEC_V3)
#define PIN_LORA_NSS 8
#define PIN_LORA_SCK 9
#define PIN_LORA_MOSI 10
#define PIN_LORA_MISO 11
#define PIN_LORA_RST 12
#define PIN_LORA_BUSY 13
#define PIN_LORA_DIO1 14
#define LORA_TCXO_V 1.8
#elif defined(BOARD_LILYGO_T3S3)
// LilyGO T3-S3 with SX1262. Check against your board revision's pinout.
#define PIN_LORA_NSS 7
#define PIN_LORA_SCK 5
#define PIN_LORA_MOSI 6
#define PIN_LORA_MISO 3
#define PIN_LORA_RST 8
#define PIN_LORA_BUSY 34
#define PIN_LORA_DIO1 33
#define LORA_TCXO_V 1.8
#else
#error "Pick a board in platformio.ini (BOARD_HELTEC_V3 or BOARD_LILYGO_T3S3) or add its pins here"
#endif

// ---------- Drop point ----------
// The library's address. It MUST be the same name (and port 443) as the archive
// node, with the same certificate: phones keep their data per address, so a
// different name would look like a different app with an empty outbox.
#define LIBRARY_DOMAIN "library.example.org"

#define AP_SSID "OSL Library"
#define AP_PASSWORD ""      // "" = open network; or 8+ characters for WPA2
#define AP_CHANNEL 6
#define AP_MAX_CLIENTS 8

#define OPS_RESERVE_BYTES (64 * 1024)  // flash kept free; the op log may use the rest (~1 MB = ~3000 ops)
#define OPS_PER_AUTHOR_PER_HOUR 300  // spam guard per device
#define SHARE_LOCAL_CONTRIBUTIONS 0  // 1 = phones here see each other's ops before the archive approves them
#define SYNC_MAX_BODY (16 * 1024)    // largest /sync request accepted (the app sends batches of 10 ops)
