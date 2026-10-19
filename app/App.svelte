<script>
  import { hasLockedToken, lockToken, unlockToken, forgetToken } from './lib/lock.js';
  import { checkToken, latestDaily, saveCapture } from './lib/github.js';
  import { renderMarkdown } from './lib/markdown.js';

  // setup: no token on this device yet. locked: token saved, needs the PIN.
  // unlocked: token in memory, showing the newest daily note.
  let mode = $state(hasLockedToken() ? 'locked' : 'setup');
  let token = null; // unlocked token, memory only

  // Daily note: loading, ready, empty (no notes yet), or error.
  let noteState = $state('loading');
  let note = $state(null); // { date, html }
  let noteError = $state('');

  function localDay(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  let noteLabel = $derived(!note ? '' : note.date === localDay() ? 'Today'
    : note.date === localDay(-1) ? 'Yesterday' : 'Latest note');

  async function loadNote() {
    if (!token) return;
    noteState = 'loading'; noteError = '';
    try {
      const found = await latestDaily(token);
      if (!found) { note = null; noteState = 'empty'; return; }
      note = { date: found.date, html: renderMarkdown(found.text) };
      noteState = 'ready';
    } catch (err) {
      noteError = err.message; noteState = 'error';
    }
  }

  function opened() { mode = 'unlocked'; loadNote(); }

  // Capture box: each save is a new file in the vault's Inbox/.
  let thought = $state('');
  let saving = $state(false);
  let savedName = $state('');
  let captureError = $state('');
  let canCapture = $derived(thought.trim().length > 0 && !saving);

  async function capture(e) {
    e.preventDefault();
    if (!canCapture || !token) return;
    saving = true; savedName = ''; captureError = '';
    try {
      const { name } = await saveCapture(token, thought);
      thought = ''; savedName = name;
    } catch (err) {
      captureError = err.message; // the text stays in the box
    }
    saving = false;
  }

  function typing() { savedName = ''; captureError = ''; }

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
      token = t; newToken = ''; newPin = ''; opened();
    } catch (err) { error = err.message; }
    busy = false;
  }

  async function unlock(e) {
    e.preventDefault();
    if (!canUnlock) return;
    busy = true; error = '';
    const t = await unlockToken(pin);
    pin = '';
    if (t) { token = t; opened(); }
    else error = 'Wrong PIN. Try again.';
    busy = false;
  }

  function clearNote() {
    note = null; noteError = ''; noteState = 'loading';
    thought = ''; savedName = ''; captureError = '';
  }

  function lock() { token = null; error = ''; clearNote(); mode = 'locked'; }

  function forget() {
    if (!confirm('Remove the saved token from this device? You will paste it again next time.')) return;
    forgetToken(); token = null; error = ''; clearNote(); mode = 'setup';
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
    <form class="card" id="capture" onsubmit={capture}>
      <label class="label first" for="thought">💭 Capture a thought</label>
      <textarea id="thought" rows="3" placeholder="What's on your mind?" bind:value={thought} oninput={typing}></textarea>
      <button class="primary" id="saveThought" type="submit" disabled={!canCapture}>{saving ? 'Saving...' : 'Save to Inbox'}</button>
      <p class="ok" id="captureOk" role="status" hidden={!savedName}>✅ Saved to Inbox as {savedName}</p>
      <p class="error" id="captureError" role="alert" hidden={!captureError}>{captureError}</p>
    </form>

    <section class="card" id="unlocked">
      <div class="note-head">
        <span class="tag" id="noteLabel">📅 {noteState === 'ready' ? noteLabel : 'Daily note'}</span>
        <button class="small" id="refresh" type="button" onclick={loadNote} disabled={noteState === 'loading'}>
          {noteState === 'loading' ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {#if noteState === 'loading'}
        <p class="note" id="noteLoading">Getting your latest note...</p>
      {:else if noteState === 'empty'}
        <p class="note" id="noteEmpty">No daily notes yet. They show up here after the first Notion sync.</p>
      {:else if noteState === 'error'}
        <p class="error" id="noteError" role="alert">{noteError}</p>
      {:else}
        <!-- Safe: renderMarkdown escapes all note text before adding its own tags. -->
        <article class="md" id="noteBody" data-date={note.date}>{@html note.html}</article>
      {/if}
    </section>

    <div class="row">
      <button class="ghost" id="lock" type="button" onclick={lock}>Lock</button>
      <button class="ghost" type="button" id="forgetUnlocked" onclick={forget}>Remove token</button>
    </div>
  {/if}

  <p class="error" id="error" role="alert" hidden={!error}>{error}</p>
</main>
