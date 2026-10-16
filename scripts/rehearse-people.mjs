// A rehearsal of libraries, accounts and who may do what (docs/libraries-and-accounts.md):
// a laptop that looks after the node, a phone, a second laptop and a guest, in headless
// Chrome, against a node of its own with scratch data (your data/ is not touched).
//   npm run rehearse:people        (builds first; about a minute)
//   CHROME=/usr/bin/chromium npm run rehearse:people
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = mkdtempSync(join(tmpdir(), 'osl-people-'));
const PORT = Number(process.env.REHEARSAL_PORT ?? 8094);
const BASE = `http://localhost:${PORT}`;

mkdirSync(join(ROOT, 'data'), { recursive: true });
symlinkSync(join(REPO, 'dist'), join(ROOT, 'dist'), 'junction');

const node = spawn('node', [join(REPO, 'dist-node/server.mjs')], { env: { ...process.env, PORT: String(PORT), OSL_CODE: '123456', OSL_ROOT: ROOT }, stdio: ['ignore', 'pipe', 'pipe'] });
let nodeOut = '';
node.stdout.on('data', d => (nodeOut += d));
node.stderr.on('data', d => (nodeOut += d));
for (let i = 0; ; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ }
    if (node.exitCode !== null || i > 50) { console.log(nodeOut); process.exit(1); }
    await new Promise(r => setTimeout(r, 100));
}

const results = [];
const report = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
async function within(ms, fn) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 150)); } return false; }

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
    .catch(() => chromium.launch({ channel: 'chrome' }))
    .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
const errors = [];
async function device(name, opts) {
    const page = await (await browser.newContext(opts)).newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    page.on('dialog', d => d.accept());
    return page;
}
const LAPTOP = { viewport: { width: 1280, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const fitsWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// what the node hands this browser, asked from inside it (its cookie and all)
const pull = (page, library = 'main') => page.evaluate(async l => {
    const r = await fetch(`${l === 'main' ? 'api/' : `api/l/${l}/`}ops?after=`, { cache: 'no-store' });
    return { status: r.status, ops: r.ok ? (await r.json()).ops : [] };
}, library);
const names = page => page.$$eval('.collections__name', els => els.map(e => e.textContent));

async function makeAccount(page, username, name, password, code) {
    await page.goto(BASE + '/?library=main#/account');
    await page.waitForSelector('.account__form');
    if (await page.isVisible('.account__tabs')) await page.click('.account__tab >> text=Make an account');
    await page.fill('input[autocomplete="username"]', username);
    await page.fill('input[autocomplete="name"]', name);
    await page.fill('input[autocomplete="new-password"]', password);
    if (code) await page.fill('input[inputmode="numeric"]', code);
    await page.click('.account__save');
}

const laptop = await device('laptop', LAPTOP);
const phone = await device('phone', PHONE);

// ---- the first account looks after the node, and needs the code on its screen ----
await laptop.goto(BASE + '/#/account');
await laptop.waitForSelector('.account__form');
await laptop.fill('input[autocomplete="username"]', 'ama');
await laptop.fill('input[autocomplete="new-password"]', 'longenough');
await laptop.fill('input[inputmode="numeric"]', '000000');
await laptop.click('.account__save');
report('the first account needs the pairing code', await within(3000, () => laptop.isVisible('.library__notice--error')));
await makeAccount(laptop, 'ama', 'Ama Owusu', 'longenough', '123456');
report('with the code, the first account looks after the node', await within(5000, () => laptop.isVisible('text=you look after this node')));

// ---- a protected library ----
await laptop.goto(BASE + '/#/libraries');
await laptop.fill('.libraries__new input >> nth=0', 'Poetry club');
await laptop.fill('.libraries__new input[type="password"]', 'poems');
await laptop.click('.libraries__make');
report('the node admin makes a protected library', await within(5000, () => laptop.url().includes('library=poetry-club')));
await laptop.waitForSelector('.header__library');

await phone.goto(BASE + '/?library=poetry-club');
report('a phone gets the lock screen, and nothing of the library', await within(5000, () => phone.isVisible('.lock-screen')));
report('the node gives a browser without the password nothing', (await pull(phone, 'poetry-club')).status === 401);
await phone.fill('.lock-screen__input', 'wrong');
await phone.click('.lock-screen__open');
report('a wrong password is refused', await within(3000, () => phone.isVisible('.library__notice--error')));
await phone.fill('.lock-screen__input', 'poems');
await phone.click('.lock-screen__open');
report('the right one opens it on this device', await within(5000, async () => !(await phone.isVisible('.lock-screen')) && (await pull(phone, 'poetry-club')).status === 200));
report('the lock screen and library fit a phone', await fitsWidth(phone));

// ---- who may add documents ----
await laptop.goto(BASE + '/?library=poetry-club#/manage');
await laptop.waitForSelector('.manage__choices');
report('the manage page fits a laptop', await fitsWidth(laptop));
await laptop.uncheck('.manage__choices input >> nth=0');
await laptop.check('.manage__choices input >> nth=3');
await laptop.click('.manage__choices + .manage__save');
await laptop.waitForSelector('text=Saved who may add documents');
await phone.goto(BASE + '/?library=poetry-club#/add');
report('when only uploaders may add, a guest is told so instead of the form', await within(10000, () => phone.isVisible('.add-document__closed')));
const refused = await phone.evaluate(async () => {
    const r = await fetch('api/l/poetry-club/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ id: 'd-sneaky:1', user: 'd-sneaky', timestamp: '2026-10-16T10:00:00Z', type: 'document', fileType: 'text', properties: { title: 'Sneaked in', author: '', type: '' } }] }) });
    return (await r.json()).refused?.length ?? 0;
});
report('and the node refuses a document from them anyway', refused === 1);

// ---- a second person, and collections that aren't for everyone ----
await makeAccount(phone, 'rosa', 'Rosa', 'rosapassword');
report('anyone can make an account', await within(5000, () => phone.isVisible('text=Signed in as')));

await laptop.goto(BASE + '/?library=main#/');
await laptop.waitForSelector('.document-card');
const first = await laptop.$eval('a.document-card__link', a => a.getAttribute('href'));
await laptop.goto(BASE + '/?library=main' + first);
await laptop.waitForSelector('.collect');
await laptop.click('.collect__toggle');
for (const [name, see] of [['My private shelf', 'owner'], ['Open shelf', 'everyone'], ['Club shelf', 'owner']]) {
    await laptop.fill('.collect__input >> nth=0', name);
    await laptop.selectOption('.collect__new select', see);
    await laptop.click('.collect__create');
    await laptop.waitForFunction(n => [...document.querySelectorAll('.collect__name')].some(e => e.textContent === n), name);
}
report('the document page holds its collections, with room to add and start one', await laptop.isVisible('.collect__panel'));

await laptop.goto(BASE + '/?library=main#/manage');
await laptop.fill('input[placeholder="Reading circle"]', 'Club');
await laptop.click('text=Make it');
await laptop.waitForSelector('.manage__group');
await laptop.selectOption('.manage__add-member', { label: 'Rosa (rosa)' });
report('an admin makes a group and puts Rosa in it', await within(5000, () => laptop.isVisible('.manage__member')));

await phone.goto(BASE + '/?library=main#/collections');
await phone.waitForSelector('.collections__grid');
report('Rosa sees the open shelf', await within(10000, async () => (await names(phone)).includes('Open shelf')));
const rosaGets = JSON.stringify((await pull(phone)).ops);
report("she doesn't see the private ones, and the node never sent them", !(await names(phone)).some(n => n === 'My private shelf' || n === 'Club shelf') && !rosaGets.includes('My private shelf') && !rosaGets.includes('Club shelf'));

await laptop.goto(BASE + '/?library=main#/collections');
await laptop.click('text=Club shelf');
await laptop.click('.collection__share-open');
for (const n of [0, 1]) {
    await laptop.click(`.collection__sharing .audience >> nth=${n} >> text=People and groups I choose`);
    await laptop.click(`.collection__sharing .audience >> nth=${n} >> text=Club`);
}
await laptop.click('.collection__sharing-save');
await laptop.waitForSelector('text=Shared with Club');
report('shared with the group: it reaches Rosa', await within(15000, async () => (await names(phone)).includes('Club shelf')));
await phone.click('text=Club shelf');
report('with what was in it before', await within(5000, async () => (await phone.$$('.collection__item')).length === 1));
report('and she may add to it', await phone.isVisible('text=You can add to it'));
report('the collections pages fit a phone', await fitsWidth(phone));

// ---- one account, two devices: one Kept ----
const laptop2 = await device('laptop 2', LAPTOP);
await laptop2.goto(BASE + '/?library=main#/account');
await laptop2.waitForSelector('.account__form');
await laptop2.fill('input[autocomplete="username"]', 'ama');
await laptop2.fill('input[autocomplete="current-password"]', 'longenough');
await laptop2.click('.account__save');
await laptop2.waitForSelector('text=Signed in as');
await laptop.goto(BASE + '/?library=main' + first);
await laptop.click('.collect .keep-button');
await laptop2.goto(BASE + '/?library=main' + first);
report("an account's devices share one Kept", await within(10000, () => laptop2.isVisible('.collect .keep-button--kept')));
report("and sees the account's private shelves", await within(5000, async () => (await laptop2.textContent('.collect')).includes('My private shelf')));

// ---- names: a guest's shows with (Guest), an account's without ----
const guest = await device('guest', LAPTOP);
await guest.goto(BASE + '/?library=main#/you');
await guest.fill('.you__name-input', 'Kofi');
await guest.click('.you__name-save');
await guest.goto(BASE + '/?library=main' + first);
await guest.waitForSelector('.annotation-form__body');
await guest.fill('.annotation-form__body', 'From a guest');
await guest.click('.annotation-form__submit');
await phone.goto(BASE + '/?library=main' + first);
await phone.waitForSelector('.notes-dock');
const seen = await within(15000, async () => (await phone.textContent('.notes-dock, .single-document__conversation')).includes('From a guest'));
await laptop.goto(BASE + '/?library=main' + first);
await within(10000, async () => (await laptop.textContent('.single-document__conversation')).includes('From a guest'));
const thread = await laptop.textContent('.single-document__conversation');
report('a guest\'s name shows as "Kofi (Guest)"', seen && thread.includes('Kofi (Guest)'));
const by = await phone.evaluate(() => document.body.textContent);
report('an account\'s name shows without it', by.includes('Ama Owusu') && !by.includes('Ama Owusu (Guest)'));

// ---- signing out: the next person on the device isn't you ----
await phone.goto(BASE + '/?library=main#/you');
const before = await phone.textContent('.you__details code');
await phone.goto(BASE + '/?library=main#/account');
await phone.click('text=Sign out');
await phone.waitForSelector('text=Make an account');
await phone.goto(BASE + '/?library=main#/you');
const after = await phone.textContent('.you__details code');
report('signing out makes the device a new guest', !!after && after !== before);

// ---- a new password closes the library again ----
await laptop.goto(BASE + '/?library=poetry-club#/manage');
await laptop.fill('.manage__section input[type="password"]', 'newpoems');
await laptop.click('text=Change it');
await laptop.waitForSelector('text=Password changed');
await phone.goto(BASE + '/?library=poetry-club');
report('a new password closes the library on devices that had the old one', await within(15000, () => phone.isVisible('.lock-screen')));

report('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
node.kill();
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
if (failed) console.log(`scratch data kept in ${ROOT}`); else rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
