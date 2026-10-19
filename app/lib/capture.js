// Turns a captured thought into an Inbox file: a readable, sortable name and
// a small frontmatter block Obsidian understands. Pure functions, easy to test.
const pad = n => String(n).padStart(2, '0');

export function stamp(d = new Date()) {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const off = -d.getTimezoneOffset();
  const zone = `${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  const iso = `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone}`;
  return { day, time, iso };
}

// First few words of the first line, lowercase, letters and numbers only:
// "Call mom about Sunday!" -> "call-mom-about-sunday"
export function slug(text) {
  return text.trim().split(/\r?\n/)[0].toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ').trim().split(/\s+/).slice(0, 6).join('-')
    .slice(0, 40).replace(/-+$/, '');
}

// Inbox/2026-10-19-061512-call-mom-about-sunday (no .md, so a -2 can be added if taken)
export function captureName(text, d = new Date()) {
  const { day, time } = stamp(d);
  const s = slug(text);
  return `${day}-${time}${s ? '-' + s : ''}`;
}

export function captureFile(text, d = new Date()) {
  return `---\ncreated: ${stamp(d).iso}\nsource: web\n---\n\n${text.trim()}\n`;
}

export function commitMessage(text) {
  const first = text.trim().split(/\r?\n/)[0];
  return `Capture: ${first.length > 60 ? first.slice(0, 57) + '...' : first}`;
}
