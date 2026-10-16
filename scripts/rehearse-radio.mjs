// A rehearsal of gate seven with no boards: the library node, a drop point and the
// radio between them, with phones in headless Chrome walking from one to the other.
//   npm run rehearse:radio      (Linux or macOS; builds first; about two minutes)
//
// The drop point and the Pi's modem are the firmware's own code compiled for this
// computer (firmware/test/sim/): the same op log, API and link layer as the boards,
// with UDP standing in for the air and a pseudo-terminal for the modem's USB serial.
// What it can't tell you: Wi-Fi, range, the boards' memory, real radio timing.
//
// A phone's address stays the same whichever box answers (as on the boards, which take
// the library's address: README W-D10). Here every phone uses http://osl.test, and each
// request goes to whichever box the phone is near.
import { chromium, devices } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = mkdtempSync(join(tmpdir(), 'osl-radio-'));
const LIB_PORT = 8096, DROP_PORT = 8097, MODEM_UDP = 47101, DROP_UDP = 47102;
const LIB = `http://localhost:${LIB_PORT}`, DROP = `http://localhost:${DROP_PORT}`;
const ORIGIN = 'http://osl.test';
const LOG = join(WORK, 'library', 'data', 'ops.jsonl');

console.log('building the firmware simulators…');
execFileSync('sh', [join(REPO, 'firmware/test/sim/build.sh'), WORK], { stdio: 'inherit' });

const children = [];
function run(cmd, args, env = {}) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.out = '';
  p.stdout.on('data', (d) => (p.out += d));
  p.stderr.on('data', (d) => (p.out += d));
  children.push(p);
  return p;
}
const until = async (ms, fn) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Date.now() - t0; } catch {} await new Promise((r) => setTimeout(r, 150)); } return null; };
const up = (url) => until(8000, async () => (await fetch(url + '/api/health')).ok);

mkdirSync(join(WORK, 'library', 'data'), { recursive: true });
symlinkSync(join(REPO, 'dist'), join(WORK, 'library', 'dist'), 'junction');
mkdirSync(join(WORK, 'drop'));

const modem = run(join(WORK, 'osl_modem_sim'), [String(MODEM_UDP), String(DROP_UDP)]);
await until(3000, () => modem.out.includes('\n'));
const pty = modem.out.split('\n')[0].trim();
let drop = run(join(WORK, 'osl_droppoint_sim'), [String(DROP_PORT), join(REPO, 'dist'), join(WORK, 'drop'), String(DROP_UDP), String(MODEM_UDP)]);
const library = run('node', [join(REPO, 'dist-node/server.mjs')], { PORT: String(LIB_PORT), OSL_ROOT: join(WORK, 'library'), RADIO_PORT: pty, OSL_CODE: '123456' });
if ((await up(LIB)) === null || (await up(DROP)) === null) { console.log(library.out, drop.out); process.exit(1); }

const results = [];
const report = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const took = (t) => (t === null ? 'never' : `${(t / 1000).toFixed(1)} s`);
const inLibrary = (text) => existsSync(LOG) && readFileSync(LOG, 'utf8').includes(text);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}).catch(() => chromium.launch({ channel: 'chrome' }));
const errors = [];

// A phone at a fixed address; `near` says which box answers it.
async function phone(name, device, near = LIB, path = '/') {
  const ctx = await browser.newContext(devices[device]);
  const p = { name, ctx, near };
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url());
    // a real phone's Origin is the address it reached, so it matches the node's Host
    const headers = { ...route.request().headers() };
    if (headers.origin) headers.origin = p.near;
    try {
      const response = await route.fetch({ url: p.near + u.pathname + u.search, headers });
      await route.fulfill({ response });
    } catch {
      await route.abort('connectionrefused');
    }
  });
  p.page = await ctx.newPage();
  p.page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await p.page.goto(ORIGIN + path);
  await p.page.waitForSelector('.header');
  return p;
}
const go = (p, hash) => p.page.evaluate((h) => { location.hash = h; }, hash);
const notes = (p) => p.page.$$eval('.annotation-thread__body', (els) => els.map((e) => e.textContent));
// on a phone the notes dock along the bottom is where a note is written; on a wide screen, the form
async function post(p, text) {
  await p.page.waitForSelector('.annotation-form__body, .notes-dock__input', { state: 'attached' });
  if (await p.page.locator('.annotation-form__body').isVisible()) {
    await p.page.fill('.annotation-form__body', text);
    await p.page.click('.annotation-form__submit');
  } else {
    await p.page.fill('.notes-dock__input', text);
    await p.page.click('.notes-dock__send');
  }
}
const headerSays = (p) => p.page.textContent('.header__sync');

try {
  const A = await phone('phone A', 'iPhone 13');
  const B = await phone('phone B', 'Pixel 7');
  await go(A, '#/document/steward%3A1');
  await go(B, '#/document/steward%3A1');
  let t = await until(8000, async () => (await headerSays(A)).includes('Up to date'));
  report('A opens the app at the library', t !== null);

  // A walks out to the drop point
  A.near = DROP;
  t = await until(20000, async () => (await headerSays(A)).includes('At a drop point'));
  report('A, out at the drop point, sees "At a drop point"', t !== null, took(t));
  // out of range for a moment, so the note is still on its way when the Sync screen is read
  await fetch(DROP + '/sim/radio?on=0', { method: 'POST' });
  await post(A, 'Written at the drop point');
  await go(A, '#/sync');
  await A.page.waitForSelector('.sync-screen');
  const syncText = () => A.page.textContent('.sync-screen');
  t = await until(15000, async () => (await syncText()).includes('0 waiting to send'));
  report('the note leaves A\'s phone (handed in at the drop point)', t !== null, took(t));
  const listed = await syncText();
  report('A\'s Sync screen lists it as on the way by radio', /1 on the way by radio/.test(listed) && listed.includes('Written at the drop point'),
    /1 on the way by radio/.test(listed) ? '' : listed.slice(0, 300));
  await fetch(DROP + '/sim/radio?on=1', { method: 'POST' });

  t = await until(30000, () => inLibrary('Written at the drop point'));
  report('it crosses the radio and is stored at the library', t !== null, took(t));
  t = await until(10000, async () => (await notes(B)).includes('Written at the drop point'));
  report('B, at the library, sees it', t !== null, took(t));

  // the return path
  await post(B, 'Written at the library');
  await go(A, '#/document/steward%3A1');
  t = await until(40000, async () => (await notes(A)).includes('Written at the library'));
  report('B\'s note comes out to A at the drop point by radio', t !== null, took(t));
  await go(A, '#/sync');
  await A.page.waitForSelector('.sync-screen');
  t = await until(30000, async () => /0 on the way by radio/.test(await A.page.textContent('.sync-screen')));
  report('A\'s note came back out, so A knows it reached the library', t !== null, took(t));

  // the library's list of drop points, fed by the drop point's heartbeat
  const listed2 = async () => (await (await fetch(LIB + '/api/droppoints')).json()).droppoints.find((p) => p.id === 'drop-51a51a');
  t = await until(15000, async () => (await listed2())?.state === 'connected');
  const dp = await listed2();
  report('the library lists the drop point as connected', t !== null, dp ? `${dp.name}, heard at the library: ${dp.atLibrary?.rssi} dBm` : 'not listed');
  report('…with the same app as the library', dp?.sameApp === true, dp ? `app ${dp.app}` : '');
  t = await until(15000, async () => (await listed2())?.phones >= 1);
  report('…and A counted among the phones there', t !== null, took(t));
  await go(B, '#/droppoints');
  t = await until(10000, async () => /Simulated drop point[\s\S]*Connected/.test(await B.page.textContent('.drop-points')));
  report('B sees it on the Drop points page', t !== null, took(t));
  if (process.env.REHEARSE_SHOTS) await B.page.screenshot({ path: join(process.env.REHEARSE_SHOTS, 'droppoints-connected.png'), fullPage: true });
  await fetch(DROP + '/sim/radio?on=0', { method: 'POST' });
  t = await until(30000, async () => (await listed2())?.state === 'not-heard');
  report('out of range for a while: "not heard since"', t !== null, took(t));
  t = await until(10000, async () => /Not heard since/.test(await B.page.textContent('.drop-points')));
  report('…on the page too, and still listed', t !== null);
  if (process.env.REHEARSE_SHOTS) await B.page.screenshot({ path: join(process.env.REHEARSE_SHOTS, 'droppoints-not-heard.png'), fullPage: true });
  await fetch(DROP + '/sim/radio?on=1', { method: 'POST' });
  t = await until(15000, async () => (await listed2())?.state === 'connected');
  report('back in range: connected again', t !== null, took(t));
  await go(B, '#/document/steward%3A1');

  // the radio out of range, then the drop point restarted, with a note waiting in its flash
  await fetch(DROP + '/sim/radio?on=0', { method: 'POST' });
  await go(A, '#/document/steward%3A2');
  await post(A, 'Waiting out of range');
  t = await until(8000, async () => (await (await fetch(DROP + '/api/status')).json()).waitingToForward === 1);
  report('out of radio range: the drop point holds the note', t !== null && !inLibrary('Waiting out of range'));
  drop.kill();
  await new Promise((r) => drop.once('exit', r));
  drop = run(join(WORK, 'osl_droppoint_sim'), [String(DROP_PORT), join(REPO, 'dist'), join(WORK, 'drop'), String(DROP_UDP), String(MODEM_UDP)]);
  await up(DROP);
  report('after a restart the drop point still has it', drop.out.includes('1 waiting to forward'), drop.out.split('\n')[0]);
  t = await until(30000, () => inLibrary('Waiting out of range'));
  report('back in range, it reaches the library', t !== null, took(t));

  // the app opens from the drop point itself
  await A.page.reload();
  await A.page.waitForSelector('.header');
  t = await until(8000, async () => (await A.page.$$('.single-document__title')).length > 0 || (await A.page.$$('.document-card')).length > 0);
  report('the app opens from the drop point\'s own copy', t !== null);
  await go(A, '#/you');
  await A.page.fill('.you__pair .you__pair-input[inputmode=numeric]', '123456');
  await A.page.click('.you__pair button[type=submit]');
  t = await until(5000, async () => /only works at the library/.test(await A.page.textContent('body')));
  report('pairing at a drop point says to do it at the library', t !== null);

  // A walks home
  A.near = LIB;
  await go(A, '#/document/steward%3A1');
  t = await until(20000, async () => (await headerSays(A)).includes('Up to date'));
  report('A, back at the library, is up to date', t !== null, took(t));
  const ids = readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l).id);
  report('nothing doubled at the library', new Set(ids).size === ids.length, `${ids.length} ops`);
  const countA = await A.page.evaluate(() => document.querySelectorAll('.annotation-thread__body').length);
  const countB = await (async () => { await go(B, '#/document/steward%3A1'); await B.page.waitForTimeout(2500); return B.page.evaluate(() => document.querySelectorAll('.annotation-thread__body').length); })();
  report('both phones show the same notes', countA === countB && countA === 2, `${countA} and ${countB}`);

  // ---- a protected library, carried by the drop point (W-D12) ----
  const POETRY_LOG = join(WORK, 'library', 'data', 'libraries', 'poetry', 'ops.jsonl');
  const signup = await fetch(LIB + '/api/account/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ama', name: 'Ama', password: 'longenough', code: '123456', device: 'd-admin' }) });
  const cookie = (signup.headers.get('set-cookie') ?? '').split(';')[0];
  const asAdmin = (path, body) => fetch(LIB + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  await asAdmin('/api/libraries/create', { id: 'poetry', name: 'Poetry club', password: 'poems' });
  await asAdmin('/api/l/poetry/libraries/settings', { droppoints: true });
  const now = new Date().toISOString();
  await asAdmin('/api/l/poetry/ops', { ops: [
    { id: 'd-admin:1', user: 'd-admin', timestamp: now, type: 'document', fileType: 'text', properties: { title: 'A club poem', author: 'Ama', type: 'poem' } },
    { id: 'd-admin:2', user: 'd-admin', timestamp: now, type: 'annotation', target: 'd-admin:1', body: 'Read it aloud first', access: 'public' }] });
  t = await until(30000, async () => (await fetch(DROP + '/api/l/poetry/directory')).ok);
  const shut = await (await fetch(DROP + '/api/l/poetry/directory')).json();
  report('the library sends the drop point its list, and it carries the protected library', t !== null && shut.library?.locked === true, took(t));
  report('…shut to anyone without the password', (await fetch(DROP + '/api/l/poetry/ops?after=')).status === 401);
  report('a library drop points don\'t carry isn\'t there at all', (await fetch(DROP + '/api/l/elsewhere/ops?after=')).status === 404);

  const C = await phone('phone C', 'iPhone 13', DROP, '/?library=poetry');
  t = await until(15000, () => C.page.isVisible('.lock-screen'));
  const lockText = t !== null ? await C.page.textContent('.lock-screen') : '';
  report('a phone at the drop point gets its lock screen', t !== null && /drop point/.test(lockText), took(t));
  await C.page.fill('.lock-screen__input', 'poems');
  await C.page.click('.lock-screen__open');
  t = await until(20000, async () => (await C.page.textContent('body')).includes('A club poem'));
  report('its password opens it there, and what came by radio is in it', t !== null, took(t));
  await go(C, '#/document/d-admin%3A1');
  t = await until(10000, async () => (await notes(C)).includes('Read it aloud first'));
  report('…notes too', t !== null, took(t));
  await post(C, 'Answered at the drop point');
  t = await until(40000, () => existsSync(POETRY_LOG) && readFileSync(POETRY_LOG, 'utf8').includes('Answered at the drop point'));
  report('a note written there crosses the radio into that library, not the main one', t !== null && !inLibrary('Answered at the drop point'), took(t));
  report('no errors in any page\'s console', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  for (const c of children) c.kill();
  rmSync(WORK, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
