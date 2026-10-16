// A rehearsal of TODO.md's "Device and network testing", before doing it with real
// devices: two phones, a presenter laptop and the big screen, in headless Chrome,
// against a node of its own with scratch data (your data/ is not touched).
//   npm run rehearse                        (builds first; takes about three minutes)
//   CHROME=/usr/bin/chromium npm run rehearse   (on the Pi, or to pick a browser)
// It can't tell you what real phones do (Safari, seeking film, VoiceOver, Wi-Fi):
// those checks stay on the TODO list. It tells you the node and app are ready for them.
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = mkdtempSync(join(tmpdir(), 'osl-rehearsal-'));
const PORT = Number(process.env.REHEARSAL_PORT ?? 8092);
const BASE = `http://localhost:${PORT}/`;
const LOG = join(ROOT, 'data', 'ops.jsonl');

mkdirSync(join(ROOT, 'data'), { recursive: true });
symlinkSync(join(REPO, 'dist'), join(ROOT, 'dist'), 'junction');

let node = null;
function startNode() {
  node = spawn('node', [join(REPO, 'dist-node/server.mjs')], { env: { ...process.env, PORT: String(PORT), OSL_CODE: '123456', OSL_ROOT: ROOT }, stdio: ['ignore', 'pipe', 'pipe'] });
  node.out = '';
  node.stdout.on('data', (d) => (node.out += d));
  node.stderr.on('data', (d) => (node.out += d));
  return new Promise((ok) => {
    const t0 = Date.now();
    const poll = async () => {
      try { if ((await fetch(BASE + 'api/health')).ok) return ok(true); } catch {}
      if (node.exitCode !== null || Date.now() - t0 > 5000) return ok(false);
      setTimeout(poll, 100);
    };
    poll();
  });
}
function stopNode() { return new Promise((ok) => { if (!node || node.exitCode !== null) return ok(); node.once('exit', ok); node.kill(); }); }

const results = [];
function report(name, pass, detail = '') { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
async function within(ms, fn) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Date.now() - t0; } catch {} await new Promise((r) => setTimeout(r, 100)); } return null; }

const errors = [];
async function device(browser, name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(BASE);
  await page.waitForSelector('.header');
  return { ctx, page, name };
}
const noteText = (page) => page.$$eval('.annotation-thread__body', (els) => els.map((e) => e.textContent));
const hasNote = async (page, text) => (await noteText(page)).includes(text);
// on a phone the notes dock along the bottom is where a note is written; on a wide screen, the form
async function post(page, text) {
  await page.waitForSelector('.annotation-form__body, .notes-dock__input', { state: 'attached' });
  if (await page.locator('.annotation-form__body').isVisible()) {
    await page.fill('.annotation-form__body', text);
    await page.click('.annotation-form__submit');
  } else {
    await page.fill('.notes-dock__input', text);
    await page.click('.notes-dock__send');
  }
}
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);
const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function pair(page, role) {
  await go(page, '#/you');
  await page.fill('.you__pair .you__pair-input[inputmode=numeric]', '123456');
  await page.selectOption('.you__pair select', role);
  await page.click('.you__pair button[type=submit]');
}
function logIds() { return existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter((l) => { try { JSON.parse(l); return true; } catch { return false; } }).map((l) => JSON.parse(l).id) : []; }

if (!(await startNode())) { console.log(node.out); process.exit(1); }
// the browser Playwright knows, else the one named in CHROME, else an installed Google Chrome
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  .catch(() => chromium.launch({ channel: 'chrome' }))
  .catch(() => { console.log('No Chrome or Chromium found. Install Google Chrome, or set CHROME to a Chromium binary.'); process.exit(1); });
const A = await device(browser, 'phoneA', devices['iPhone 13']);
const B = await device(browser, 'phoneB', devices['Pixel 7']);
const L = await device(browser, 'laptop', { viewport: { width: 1280, height: 800 } });
const S = await device(browser, 'screen', { viewport: { width: 1920, height: 1080 } });
await go(S.page, '#/present');

// 1. layout on phones
for (const d of [A, B]) {
  await go(d.page, '#/'); await d.page.waitForTimeout(300);
  const g = await fitsWidth(d.page);
  await go(d.page, '#/document/steward%3A1'); await d.page.waitForSelector('.single-document__title');
  const r = await fitsWidth(d.page);
  report(`${d.name}: no sideways scroll on gallery and reader`, g && r, `gallery ${g}, reader ${r}`);
}

// 2. presence: "also viewing"
let t = await within(6000, async () => (await A.page.textContent('.single-document__viewing'))?.includes('also viewing'));
report('A sees "also viewing" while B has the same document open', t !== null, t !== null ? `${t} ms` : 'never');
await go(B.page, '#/');
t = await within(8000, async () => !(await A.page.$('.single-document__viewing')));
report('"also viewing" goes away when B leaves the document', t !== null, t !== null ? `${t} ms` : 'still shown after 8 s');
await go(B.page, '#/document/steward%3A1');

// 3. a note reaches the other phone and the big screen
await post(A.page, 'Note from phone A');
t = await within(5000, () => hasNote(B.page, 'Note from phone A'));
report('A\'s note appears on B within 3 s', t !== null && t <= 3000, t !== null ? `${t} ms` : 'never');
t = await within(5000, async () => (await S.page.$$eval('.present__note-body', (e) => e.map((x) => x.textContent))).includes('Note from phone A'));
report('A\'s note appears on the big screen within 3 s', t !== null && t <= 3000, t !== null ? `${t} ms` : 'never');

// 4. presenter: pair, show, follow
await pair(L.page, 'presenter');
await within(3000, async () => (await L.page.evaluate(() => localStorage.length)) >= 0);
await go(L.page, '#/document/steward%3A2'); await L.page.waitForSelector('.single-document__show', { timeout: 5000 }).catch(() => {});
const showBtn = await L.page.$('.single-document__show');
report('a paired laptop gets "Show on the screen"', !!showBtn);
if (showBtn) {
  await showBtn.click();
  const title2 = await L.page.textContent('.single-document__title');
  t = await within(5000, async () => (await S.page.textContent('.present__title')) === title2);
  report('the big screen moves to the shown document', t !== null, t !== null ? `${t} ms` : 'never');
  t = await within(5000, async () => !!(await B.page.$('.now-showing')));
  report('B gets the "On the screen now" banner', t !== null, t !== null ? `${t} ms` : 'never');
  await B.page.check('.now-showing__follow input');
  t = await within(5000, async () => (await B.page.evaluate(() => location.hash)) === '#/document/steward%3A2');
  report('"Follow the screen" moves B to the shown document', t !== null, t !== null ? `${t} ms` : await B.page.evaluate(() => location.hash));
  await go(L.page, '#/document/steward%3A3'); await L.page.waitForSelector('.single-document__show');
  await L.page.click('.single-document__show');
  t = await within(6000, async () => (await B.page.evaluate(() => location.hash)) === '#/document/steward%3A3');
  report('B follows when the screen moves again', t !== null, t !== null ? `${t} ms` : await B.page.evaluate(() => location.hash));
  await B.page.uncheck('.now-showing__follow input').catch(() => {});
}
const noToken = await fetch(BASE + 'api/showing', { method: 'POST', body: JSON.stringify({ documentId: 'steward:1' }) });
report('showing without a token is refused (403)', noToken.status === 403, String(noToken.status));

// 5. offline on the phone: waits, then sends
await go(A.page, '#/document/steward%3A1'); await A.page.waitForSelector('.annotation-form__body', { state: 'attached' });
await A.ctx.setOffline(true);
await post(A.page, 'Written offline on A');
await go(A.page, '#/sync'); await A.page.waitForSelector('.sync-screen');
t = await within(4000, async () => (await A.page.textContent('.sync-screen__list'))?.includes('Written offline on A'));
report('offline: the note is listed as waiting on the Sync screen', t !== null);
t = await within(4000, async () => /offline|can't reach/.test(await A.page.textContent('.sync-screen__state')));
report('offline: the Sync screen says so', t !== null, t !== null ? `${t} ms` : (await A.page.textContent('.sync-screen__state')).trim());
await A.ctx.setOffline(false);
t = await within(20000, async () => (await A.page.textContent('.sync-screen__route')).includes('0 waiting'));
report('back online: the waiting note is sent', t !== null, t !== null ? `${t} ms` : 'still waiting after 20 s');
await go(B.page, '#/document/steward%3A1');
t = await within(6000, () => hasNote(B.page, 'Written offline on A'));
report('back online: B gets the offline note', t !== null);

// 6. pause
await go(B.page, '#/sync'); await B.page.waitForSelector('.sync-screen');
await B.page.click('.sync-screen__button--quiet');
await go(B.page, '#/document/steward%3A4'); await B.page.waitForSelector('.annotation-form__body', { state: 'attached' });
await post(B.page, 'Paused note 1'); await B.page.waitForTimeout(200); await post(B.page, 'Paused note 2');
await go(B.page, '#/sync'); await B.page.waitForSelector('.sync-screen');
await B.page.waitForTimeout(3000);
const waitingPaused = await B.page.$$eval('.sync-screen__item', (e) => e.length);
report('paused: two notes wait and are not sent', waitingPaused === 2 && !readFileSync(LOG, 'utf8').includes('Paused note'), `${waitingPaused} waiting`);
await B.page.click('.sync-screen__button--quiet');
t = await within(8000, async () => readFileSync(LOG, 'utf8').includes('Paused note 2'));
report('resumed: the paused notes reach the node', t !== null, t !== null ? `${t} ms` : 'not sent');

// 7. the node stops for a while, notes are written meanwhile, then it comes back
await stopNode();
await go(A.page, '#/document/steward%3A1'); await A.page.waitForSelector('.annotation-form__body', { state: 'attached' });
await post(A.page, 'Written while the node was down');
await A.page.waitForTimeout(20000);
const headerDown = await A.page.textContent('.header');
await startNode();
t = await within(25000, async () => readFileSync(LOG, 'utf8').includes('Written while the node was down'));
report('node back: the note written while it was down arrives', t !== null, t !== null ? `${t} ms after restart` : 'not after 25 s');
const ids = logIds();
report('node back: nothing doubled in the log', new Set(ids).size === ids.length, `${ids.length} ops, ${new Set(ids).size} distinct`);
await go(B.page, '#/document/steward%3A1');
t = await within(20000, () => hasNote(B.page, 'Written while the node was down'));
report('node back: B gets it', t !== null, t !== null ? `${t} ms` : 'never');

// 8. the node's log is started clean (README: "Delete data/ to start clean")
await stopNode();
rmSync(join(ROOT, 'data'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'data'));
await go(A.page, '#/document/steward%3A5');
await startNode();
// pushed the instant the node is back, before any phone has polled it
await fetch(BASE + 'api/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ id: 'sim:1', type: 'annotation', user: 'sim', target: 'steward:5', timestamp: new Date().toISOString(), access: 'public', body: 'First note after a clean start' }] }) });
t = await within(10000, () => hasNote(A.page, 'First note after a clean start'));
report('clean start: phones that were open still get new notes', t !== null, t !== null ? `${t} ms` : 'A never got it');

// 9. ten-plus devices: 30 simulated pollers alongside the browsers for 20 s
{
  const lat = [];
  let fail = 0;
  const stop = Date.now() + 20000;
  await Promise.all(Array.from({ length: 30 }, async (_, i) => {
    let cursor = '0';
    while (Date.now() < stop) {
      const t0 = performance.now();
      try {
        const r = await fetch(`${BASE}api/ops?after=${cursor}&user=sim-${i}&viewing=steward:1`);
        const b = await r.json(); cursor = b.cursor;
        if (i % 5 === 0) await fetch(BASE + 'api/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [] }) });
      } catch { fail++; }
      lat.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }));
  lat.sort((a, b) => a - b);
  const p95 = lat[Math.floor(lat.length * 0.95)];
  report('30 extra devices polling every 2 s: node keeps up', fail === 0 && p95 < 200, `${lat.length} requests, p95 ${p95.toFixed(1)} ms, ${fail} failed`);
  t = await within(5000, async () => /3\d online/.test(await A.page.textContent('.header__online-summary')));
  report('the header counts them', t !== null, (await A.page.textContent('.header__online-summary')).trim());
}

// 10. station upload of a whole PDF
await pair(L.page, 'station');
await go(L.page, '#/add'); await L.page.waitForSelector('.add-document__input[type=file]');
const pdf = join(REPO, 'docs/local-first-reading-room.pdf');
await L.page.setInputFiles('.add-document__input[type=file]', pdf);
const titleInput = await L.page.$('.add-document__input[required]');
if (titleInput && !(await titleInput.inputValue())) await titleInput.fill('Rehearsal upload');
await L.page.click('.add-document__submit');
const want = createHash('sha256').update(readFileSync(pdf)).digest('hex');
t = await within(10000, () => existsSync(join(ROOT, 'data', 'media', want)) || readFileSync(LOG, 'utf8').includes(want));
report('station upload: stored under its SHA-256', t !== null, t !== null ? want.slice(0, 12) : 'not found');

// 11. power cut mid-write: the last line of the log is cut off
await stopNode();
const before = logIds().length;
appendFileSync(LOG, '{"id":"cut:1","type":"annot');
const up = await startNode();
report('power cut: the node still starts with a cut-off last line', up, up ? '' : node.out.split('\n').find((l) => /Error/.test(l)));
if (up) {
  await go(A.page, '#/document/steward%3A1'); await A.page.waitForSelector('.annotation-form__body', { state: 'attached' });
  await post(A.page, 'After the power cut');
  await within(10000, async () => readFileSync(LOG, 'utf8').includes('After the power cut'));
  await stopNode(); const again = await startNode();
  const after = logIds();
  report('power cut: the next op is not lost with the cut line', again && after.length === before + 1 && readFileSync(LOG, 'utf8').includes('After the power cut') && !!after.find(() => true), `${before} → ${after.length} readable ops`);
}

report('no errors in any page\'s console', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
await stopNode();
rmSync(ROOT, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
