<script>
  import { hasLockedToken, lockToken, unlockToken, forgetToken } from './lib/lock.js';
  import { checkToken } from './lib/github.js';

  // setup: no token on this device yet. locked: token saved, needs the PIN.
  // unlocked: token in memory, ready for the next steps (today's note, capture).
  let mode = $state(hasLockedToken() ? 'locked' : 'setup');
  let token = null; // unlocked token, memory only

  let newToken = $state('');
  let newPin = $state('');
  let pin = $state('');
  let busy = $state(false);
  let error = $state('');

  const pinOk = p => /^\d{4,8}$/.test(p);
  let canSave = $derived(newToken.trim().length > 20 && pinOk(newPin) && !busy);
  let canUnlock = $derived(pinOk(pin) && !busy);

  async function save(e) {
    e.preventDefault();
    if (!canSave) return;
    busy = true; error = '';
    const t = newToken.trim();
    const check = await checkToken(t);
    if (!check.ok) { error = check.reason; busy = false; return; }
    try {
      await lockToken(t, newPin);
      token = t; newToken = ''; newPin = ''; mode = 'unlocked';
    } catch (err) { error = err.message; }
    busy = false;
  }

  async function unlock(e) {
    e.preventDefault();
    if (!canUnlock) return;
    busy = true; error = '';
    const t = await unlockToken(pin);
    pin = '';
    if (t) { token = t; mode = 'unlocked'; }
    else error = 'Wrong PIN. Try again.';
    busy = false;
  }

  function lock() { token = null; error = ''; mode = 'locked'; }

  function forget() {
    if (!confirm('Remove the saved token from this device? You will paste it again next time.')) return;
    forgetToken(); token = null; error = ''; mode = 'setup';
  }
</script>

<main class="wrap">
  <h1 id="title">🧠 Second Brain</h1>
  <p class="sub">Your day from Notion, and a place to drop a thought.</p>

  {#if mode === 'setup'}
    <form class="card" id="setup" onsubmit={save}>
      <h2>🔑 Set up this device</h2>
      <p class="note">Paste your GitHub token once and pick a PIN. The token is locked with your PIN and saved only on this device.</p>
      <label class="label" for="token">GitHub token</label>
      <input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="github_pat_..." bind:value={newToken}>
      <label class="label" for="newPin">PIN (4 to 8 digits)</label>
      <input id="newPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"
        bind:value={newPin}>
      <button class="primary" id="save" type="submit" disabled={!canSave}>{busy ? 'Checking...' : 'Lock and save'}</button>
    </form>
  {:else if mode === 'locked'}
    <form class="card" id="unlockForm" onsubmit={unlock}>
      <h2>🔒 Locked</h2>
      <label class="label" for="pin">PIN</label>
      <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8"
        bind:value={pin}>
      <button class="primary" id="unlock" type="submit" disabled={!canUnlock}>{busy ? 'Unlocking...' : 'Unlock'}</button>
      <button class="link" type="button" id="forget" onclick={forget}>Forgot PIN? Remove the token from this device</button>
    </form>
  {:else}
    <section class="card" id="unlocked">
      <h2>✅ Unlocked</h2>
      <p class="note">Connected to second-brain-vault. Today's note and the capture box come next.</p>
      <div class="row">
        <button class="ghost" id="lock" type="button" onclick={lock}>Lock</button>
        <button class="ghost" type="button" id="forgetUnlocked" onclick={forget}>Remove token</button>
      </div>
    </section>
  {/if}

  <p class="error" id="error" role="alert" hidden={!error}>{error}</p>
</main>
