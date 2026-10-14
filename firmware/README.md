# OSL radio link firmware (gate seven)

Two ESP32-S3 LoRa boards carry contributions between the archive and a drop point
out in the neighbourhood, with no internet. Only ops travel by radio; photos and
files wait on the phone until it reaches the archive.

```
 phones ──Wi-Fi/HTTPS──▶ DROP POINT ESP32 ))) LoRa ((( MODEM ESP32 ──USB──▶ Pi (server.js)
          same address     stores ops in flash           stores nothing        the archive:
          as the archive   forwards one at a time        frames + radio        stores, moderates,
                           shows only archive-approved                         sends approved ops back
```

## Do I need this? (one board vs two)

- **Everyone is in the same place as the Pi:** no LoRa at all. Phones sync with
  the Pi over Wi-Fi (gates 1–6). That's the whole product.
- **People are somewhere the Pi's Wi-Fi doesn't reach:** you need **two** boards.
  Phones can't speak LoRa, so a single board has nobody to talk to over the radio.
  One board is the **modem**, plugged into the Pi. The other is the **drop point**,
  which runs its own Wi-Fi out where people are.
- **Several drop points** would need one link per drop point, or mesh networking.
  Both are out of scope for gate seven (see the parking lot in `docs/`).

## Hardware

| | Default | Also supported |
|---|---|---|
| Board ×2 | **Heltec WiFi LoRa 32 V3** (ESP32-S3 + SX1262, 8 MB flash) | LilyGO T3-S3 SX1262 (check pins in `include/config.h`) |
| Antenna ×2 | 915 MHz antenna on the board's u.FL/IPEX connector | |
| Power | Modem: USB from the Pi. Drop point: USB power bank or 5 V supply | |

**Never power a LoRa board on without its antenna connected.** Transmitting
into nothing can damage the radio.

## What's in here

| Path | What |
|---|---|
| `lib/osl_link/` | The radio link: fragments, CRC, have-bitmap STATUS, retransmit, POLL, DURABLE (store-and-forward). Plain C++. |
| `lib/osl_node/` | Drop point storage (append-only op log with a per-line CRC in flash), op validation (same rules as `src/contract.js`), `/sync` handling. Plain C++. |
| `src/common/lora_io.*` | SX1262 driver (RadioLib) with listen-before-talk |
| `src/modem/main.cpp` | Modem: USB serial ⇄ radio, one JSON object per line. Stores nothing. |
| `src/droppoint/` | Drop point: Wi-Fi network, DNS, HTTPS app + `/sync`, flash storage, forwarding |
| `include/config.h` | Frequency, power, pins, library address, Wi-Fi name, limits |
| `test/` | Desktop tests: link over a simulated lossy radio, and the drop point's storage and `/sync` |

The Pi side lives in the main project: `radio-bridge.js` (enabled by `RADIO_PORT`).

## Radio protocol

Each op is sent as one message, cut into fragments of 200 bytes or less. A frame is at most 210 bytes:

```
[0x4F][type][message id: 4][...][CRC-16]
DATA     [index][count][payload ≤200]
STATUS   [count][bitmap: which fragments arrived]
POLL     [count]            "what do you have of this message?"
DURABLE                     "stored safely; you can delete your copy"
```

1. The sender transmits every fragment, then waits.
2. The receiver replies with STATUS, saying which fragments it has. The sender resends only the missing ones.
3. When all fragments have arrived, the receiver passes the op to storage. Only when storage confirms does it send DURABLE.
4. If any reply is lost, the sender POLLs, backing off from 4 s up to 60 s, and never gives up.

Message ids are random 32-bit numbers, so a reboot never confuses an old message with a new one. Op ids make repeats harmless at both ends.

Sizes, from the decision map in the docs: the maximum frame payload is **200 bytes**. The maximum op is **4,000 bytes**, which is 20 fragments. Retransmission starts after **4 s**.

Default radio settings: 915 MHz, 500 kHz bandwidth, SF9, CR 4/7, 14 dBm. With these, one comment takes about 0.4 s of airtime per fragment. Expect roughly one op every 3–5 seconds in good conditions.

> The 500 kHz bandwidth is there to meet US rules for a single fixed channel. **Check the rules for your country**, and your antenna gain, before deploying. Lower SF (7–8) is faster with less range; higher SF (10–12) gives more range but is slower.

## Step by step

### 0. Tools (once)

```sh
pip install platformio        # or the PlatformIO extension in VS Code
npm run test:firmware         # desktop tests, no board needed
```

### 1. Choose the address and certificate

The drop point must use **exactly the same address as the archive**: same name and port 443, with the same certificate. Phones keep their data per address. A different address would look like a different, empty app, and the outbox wouldn't come along.

1. Set `LIBRARY_DOMAIN` in `include/config.h`, for example `library.example.org`.
2. Get a certificate for that name. Use one of:
   - **Real:** Let's Encrypt with the DNS-01 challenge (see the main README). Phones trust it with no setup.
   - **Testing:** run `npm run cert -- osl.lan` with `LIBRARY_DOMAIN "osl.lan"`. Each test phone then needs the dev CA installed and trusted (see `TESTING.md`).
3. At the archive, run the Pi on port 443 under that name. Phones must look the name up and get the Pi's IP, through your router's DNS or dnsmasq on the Pi:
   ```sh
   sudo PORT=443 TLS_CERT=... TLS_KEY=... RADIO_PORT=/dev/ttyUSB0 node server.js
   ```
   At the drop point, the board answers every DNS name with itself, so there's nothing to set up there.

### 2. Flash the modem (the board for the Pi)

```sh
cd firmware
pio run -e modem-heltec-v3 -t upload
pio device monitor            # within 30 s you should see {"t":"hello","role":"modem","radio":true,...}
```

Plug it into the Pi. A Heltec appears as `/dev/ttyUSB0`; a LilyGO appears as `/dev/ttyACM0`. Start the server with `RADIO_PORT` set to that device. On Linux, add your user to the `dialout` group.

### 3. Flash the drop point

```sh
npm run build:firmware                          # app + certificate into firmware/data/
cd firmware
pio run -e droppoint-heltec-v3 -t uploadfs      # files into flash
pio run -e droppoint-heltec-v3 -t upload        # the program
pio device monitor                              # every 30 s it prints a status line in JSON
```

Re-run `npm run build:firmware` and `uploadfs` whenever the app or the certificate changes. **`uploadfs` erases the whole filesystem, including the op log**, so first let everything cross the radio: the status line shows `"waitingToForward":0` when it's done. Updating only the program (`upload`) keeps the log.

### 4. Use it

1. Join the **OSL Library** Wi-Fi network on a phone.
2. Open `https://LIBRARY_DOMAIN`. The app loads from the board. If it isn't installed yet, install it as usual.
3. Contributions sync to the drop point. The app shows *"at the drop point, on its way to the archive"*.
4. They then cross the radio one at a time. On the Pi, check `https://LIBRARY_DOMAIN/status` and look under `radio`.
5. When an op comes back from the archive, the app shows *"saved at the archive"*.

**Not at the drop point:**
- Photos and files. The phone keeps them and uploads them at the archive.
- Other people's contributions, until the archive has approved them and sent them back. The drop point is a write-only inbox. To change that, set `SHARE_LOCAL_CONTRIBUTIONS 1`.

### 5. Gate seven "done when"

With no internet anywhere:
1. A phone contributes while offline.
2. It syncs at the drop point.
3. The op crosses the radio and appears on a **different phone at the Pi**.

Then try to break it:
- Unplug the drop point mid-transfer and plug it back in. Nothing is lost, and the transfer resumes where it left off.
- Unplug the modem, or stop `server.js`. The drop point keeps polling and delivers once they're back.
- Send the same op twice: the Pi's `/status` still shows `ops` = `uniqueIds`.

## Status and limits

- **Built and tested here:** the link layer passed a simulated radio with up to 50% frame loss, corruption and duplicates. The drop point's storage and `/sync` passed tests including a power cut mid-write and a restart. The Pi's bridge and per-node cursors have tests in `npm test`.
- **Not yet run on real boards.** The board-specific code has only been checked against stand-ins for the Arduino and ESP-IDF APIs, not compiled with the real ESP32 toolchain. Expect to fix small things on your first `pio run`. Report the first error you hit.
- **Memory:** the Heltec V3 has no PSRAM. HTTPS allows 3 connections at a time, at about 40 KB each. If you see `heap` errors, set `max_open_sockets = 2` in `web.cpp`.
- **One link, one drop point.** No mesh networking, by design.
