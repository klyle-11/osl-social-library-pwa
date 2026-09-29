# OSL — Offline Social Library

A community library you can take with you on your phone. Built as a
Preact progressive web app (PWA) with plain HTML and no CSS. It opens and works with
no signal on iPhone and Android, and syncs with the archive node over HTTPS
when it can reach it.

The design follows `docs/RR00_The_Whole_Route_Builders_Bridge.md` (gates 1–4).

## What's here

| File | Role |
|---|---|
| `index.html` | App page. PWA and iOS home-screen meta tags. No stylesheet. |
| `manifest.webmanifest` | Name, icons, `display: standalone` (makes "Add to Home Screen" / "Install" work) |
| `sw.js` | Service worker: pre-caches the app shell, serves it offline, and caches media by hash |
| `src/contract.js` | Gate 1: op schemas (from the annotation types), `merge`, derived views, bundle format. Pure functions. |
| `src/db.js` | IndexedDB op log + outbox (one transaction per op), media in Cache Storage, `storage.persist()` |
| `src/sync.js` | `/sync` exchange with the node: on open, when the network returns, and when the app comes to the foreground |
| `src/bundle.js` | "Save my collection": a single `.osl.json` file (ops + media) sent to the share sheet; import on another phone |
| `src/app.jsx` | Preact UI: library, add item, item + annotations, collections, device status |
| `server.js` | The node: static files, `/sync`, `/media/<sha256>`, durable append-only op log. HTTP or HTTPS. No dependencies. |
| `scripts/dev-cert.sh` | Local CA + certificate for testing on phones over Wi-Fi |
| `scripts/seed.js` | Seed content (items, files, a collection) for testing and the workshop |
| `test/` | Contract and node tests (`npm test`) |
| `TESTING.md` | Laptop check + the gate-five phone matrix, step by step |
| `index.tsx`, `types.d.ts`, `data.json`, `styles.css`, `tsconfig.json` | The original annotation-project sketches, kept as they were. The app is built from `src/`. `styles.css` is linked but empty, so there's still no CSS. |

### Annotation types → operations

| Annotation project | OSL op |
|---|---|
| `Document` (url, hash, fileType, `properties`: title/author/subtitle/type) | `item` |
| `Annotation` (body, `access`: public/private/anonymous, attachments, links) | `comment` targeting an item |
| `Collection` | `add-to-collection` and `name-collection` (last writer wins; owner only) |
| — | `hide` (moderation; nothing is ever deleted) |

Every op has an ID of the form `deviceId:counter`, so phones can't produce the same ID. Merging is a set union by ID. The order of merges doesn't matter, and repeating one changes nothing.

## Run it

```sh
npm install
npm run build          # bundles src/ → dist/app.js
npm start              # http://localhost:8080 (localhost counts as secure, so offline works)
npm test
npm run seed           # optional: sample items + a "Welcome shelf" collection
```

**To test on phones, follow [TESTING.md](TESTING.md).**

`npm run watch` rebuilds when files change. Data is stored in `./data/` (`ops.jsonl` + `media/`).

## HTTPS

Phones only allow service workers (offline mode) on **HTTPS**. There are two ways to set it up:

### 1. Testing on phones over your Wi-Fi (self-signed local CA)

```sh
npm run cert                 # certs/ca.pem, cert.pem, key.pem  (adds your LAN IPs)
npm run start:https          # https://<your-LAN-IP>:8443, and http://<LAN-IP>:8080/ca.pem for phones
```

Trust the CA on each test phone (once). Download it from `http://<LAN-IP>:8080/ca.pem`:

- **iPhone/iPad:** open that address in Safari → Settings → *Profile Downloaded* → Install →
  Settings → General → About → **Certificate Trust Settings** → turn on full trust for "OSL Dev CA".
- **Android:** Settings → Security → Encryption & credentials → Install a certificate → **CA certificate** → pick `ca.pem`
  (Chrome trusts user-installed CAs).

Then open `https://<LAN-IP>:8443` on the phone.

### 2. The archive node (no internet, no warnings)

Use a real domain and a **Let's Encrypt** certificate obtained with the **DNS-01** challenge (for example `certbot` or `lego` with your DNS provider's plugin). The node never needs to be reachable from the internet. Point the name at the node's LAN IP with a local DNS resolver (dnsmasq on the Pi, or the router's DNS). Phones already trust Let's Encrypt, so they show the padlock even when the internet is unplugged.

```sh
sudo PORT=443 HTTP_REDIRECT_PORT=80 \
  TLS_CERT=/etc/letsencrypt/live/library.example.org/fullchain.pem \
  TLS_KEY=/etc/letsencrypt/live/library.example.org/privkey.pem \
  node server.js
```

Plan how you'll renew. Certificates last 90 days or less.

## Take it offline

**Install:**

- **Android (Chrome):** tap **Install app** in OSL, or open the ⋮ menu → *Install app*.
- **iPhone/iPad (Safari):** tap **Share** → **Add to Home Screen**. Open OSL from the icon, not from a Safari tab. Home-screen apps keep their data, while Safari tabs can be cleared after 7 days without use.

**What works with no signal:**

- Opening the app, browsing, and searching.
- Adding items, including files, which are hashed with SHA-256 and stored on the device.
- Writing annotations, making collections, and hiding content.
- Everything you create is marked *waiting to send* and is sent exactly once the next time the app is open and can reach the node. iOS never syncs in the background, so open the app when you're at the archive.

**Collections:**

- **Take this collection with me:** downloads every file in the collection onto the phone.
- **Save / share collection file:** creates one `.osl.json` file and opens the share sheet (Save to Files, AirDrop, Nearby Share…).
- **Import a collection file:** works fully offline. The ops it contains are also passed on to the node at the next sync.

The **This device** tab has testing tools (Check the node, Send everything again, Copy test report) and shows HTTPS / service worker / install / persistent-storage status. Use it for the gate-five phone test.

## Notes

- To force every phone to re-download the whole app shell, bump `SHELL_CACHE` in `sw.js`. Normal updates already reach phones the next time they open the app online (stale-while-revalidate).
- Only items that have an uploaded file can be taken offline. Items that are just a link stay links.
- Authorization (roles) on the node is not implemented yet. The node accepts any valid op.
