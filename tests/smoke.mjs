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

const SAMPLE_NOTE = `---
date: 2026-10-18
source: sample
---

# Sunday, October 18, 2026

> Sample note, written by hand.

## Projects

### Second Brain Web App
[Open in Notion](https://app.notion.com/p/3fd098dedfdb81cd87b1cc6e28faee04)

- Project started
  - Nested detail
- Repos created
`;

// Fake GitHub: repo info, the Daily/ listing, and raw note files.
// opts.status forces every call to fail with that code; opts.listStatus only the listing.
async function mockGitHub(p, { status = 200, push = true, listStatus = 200, putStatus = 201, taken = [], files = { '2026-10-18.md': SAMPLE_NOTE } } = {}) {
  p.calls = [];
  p.files = files;
  p.puts = [];
  await p.route('https://api.github.com/**', route => {
    const req = route.request();
    const url = new URL(req.url());
    p.calls.push({ url: req.url(), auth: req.headers()['authorization'], accept: req.headers()['accept'] });
    const json = (code, body) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
    if (status !== 200) return json(status, { message: 'no' });
    const base = '/repos/kmagno94/second-brain-vault';
    if (url.pathname === base) return json(200, { full_name: 'kmagno94/second-brain-vault', private: true, permissions: { pull: true, push } });
    if (url.pathname === base + '/contents/Daily') {
      if (listStatus !== 200) return json(listStatus, { message: 'no' });
      return json(200, Object.keys(p.files).map(name => ({ name, path: 'Daily/' + name, type: 'file' })).concat([{ name: '.gitkeep', path: 'Daily/.gitkeep', type: 'file' }]));
    }
    if (req.method() === 'PUT' && url.pathname.startsWith(base + '/contents/Inbox/')) {
      const name = decodeURIComponent(url.pathname.split('/').pop());
      if (taken.includes(name)) return json(422, { message: 'sha wasn\'t supplied' });
      if (putStatus !== 201) return json(putStatus, { message: 'no' });
      const body = JSON.parse(req.postData());
      p.puts.push({ name, message: body.message, text: Buffer.from(body.content, 'base64').toString('utf8'), auth: req.headers()['authorization'], url: req.url() });
      return json(201, { content: { name, path: 'Inbox/' + name } });
    }
    if (url.pathname.startsWith(base + '/contents/Daily/')) {
      const name = decodeURIComponent(url.pathname.split('/').pop());
      if (!(name in p.files)) return json(404, { message: 'Not Found' });
      return route.fulfill({ status: 200, contentType: 'text/plain', body: p.files[name] });
    }
    return json(404, { message: 'Not Found' });
  });
}

async function setUp(p, pin = '1234') {
  await p.fill('#token', FAKE_TOKEN);
  await p.fill('#newPin', pin);
  await p.click('#save');
  await p.waitForSelector('#unlocked');
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
  expect(p.calls.length >= 1 && p.calls.every(c => c.auth === 'Bearer ' + FAKE_TOKEN), 'token not sent in the Authorization header');
  expect(p.calls.every(c => !c.url.includes(FAKE_TOKEN)), 'token leaked into a URL');
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

/* Daily note (Step 9). */
await check('Unlocked shows the newest daily note, rendered', async () => {
  const p = await page();
  await mockGitHub(p, { files: { '2026-10-16.md': '# Old day\n', '2026-10-18.md': SAMPLE_NOTE, '2026-10-17.md': '# Middle day\n' } });
  await setUp(p);
  await p.waitForSelector('#noteBody');
  expect(await p.getAttribute('#noteBody', 'data-date') === '2026-10-18', 'did not pick the newest note');
  expect((await p.textContent('#noteBody h2')).includes('Sunday, October 18, 2026'), 'title heading missing');
  expect(!(await p.textContent('#noteBody')).includes('source: sample'), 'frontmatter showing');
  expect(await p.$$eval('#noteBody ul ul li', els => els.length) === 1, 'nested bullet not nested');
  const link = await p.$eval('#noteBody a', a => ({ href: a.href, target: a.target }));
  expect(link.href.startsWith('https://app.notion.com/') && link.target === '_blank', 'Notion link wrong');
  const raw = p.calls.find(c => c.url.endsWith('/Daily/2026-10-18.md'));
  expect(raw && raw.accept === 'application/vnd.github.raw+json', 'note not fetched as raw text');
  expect(p.errors.length === 0, 'errors: ' + p.errors.join(' | '));
});

await check('Label says Today, Yesterday, or Latest note', async () => {
  const p = await page();
  const [today, yesterday] = await p.evaluate(() => [0, -1].map(o => {
    const d = new Date(); d.setDate(d.getDate() + o);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }));
  await mockGitHub(p, { files: { [yesterday + '.md']: '# Y\n' } });
  await setUp(p);
  await p.waitForSelector('#noteBody');
  expect((await p.textContent('#noteLabel')).includes('Yesterday'), 'yesterday label: ' + await p.textContent('#noteLabel'));
  p.files[today + '.md'] = '# T\n';
  await p.click('#refresh');
  await p.waitForSelector(`#noteBody[data-date="${today}"]`);
  expect((await p.textContent('#noteLabel')).includes('Today'), 'today label: ' + await p.textContent('#noteLabel'));
  p.files = { '2020-01-01.md': '# Long ago\n' };
  await p.click('#refresh');
  await p.waitForSelector('#noteBody[data-date="2020-01-01"]');
  expect((await p.textContent('#noteLabel')).includes('Latest note'), 'latest label: ' + await p.textContent('#noteLabel'));
});

await check('HTML in a note shows as text and never runs', async () => {
  const p = await page();
  const evil = '# Hi <img src=x onerror="window.hacked=1">\n\n- <script>window.hacked=1</script>\n- [click](javascript:window.hacked=1)\n';
  await mockGitHub(p, { files: { '2026-10-18.md': evil } });
  await setUp(p);
  await p.waitForSelector('#noteBody');
  expect(await p.$$eval('#noteBody img, #noteBody script', els => els.length) === 0, 'raw HTML became elements');
  expect(await p.$$eval('#noteBody a', els => els.length) === 0, 'javascript: link was made clickable');
  expect((await p.textContent('#noteBody')).includes('<img src=x'), 'HTML text was dropped instead of shown');
  expect(!(await p.evaluate(() => window.hacked)), 'script ran');
});

await check('No daily notes yet shows a friendly empty message', async () => {
  const p = await page();
  await mockGitHub(p, { files: {} });
  await setUp(p);
  await p.waitForSelector('#noteEmpty');
});

await check('Expired token shows how to fix it, and Refresh retries', async () => {
  const p = await page();
  await mockGitHub(p, { listStatus: 401 });
  await setUp(p);
  await p.waitForSelector('#noteError');
  expect((await p.textContent('#noteError')).includes('may have expired'), 'wrong message: ' + await p.textContent('#noteError'));
  expect(await p.isHidden('#error'), 'note error leaked into the setup error line');
  await p.unroute('https://api.github.com/**');
  await mockGitHub(p);
  await p.click('#refresh');
  await p.waitForSelector('#noteBody');
});

await check('Locking clears the note from the screen', async () => {
  const p = await page();
  await mockGitHub(p);
  await setUp(p);
  await p.waitForSelector('#noteBody');
  await p.click('#lock');
  await p.waitForSelector('#unlockForm');
  expect(!(await p.textContent('body')).includes('Second Brain Web App'), 'note still on screen after Lock');
});

/* Capture box (Step 10). */
await check('Save to Inbox stays off until there is text', async () => {
  const p = await page();
  await mockGitHub(p);
  await setUp(p);
  expect(await p.isDisabled('#saveThought'), 'Save should start disabled');
  await p.fill('#thought', '   \n ');
  expect(await p.isDisabled('#saveThought'), 'Save should ignore blank space');
  await p.fill('#thought', 'Idea');
  expect(await p.isEnabled('#saveThought'), 'Save should turn on with text');
});

await check('Saving writes one new Inbox file with the exact text, then clears the box', async () => {
  const p = await page();
  await mockGitHub(p);
  await setUp(p);
  const thought = 'Call mom about Sunday dinner! 🍝\nAlso ask about the café';
  await p.fill('#thought', thought);
  await p.click('#saveThought');
  await p.waitForSelector('#captureOk:not([hidden])');
  expect(p.puts.length === 1, 'expected 1 save, got ' + p.puts.length);
  const put = p.puts[0];
  expect(/^\d{4}-\d{2}-\d{2}-\d{6}-call-mom-about-sunday-dinner\.md$/.test(put.name), 'file name: ' + put.name);
  expect(/^---\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\nsource: web\n---\n\n/.test(put.text), 'frontmatter: ' + put.text);
  expect(put.text.includes(thought), 'text changed on the way (emoji or accents lost?)');
  expect(put.message === 'Capture: Call mom about Sunday dinner! 🍝', 'commit message: ' + put.message);
  expect(put.auth === 'Bearer ' + FAKE_TOKEN && !put.url.includes(FAKE_TOKEN), 'token not in header only');
  expect((await p.inputValue('#thought')) === '', 'box not cleared');
  expect((await p.textContent('#captureOk')).includes(put.name), 'saved message missing the file name');
  await p.fill('#thought', 'n');
  expect(await p.isHidden('#captureOk'), 'saved message should clear when typing again');
  expect(p.errors.length === 0, 'errors: ' + p.errors.join(' | '));
});

await check('A failed save keeps the text and says why', async () => {
  const p = await page();
  await mockGitHub(p, { putStatus: 500 });
  await setUp(p);
  await p.fill('#thought', 'Do not lose me');
  await p.click('#saveThought');
  await p.waitForSelector('#captureError:not([hidden])');
  expect((await p.textContent('#captureError')).includes('Not saved'), 'wrong message: ' + await p.textContent('#captureError'));
  expect((await p.inputValue('#thought')) === 'Do not lose me', 'text was lost');
  expect(await p.isHidden('#captureOk'), 'claimed it saved');
});

await check('Offline save keeps the text', async () => {
  const p = await page();
  await mockGitHub(p);
  await setUp(p);
  await p.unroute('https://api.github.com/**');
  await p.route('https://api.github.com/**', r => r.abort());
  await p.fill('#thought', 'Subway thought');
  await p.click('#saveThought');
  await p.waitForSelector('#captureError:not([hidden])');
  expect((await p.textContent('#captureError')).includes('could not reach GitHub'), 'wrong message');
  expect((await p.inputValue('#thought')) === 'Subway thought', 'text was lost');
});

await check('A taken file name is never overwritten: it saves as -2', async () => {
  const p = await page();
  // Freeze the clock so the first name is known and already taken.
  await p.addInitScript(() => {
    const fixed = new Date(2026, 9, 19, 6, 15, 12).getTime();
    const RealDate = Date;
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  });
  await p.reload();
  await mockGitHub(p, { taken: ['2026-10-19-061512-same-second.md'] });
  await setUp(p);
  await p.fill('#thought', 'same second');
  await p.click('#saveThought');
  await p.waitForSelector('#captureOk:not([hidden])');
  expect(p.puts.length === 1 && p.puts[0].name === '2026-10-19-061512-same-second-2.md', 'saved as: ' + (p.puts[0] || {}).name);
});

await check('Capture box does not trigger iPhone zoom', async () => {
  const p = await page();
  await mockGitHub(p);
  await setUp(p);
  const size = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('thought')).fontSize));
  expect(size >= 16, 'capture box font is ' + size + 'px');
});

await browser.close();
server.kill();
for (const r of results) console.log(r[0] + '  ' + r[1] + (r[2] ? '  -> ' + r[2] : ''));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
