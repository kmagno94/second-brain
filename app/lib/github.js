// Talks to the private vault through GitHub's REST API, straight from the
// browser (GitHub allows this for any site). The token only ever goes in the
// Authorization header, never in a URL.
export const VAULT = { owner: 'kmagno94', repo: 'second-brain-vault' };
const API = 'https://api.github.com';

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

// Confirms the token can reach the vault and write to it.
export async function checkToken(token) {
  let res;
  try {
    res = await fetch(`${API}/repos/${VAULT.owner}/${VAULT.repo}`, { headers: headers(token) });
  } catch {
    return { ok: false, reason: 'Could not reach GitHub. Check your connection and try again.' };
  }
  if (res.status === 401) return { ok: false, reason: 'GitHub did not accept that token. Copy it again and paste the whole thing.' };
  if (res.status === 404 || res.status === 403) return { ok: false, reason: 'That token cannot see second-brain-vault. Give it access to that repo.' };
  if (!res.ok) return { ok: false, reason: `GitHub answered ${res.status}. Try again in a minute.` };
  const repo = await res.json();
  if (repo.permissions && !repo.permissions.push) {
    return { ok: false, reason: 'That token can read the vault but not write to it. Set Contents to Read and write.' };
  }
  return { ok: true };
}
