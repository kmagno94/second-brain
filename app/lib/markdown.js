// A small, safe Markdown renderer for vault notes. Everything is escaped
// first, so HTML inside a note shows as text and never runs. Handles the
// parts the daily notes use: frontmatter, headings, nested bullets, quotes,
// rules, links (http and https only), bold, and inline code.
const esc = s => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

export function splitFrontmatter(text) {
  const meta = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

export function renderMarkdown(text) {
  const { body } = splitFrontmatter(text);
  const out = [];
  let para = [];
  let quote = [];
  const lists = []; // one entry per open <ul>: true when its <li> is open

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`); quote = []; } };
  const closeLists = (keep = 0) => {
    while (lists.length > keep) { if (lists.pop()) out.push('</li>'); out.push('</ul>'); }
  };
  const flushAll = () => { flushPara(); flushQuote(); closeLists(); };

  for (const raw of body.replace(/\t/g, '  ').split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushAll(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushAll();
      const level = Math.min(m[1].length + 1, 6); // the page title is the only h1
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll(); out.push('<hr>');
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flushPara(); closeLists(); quote.push(m[1]);
    } else if ((m = /^(\s*)[-*]\s+(.*)$/.exec(line))) {
      flushPara(); flushQuote();
      const depth = Math.min(Math.floor(m[1].length / 2), lists.length); // at most one level deeper
      if (depth === lists.length) { out.push('<ul>'); lists.push(false); }
      else closeLists(depth + 1);
      if (lists[depth]) out.push('</li>');
      out.push(`<li>${inline(m[2])}`);
      lists[depth] = true;
    } else {
      flushQuote(); closeLists(); para.push(line.trim());
    }
  }
  flushAll();
  return out.join('\n');
}
