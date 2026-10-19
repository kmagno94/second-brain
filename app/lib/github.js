// Talks to the private vault through GitHub's REST API, straight from the
// browser (GitHub allows this for any site). The token only ever goes in the
// Authorization header, never in a URL.
import { captureName, captureFile, commitMessage } from './capture.js';

export const VAULT ={ owner: 'kmagno94', repo: 'second-brain-vault' };
const API = 'https://api.github.com';
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;

function headers(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function vault(token, path, accept) {
  return fetch(`${API}/repos/${VAULT.owner}/${VAULT.repo}${path}`, { headers: headers(token, accept), cache: 'no-store' });
}

const OFFLINE = 'Could not reach GitHub. Check your connection and tap Refresh.';
const EXPIRED = 'GitHub stopped accepting your token. It may have expired. Tap Remove token and paste a new one.';

// Confirms the token can reach the vault and write to it.
export async function checkToken(token) {
  let res;
  try { res = await vault(token, ''); }
  catch { return { ok: false, reason: OFFLINE.replace(' and tap Refresh', ' and try again') }; }
  if (res.status === 401) return { ok: false, reason: 'GitHub did not accept that token. Copy it again and paste the whole thing.' };
  if (res.status === 404 || res.status === 403) return { ok: false, reason: 'That token cannot see second-brain-vault. Give it access to that repo.' };
  if (!res.ok) return { ok: false, reason: `GitHub answered ${res.status}. Try again in a minute.` };
  const repo = await res.json();
  if (repo.permissions && !repo.permissions.push) {
    return { ok: false, reason: 'That token can read the vault but not write to it. Set Contents to Read and write.' };
  }
  return { ok: true };
}

// UTF-8 safe base64 (emoji and accents included), in chunks so long notes don't overflow.
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Saves a thought as a new file in Inbox/. Never overwrites: if the name is
// taken (same second), it tries once more with -2. Returns { name }.
export async function saveCapture(token, text, now = new Date()) {
  const base = captureName(text, now);
  const body = { message: commitMessage(text), content: toBase64(captureFile(text, now)) };
  for (const name of [`${base}.md`, `${base}-2.md`]) {
    let res;
    try {
      res = await fetch(`${API}/repos/${VAULT.owner}/${VAULT.repo}/contents/Inbox/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { ...headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store'
      });
    } catch { throw new Error('Not saved: could not reach GitHub. Your text is still here, so try again.'); }
    if (res.ok) return { name };
    if (res.status === 422 || res.status === 409) continue; // name taken, try the next one
    if (res.status === 401) throw new Error(EXPIRED);
    if (res.status === 403 || res.status === 404) throw new Error('Not saved: this token cannot write to second-brain-vault. Check that Contents is set to Read and write.');
    throw new Error(`Not saved: GitHub answered ${res.status}. Your text is still here, so try again.`);
  }
  throw new Error('Not saved: two captures landed in the same second. Tap Save again.');
}

// The newest note in Daily/, as { date: 'YYYY-MM-DD', text }, or null if there are none.
export async function latestDaily(token) {
  let res;
  try { res = await vault(token, '/contents/Daily'); } catch { throw new Error(OFFLINE); }
  if (res.status === 401) throw new Error(EXPIRED);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}. Tap Refresh in a minute.`);
  const list = await res.json();
  const days = (Array.isArray(list) ? list : [])
    .filter(f => f.type === 'file' && DAY_FILE.test(f.name))
    .map(f => f.name)
    .sort()
    .reverse();
  if (!days.length) return null;

  let file;
  try { file = await vault(token, `/contents/Daily/${encodeURIComponent(days[0])}`, 'application/vnd.github.raw+json'); }
  catch { throw new Error(OFFLINE); }
  if (file.status === 401) throw new Error(EXPIRED);
  if (!file.ok) throw new Error(`GitHub answered ${file.status} for ${days[0]}. Tap Refresh in a minute.`);
  return { date: days[0].slice(0, 10), text: await file.text() };
}
