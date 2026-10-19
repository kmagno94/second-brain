// Locks the GitHub token behind a PIN with the browser's own crypto (Web Crypto).
// Only the locked copy is ever saved, and only on this device. The unlocked
// token lives in memory until the page closes.
const KEY = 'sb.lock.v1';
const ITERATIONS = 600000; // PBKDF2 rounds: makes each PIN guess slow.

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function keyFromPin(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export function hasLockedToken() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export async function lockToken(token, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPin(pin, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  const saved = JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
  try { localStorage.setItem(KEY, saved); } catch { throw new Error('This browser would not save the locked token. Private browsing blocks it.'); }
}

// Returns the token, or null for a wrong PIN.
export async function unlockToken(pin) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { saved = null; }
  if (!saved) return null;
  try {
    const key = await keyFromPin(pin, unb64(saved.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(saved.iv) }, key, unb64(saved.ct));
    return dec.decode(pt);
  } catch { return null; }
}

export function forgetToken() {
  try { localStorage.removeItem(KEY); } catch { /* nothing saved */ }
}
