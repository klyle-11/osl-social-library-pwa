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
#elif defined(BOARD_XIAO_S3_WIO)
// Seeed XIAO ESP32S3 with the Wio-SX1262 board from the "XIAO ESP32S3 & Wio-SX1262 kit"
// (the one that snaps on through the board-to-board connector). Pins as in Meshtastic's
// seeed_xiao_s3 variant. A Wio-SX1262 from a different kit is wired differently.
#define PIN_LORA_NSS 41
#define PIN_LORA_SCK 7
#define PIN_LORA_MOSI 9
#define PIN_LORA_MISO 8
#define PIN_LORA_RST 42
#define PIN_LORA_BUSY 40
#define PIN_LORA_DIO1 39
#define PIN_LORA_RXEN 38  // antenna switch: high to receive. DIO2 switches it to transmit.
#define LORA_TCXO_V 1.8
#else
#error "Pick a board in platformio.ini (BOARD_HELTEC_V3, BOARD_LILYGO_T3S3 or BOARD_XIAO_S3_WIO) or add its pins here"
#endif

// ---------- Drop point: the library's address ----------
// Phones keep their data per address (scheme, name and port), so a drop point must
// answer at exactly the address phones use for the library, or it looks like a
// different, empty app (README, W-D10).
//   LIBRARY_HTTPS 0: before the domain. Plain http at the Pi's fixed address and port.
//                    The drop point's own Wi-Fi network takes that address, so phones
//                    joined to it reach the board where they'd reach the Pi.
//   LIBRARY_HTTPS 1: https://LIBRARY_DOMAIN on port 443, with the library's certificate
//                    in flash (Gate three).
#define LIBRARY_HTTPS 0
#define LIBRARY_ADDRESS "192.168.1.50"   // the Pi's fixed address (a DHCP reservation on the router)
#define LIBRARY_PORT 8080                // the port the node runs on (PORT, 8080 by default)
#define LIBRARY_DOMAIN "library.example.org"

// What the library calls this drop point in its list (You → Sync → Drop points).
#define DROP_NAME "Drop point"
// How often it tells the library it's there, in seconds. One radio fragment each time;
// shorter (30) while setting up or testing range, longer to save airtime.
#define STATUS_INTERVAL_S 120

#define AP_SSID "OSL Library"
#define AP_PASSWORD ""      // "" = open network; or 8+ characters for WPA2
#define AP_CHANNEL 6
#define AP_MAX_CLIENTS 8

#define OPS_RESERVE_BYTES (64 * 1024)  // flash kept free; the op log may use the rest (~1 MB = ~3000 ops)
#define OPS_PER_AUTHOR_PER_HOUR 300  // spam guard per device
#define API_MAX_BODY (32 * 1024)     // largest request accepted (the app sends ops in batches of about 8 KB)
