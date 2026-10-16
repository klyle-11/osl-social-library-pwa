# OSL radio link firmware (gate seven)

Two ESP32-S3 LoRa boards carry contributions between the library (the Pi) and a drop
point out in the neighbourhood, with no internet. Only ops travel by radio; photos and
files wait on the phone until it is back at the library.

```
 phones ──Wi-Fi──▶ DROP POINT ESP32 ))) LoRa ((( MODEM ESP32 ──USB──▶ Pi (node, RADIO_PORT)
       same address    stores ops in flash          frames + radio        the library: stores,
       as the library  forwards one at a time       stores nothing        sends its ops back out
                       hands out only the library's ops
```

## Do I need this? (one board vs two)

- **Everyone is where the Pi is:** no LoRa at all. Phones sync with the Pi over Wi-Fi.
- **People are somewhere the Pi's Wi-Fi doesn't reach:** you need **two** boards. Phones
  can't speak LoRa, so one board alone has nobody to talk to. One is the **modem**,
  plugged into the Pi; the other is the **drop point**, running its own Wi-Fi out where
  people are.
- **Several drop points** need addresses in the radio frames and relaying (TODO, "After that").
  Until then: one modem, one drop point.

## Hardware

| | Supported |
|---|---|
| Boards | **Seeed XIAO ESP32S3 + Wio-SX1262 kit**, **LilyGO T3-S3 (SX1262)**, Heltec WiFi LoRa 32 V3 |
| Antennas | 915 MHz, on each board's u.FL/IPEX connector |
| Power | Modem: USB from the Pi. Drop point: a USB power bank or 5 V supply |

Any two of these can talk to each other: same radio chip, same settings.
**Never power a LoRa board without its antenna connected.** Transmitting into nothing
can damage the radio.

## What's in here

| Path | What |
|---|---|
| `lib/osl_link/` | The radio link: fragments, CRC, STATUS bitmap, retransmit, POLL, DURABLE (store-and-forward). Plain C++. |
| `lib/osl_node/osl_store.*` | The drop point's op log in flash: append-only, a CRC on every line, survives power cuts. |
| `lib/osl_node/osl_ops.*` | Op validation: the app's rules (`core/ops.ts`), checked against the same cases (`core/fixtures/validation.json`). |
| `lib/osl_node/osl_api.*` | The drop point's answers to the app: the library's `/api/ops`, `/api/health`, `/api/info`, presence; another library's under `/api/l/<id>/`; `/api/unlock` for a protected one. |
| `lib/osl_node/osl_libraries.*` | The libraries a drop point carries: one log each (the main one where it always was), the list from the library, and which browsers gave a protected library's password. |
| `lib/osl_node/osl_crypto.*` | SHA-256 and PBKDF2, to check a library's password against the hash the library sends. Checked against hashes Node made (`core/fixtures/library-passwords.json`). |
| `lib/osl_modem/` | The modem's work without the board: lines from the Pi to radio messages and back. The board and the simulator both run it. |
| `src/common/lora_io.*` | SX1262 driver (RadioLib) with listen-before-talk |
| `src/modem/main.cpp` | Modem: USB serial ⇄ radio (`lib/osl_modem`), one JSON object per line. Stores nothing. |
| `src/droppoint/` | Drop point: Wi-Fi network, DNS, web server (`web.cpp` only moves requests to `osl_api`), forwarding |
| `include/config.h` | Frequency, power, pins, **the library's address**, Wi-Fi name, limits |
| `test/` | Desktop tests (`run.sh`), and the desktop drop point and modem used by `npm run rehearse:radio` (`sim/`) |

The Pi's side is `node/radio.ts` in the main project, started when the node has `RADIO_PORT`.

## Radio protocol

Each op is one message, cut into fragments of 200 bytes or less. A frame is at most 210 bytes:

```
[0x4F][type][message id: 4][...][CRC-16]
DATA     [index][count][payload ≤200]
STATUS   [count][bitmap: which fragments arrived]
POLL     [count]            "what do you have of this message?"
DURABLE                     "stored safely; you can delete your copy"
```

1. The sender transmits every fragment, then waits.
2. The receiver replies with STATUS, saying which fragments it has. The sender resends only the missing ones.
3. When all fragments are in, the receiver hands the op to storage, and only when storage confirms does it send DURABLE.
4. If a reply is lost, the sender POLLs, backing off from 4 s up to 60 s, and never gives up.

A message's first byte says what it is (`lib/osl_link/src/osl_kinds.h`):

| Kind | What | Payload |
|---|---|---|
| 1 | an op of the main library | the op's JSON |
| 2 | a drop point's heartbeat | `osl_status.h` |
| 3 | an op of another library | the library's id, a newline, the op's JSON |
| 4 | the libraries drop points carry (from the library) | `{"libs":[{"id","name","hash"}]}`: the hash is the password's PBKDF2, `""` when it has none |

Message ids are random, so a reboot never confuses an old message with a new one. Op ids make repeats harmless at both ends. The largest op the drop point takes is 4,000 bytes (20 fragments); a bigger one stays on the phone and goes to the library directly.

Default radio settings: 915 MHz, 500 kHz bandwidth, SF9, CR 4/7, 14 dBm: about 0.4 s of airtime per fragment, so roughly one note every few seconds in good conditions.

> The 500 kHz bandwidth meets US rules for a single fixed channel. **Check the rules for your country**, and your antenna's gain, before deploying.

## Where a drop point answers (read this before flashing one)

Phones keep their data per address: scheme, name and port. A drop point therefore answers at **exactly the address phones use for the library**, or the app there looks empty and the phone's waiting notes don't come along (README, W-D10). `include/config.h` has two ways:

- **`LIBRARY_HTTPS 0` (now, before the domain).** The library is `http://osl.local` (`LIBRARY_NAME`, port `LIBRARY_PORT` 80): the Pi named `osl`, running on port 80 (README, "On the Raspberry Pi"). The drop point answers the same name on its own Wi-Fi, so a phone that joins it finds the app where it always does. If the Pi runs on another port, set `LIBRARY_PORT` to match.
- **`LIBRARY_HTTPS 1` (Gate three).** The library is `https://LIBRARY_DOMAIN`, and the drop point serves the library's certificate from flash. This part is written but not yet built or tried.

The drop point also carries **the same build of the app as the Pi**. Build once (`npm run build:firmware`), start the Pi from that build, and flash the same files to the drop point. Both print the app version: they must match.

## Step by step

### 0. Tools (once)

```sh
pip install platformio        # or the PlatformIO extension in VS Code
export PATH="$HOME/.platformio/penv/bin:$PATH"
```

### 1. The modem (the board for the Pi)

```sh
cd firmware
pio run -e modem-xiao-s3 -t upload            # or modem-lilygo-t3s3, modem-heltec-v3
pio device monitor                            # within 30 s: {"t":"hello","role":"modem","radio":true,...}
```

Plug it into the Pi. A XIAO or LilyGO appears as `/dev/ttyACM0`, a Heltec as `/dev/ttyUSB0`. Start the node with it:

```sh
RADIO_PORT=/dev/ttyACM0 npm start
```

The node prints `radio on /dev/ttyACM0`; `http://<pi>:8080/api/radio` shows the modem and what has crossed. On Linux, add your user to the `dialout` group.

### 2. The drop point

Set `LIBRARY_ADDRESS` and `LIBRARY_PORT` in `include/config.h` to the Pi's, and give the drop point a name for the library's list (`DROP_NAME`, e.g. `"Community garden"`). Then:

```sh
npm run build:firmware                          # the app, as the Pi serves it, into firmware/data/
cd firmware
pio run -e droppoint-xiao-s3 -t uploadfs        # the app into flash
pio run -e droppoint-xiao-s3 -t upload          # the program
pio device monitor                              # a status line in JSON every 30 s
```

**`uploadfs` erases the whole file system, including the op log.** Before re-flashing the app, let everything cross the radio: the status line shows `"waitingToForward":0`. Updating only the program (`upload`) keeps the log.

### 3. Use it

1. Out at the drop point, join the **OSL Library** Wi-Fi network.
2. Open the app as usual (the same address as at the library). The header says **At a drop point**.
3. Write a note. It leaves the phone at once; the Sync screen lists it as **on the way by radio**.
4. It crosses the radio to the library. When the library's ops come back out, the note drops off that list: the phone now knows the library has it.

**Not at the drop point:** photos and files (they wait on the phone, with the document they belong to), pairing, the big screen.

### 4. The library's list of drop points

Every `STATUS_INTERVAL_S` seconds (120 by default) the drop point tells the library it's there: one radio fragment with its name, notes waiting to cross, phones using it, free flash, the app version it carries, and how well it hears the library. The modem adds how well the library hears it. On the Pi, **Sync → Drop points** (`#/droppoints`) lists the library and every drop point it has heard:

- **Connected**, while it's heard within 2½ of its own intervals (one lost heartbeat is normal on a radio link), or **Not heard since …**, kept on the list with its last figures.
- **Heard at the library / Hears the library**: the signal both ways, in words (strong, good, weak, barely) and in numbers (RSSI and SNR).
- **App**: whether it carries the library's build. If not, re-flash it (W-D10).

A paired presenter can take a retired drop point off the list; it comes back if it's heard again. The list lives in `data/droppoints.json`. Anything with the same radio settings can say it's a drop point (frames aren't signed yet), so every field is checked and the list is capped at 64.

### 5. Range: a drop point a mile away

A mile is reachable with these boards, but only with the antennas placed well: height and a clear line between the two matter far more than anything in the settings.

1. Set `STATUS_INTERVAL_S` to 30 while placing it, so the Drop points page updates every half minute; set it back to 120 after.
2. Put both antennas as high as you can, upright, by a window facing the other site if not outdoors.
3. Read **Heard at the library** and **Hears the library**. *Strong* or *good* (SNR 0 and up) is a link that will hold; *weak* will drop notes into retries; *barely* is about to fail.
4. If it's weak, in this order: raise the antennas; raise `LORA_POWER_DBM` (14 now, the SX1262 goes to 22) within your country's rules; raise `LORA_SF` to 10 or 11 on **both** boards (each step adds range and roughly doubles the time on air). In the US, keep `LORA_BW_KHZ` at 500: that is what lets a single fixed channel meet the FCC rules (see `config.h`).

### 6. Gate seven "done when"

With no internet anywhere: a phone writes at the drop point, the note crosses the radio, and it appears on a different phone at the Pi.

Then try to break it:
- Unplug the drop point mid-transfer and plug it back in. Nothing is lost, and it resumes where it left off.
- Unplug the modem, or stop the node. The drop point keeps polling and delivers once they're back, and the Drop points page shows it "not heard since" while it's away.
- Send the same note twice: it is stored once.

## Before the boards: rehearse it on a computer

```sh
npm run test:firmware        # link, op log, validation and API, on this computer
npm run rehearse:radio       # library + drop point + radio, with phones in headless Chrome
```

`rehearse:radio` compiles the drop point's and the modem's own code for the computer (`test/sim/`), joins them with a pretend radio, and walks a phone from the library to the drop point and back. It also checks the Drop points page: connected, not heard while out of range, connected again; and a protected library carried by the drop point: shut without its password, opened with it, a note written there reaching that library. It found the modem bug fixed in 0cd8cee (every op arriving as an unknown message).

## Status and limits

- **Tested on a computer:** the link over a simulated radio with up to 50% frame loss; the op log through power cuts and restarts; validation against the app's own cases; the drop point's API; the whole path, phone to drop point to radio to library and back, in `rehearse:radio`.
- **Not yet built for the boards here.** `src/droppoint/web.cpp` and `src/droppoint/main.cpp` (the board's web server and Wi-Fi) have not been through the ESP32 compiler since this port. Expect small fixes on the first `pio run`, and report the first error.
- **Memory:** the Heltec V3 has no PSRAM. Plain http allows 5 connections at a time; https allows 3, at about 40 KB each. If you see heap errors, lower `max_open_sockets` in `web.cpp`.
- **One link, one drop point,** until frames carry addresses.
- **Other libraries (W-D12):** a drop point carries the main library, and any other the node admin ticks on its Manage page ("Drop points carry this library"). The library sends the list (names, password hashes) when it changes and every ten minutes. A protected library asks for its password at the drop point (a second or so on the board) and is open to that browser until the drop point restarts. Five wrong tries in a minute make it wait. Accounts stay at the library. A library taken off the list is shut at once and its log erased once what phones left in it has gone on. **Its notes and its password's hash are in the board's flash:** anyone who takes the board can read them and try passwords at their own pace. Rehearsed in `rehearse:radio`; not yet on a board.
