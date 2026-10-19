// Second Brain smoke tests. Drives the built page at phone size and fails
// (exit 1) on any broken check. Run: npm install && npm test (from the repo root).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Tests run against the built app (npm test builds first), the same files GitHub Pages serves.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = 8765 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}/`;

function browserPath() {
  const dir = '/opt/pw-browsers';
  if (!existsSync(dir)) return undefined;
  const shell = readdirSync(dir).find(d => d.startsWith('chromium_headless_shell'));
  if (shell) return `${dir}/${shell}/chrome-linux/headless_shell`;
  return undefined;
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: browserPath() });

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: opts.scheme || 'light' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') p.errors.push(m.text()); });
  await p.goto(BASE);
  return p;
}

await check('Page loads with the app title and no errors', async () => {
  const p = await page();
  await p.waitForSelector('#title');
  expect((await p.textContent('#title')).includes('Second Brain'), 'title missing');
  expect(p.errors.length === 0, 'errors: ' + p.errors.join(' | '));
});

await check('Fits a phone screen with no sideways scroll', async () => {
  const p = await page();
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(!wide, 'page scrolls sideways at 390px');
});

await check('Dark mode switches the background', async () => {
  const light = await page({ scheme: 'light' });
  const dark = await page({ scheme: 'dark' });
  const bg = p => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect((await bg(light)) !== (await bg(dark)), 'same background in light and dark');
});

await check('Hidden elements stay hidden (DEV-1)', async () => {
  const p = await page();
  const shown = await p.evaluate(() => {
    const el = document.createElement('div'); el.hidden = true; el.style.display = 'block';
    document.body.appendChild(el); return getComputedStyle(el).display !== 'none';
  });
  expect(!shown, '[hidden] can be overridden');
});

/* PIN lock (Step 7). GitHub's API is mocked so tests never touch the real vault. */
const FAKE_TOKEN = 'github_pat_TEST_' + 'x'.repeat(60);

async function mockGitHub(p, { status = 200, push = true } = {}) {
  p.calls = [];
  await p.route('https://api.github.com/**', route => {
    const req = route.request();
    p.calls.push({ url: req.url(), auth: req.headers()['authorization'] });
    if (status !== 200) return route.fulfill({ status, contentType: 'application/json', body: '{"message":"no"}' });
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ full_name: 'kmagno94/second-brain-vault', private: true, permissions: { pull: true, push } }) });
  });
}

await check('New device shows setup, Lock and save stays off until token and PIN', async () => {
  const p = await page();
  expect(await p.isVisible('#setup'), 'setup form missing');
  expect(await p.isDisabled('#save'), 'save should start disabled');
  await p.fill('#token', FAKE_TOKEN);
  await p.fill('#newPin', '12');
  expect(await p.isDisabled('#save'), 'save should need a PIN of 4 or more digits');
  await p.fill('#newPin', '1234');
  expect(await p.isEnabled('#save'), 'save should turn on');
});

await check('Rejected token shows a clear error and saves nothing', async () => {
  const p = await page();
  await mockGitHub(p, { status: 401 });
  await p.fill('#token', FAKE_TOKEN);
  await p.fill('#newPin', '1234');
  await p.click('#save');
  await p.waitForSelector('#error:not([hidden])');
  expect((await p.textContent('#error')).includes('did not accept'), 'wrong error: ' + await p.textContent('#error'));
  expect(await p.evaluate(() => localStorage.length) === 0, 'something was saved');
});

await check('Read-only token is refused', async () => {
  const p = await page();
  await mockGitHub(p, { push: false });
  await p.fill('#token', FAKE_TOKEN);
  await p.fill('#newPin', '1234');
  await p.click('#save');
  await p.waitForSelector('#error:not([hidden])');
  expect((await p.textContent('#error')).includes('Read and write'), 'wrong error: ' + await p.textContent('#error'));
});

await check('Good token is saved locked: header only, never in a URL or in plain text', async () => {
  const p = await page();
  await mockGitHub(p);
  await p.fill('#token', FAKE_TOKEN);
  await p.fill('#newPin', '482915');
  await p.click('#save');
  await p.waitForSelector('#unlocked');
  expect(p.calls.length === 1 && p.calls[0].auth === 'Bearer ' + FAKE_TOKEN, 'token not sent in the Authorization header');
  expect(!p.calls[0].url.includes(FAKE_TOKEN), 'token leaked into a URL');
  const stored = await p.evaluate(() => Object.values({ ...localStorage }).join(''));
  expect(stored.length > 0 && !stored.includes('github_pat'), 'token stored in plain text');
  expect(p.errors.length === 0, 'errors: ' + p.errors.join(' | '));
});

await check('After reload: wrong PIN refused, right PIN unlocks, Lock locks again', async () => {
  const p = await page();
  await mockGitHub(p);
  await p.fill('#token', FAKE_TOKEN);
  await p.fill('#newPin', '482915');
  await p.click('#save');
  await p.waitForSelector('#unlocked');
  await p.reload();
  await p.waitForSelector('#unlockForm');
  await p.fill('#pin', '000000');
  await p.click('#unlock');
  await p.waitForSelector('#error:not([hidden])');
  expect((await p.textContent('#error')).includes('Wrong PIN'), 'wrong PIN not refused');
  expect(await p.isVisible('#unlockForm'), 'should still be locked');
  await p.fill('#pin', '482915');
  await p.click('#unlock');
  await p.waitForSelector('#unlocked');
  expect(await p.isHidden('#error'), 'old error still showing');
  await p.click('#lock');
  await p.waitForSelector('#unlockForm');
});

await check('Remove token clears the device and goes back to setup', async () => {
  const p = await page();
  await mockGitHub(p);
  p.on('dialog', d => d.accept());
  await p.fill('#token', FAKE_TOKEN);
  await p.fill('#newPin', '1234');
  await p.click('#save');
  await p.waitForSelector('#unlocked');
  await p.click('#forgetUnlocked');
  await p.waitForSelector('#setup');
  expect(await p.evaluate(() => localStorage.length) === 0, 'token still saved');
});

await check('PIN and token boxes do not trigger iPhone zoom', async () => {
  const p = await page();
  const sizes = await p.$$eval('input', els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length >= 2 && sizes.every(s => s >= 16), 'input font sizes: ' + sizes.join(', '));
});

await browser.close();
server.kill();
for (const r of results) console.log(r[0] + '  ' + r[1] + (r[2] ? '  -> ' + r[2] : ''));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
