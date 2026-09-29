# Testing OSL

This is gate four's laptop check and gate five's phone test from
`docs/RR00_The_Whole_Route_Builders_Bridge.md`, written as steps you can follow.

## 0. Set up (once)

```sh
npm install
npm run build
npm test                 # contract + node tests (merge, idempotency, restart durability, media hashes)
npm run cert             # dev certificate for your LAN IPs  (add a hostname: npm run cert -- library.example.org)
npm run start:https      # https on :8443, plain http on :8080 (serves the CA + redirects)
```

The server prints the addresses phones can use, e.g. `https://192.168.1.20:8443/`.

In a second terminal, add some seed content (running it twice is fine):

```sh
NODE_EXTRA_CA_CERTS=certs/ca.pem npm run seed -- https://localhost:8443
```

**Check the node at any time:** open `https://<address>:8443/status`. `ops` must always equal `uniqueIds`.
The app's **This device → Check the node** button shows the same numbers.

## 1. Laptop check (gate four "done when")

Use Chrome with `https://localhost:8443` or `npm start` → `http://localhost:8080`.

1. Open the app. Go to **This device** and confirm *Secure context: yes* and *Service worker: active* (reload once if it says installing).
2. DevTools → Network → **Offline**.
3. Add an item with a file, write an annotation, and make a collection. Each one says *(waiting to send)*.
4. Close the tab and reopen the address. Everything is still there. Add one more annotation.
5. Turn Offline off. The header goes to **0 waiting to send**.
6. Open `/status`. Each operation is there exactly once (`ops` = `uniqueIds`).

## 2. Put the certificate on each test phone

Phones must be on the same Wi-Fi as the laptop or Pi. You can skip this step when you use a real Let's Encrypt certificate (see README).

**iPhone / iPad**
1. In **Safari**, open `http://<LAN-IP>:8080/ca.pem` and allow the download (*This website is trying to download a configuration profile*).
2. Settings → **Profile Downloaded** → Install (enter passcode) → Install.
3. Settings → General → About → **Certificate Trust Settings** → turn on **OSL Dev CA**.
4. Open `https://<LAN-IP>:8443`. The page should load with no warning.

**Android**
1. In Chrome, open `http://<LAN-IP>:8080/ca.pem` to download it.
2. Settings → Security & privacy → More security settings → Encryption & credentials → **Install a certificate** → **CA certificate** → Install anyway → pick the downloaded file.
   (The menu names differ a little between brands. You can also search Settings for "CA certificate".)
3. Open `https://<LAN-IP>:8443` in Chrome. The page should load with no warning.

If a phone shows a warning, re-run `npm run cert` while the phone's Wi-Fi is up. The certificate has to include the IP address you're typing.

## 3. The phone matrix (gate five)

Run every case on one **iPhone** (installed from Safari with Share → Add to Home Screen) and one **Android** phone (installed from Chrome with ⋮ → Install app, or the **Install app** button). Always open OSL **from the home-screen icon**.
After each case, go to **This device → Copy test report** and paste the report into your log with the result.

| # | Case | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| 1 | Install to home screen | Open the address → install as above → open from the icon | Opens full-screen with no address bar. *This device* says **Installed: yes**, **Service worker: active** | | |
| 2 | Airplane mode: browse a taken collection | Collections → **Welcome shelf** → **Take this collection with me** → wait for *ready to use offline* → airplane mode → open both items and their files | Items, annotations and files all open | | |
| 3 | Airplane mode: add item with photo, comment, name collection | Still in airplane mode: **Add item** with a camera photo and a description → open it → add an annotation → add it to a **New collection…** | Each one shows *(waiting to send)* and the header count goes up | | |
| 4 | Force-quit, reopen | Swipe OSL away in the app switcher → reopen from the icon (still in airplane mode) | Everything from case 3 is still there and still *waiting* | | |
| 5 | Restart the phone | Restart → open from the icon (still in airplane mode) | Same as case 4 | | |
| 6 | Several days offline | Leave it 3+ days without opening it (airplane mode optional) → reopen | Same as case 4. Note the *Persistent storage* value | | |
| 7 | Return and sync | Turn airplane mode off, rejoin the Wi-Fi, open OSL | Header shows **0 waiting to send** and items say *(saved at the archive)*. `/status` has the new ops | | |
| 8 | Same op sent twice → one record | This device → **Check the node** (note the count) → **Send everything again** → **Sync now** → **Check the node** | The count doesn't change and it says **no duplicates** | | |
| 9 | Two phones at once | Both phones offline → each adds an annotation to the same item → both go online and open OSL → pull to refresh / **Sync now** on both | Both annotations appear on both phones. `/status` shows both devices | | |
| 10 | Save my collection | Collections → **Save / share collection file** → iPhone: *Save to Files*; Android: save to Downloads or Drive. Then on the other phone (offline is fine): **Import a collection file** | The file saves. The import shows *Imported N operations and M file(s)* and the files open | | |
| 11 | Screen reader adds a description | Turn on VoiceOver / TalkBack → **Add item** → fill Title and **Description**, attach a file, save | Every field is read out with its label, and the saved item shows its description | | |
| 12 | Android Private DNS | *Only with the Pi's own DNS name.* Android Settings → Network → **Private DNS** set to Automatic, then to a provider (e.g. dns.google) → open `https://library.example.org` | With **Automatic**, it resolves to the Pi. If a named provider breaks it, write down the workaround: "set Private DNS to Off or Automatic while at the archive" | | |

### Known platform behaviour (not bugs)

- **iPhone doesn't sync in the background.** The outbox waits until OSL is opened again.
- **iPhone Safari tabs** can lose their data after 7 days without use. The home-screen app doesn't, so test from the icon.
- **Persistent storage** can say *not granted* in a browser tab. It's usually granted once the app is installed or used regularly.
- A service worker update shows up **on the second open** after you deploy a new build (stale-while-revalidate).

## 4. The log line

After each session, write one line:

> Gate five. Case 4 passes on iPhone 13 (iOS 18) and Pixel 7. Test reports attached. Next: case 6, leave both offline until Friday.
