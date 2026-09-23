/**
 * Renders the in-app legal documents to standalone HTML pages.
 *
 * Google Play needs the privacy policy at a public HTTPS URL. That policy and
 * the one shown inside the app must say the same thing, so rather than keep a
 * second copy by hand this reads the app's own
 * `mobile/src/constants/legalContent.ts` and renders it.
 *
 * It parses the file rather than importing it, so it needs no TypeScript
 * toolchain and cannot execute app code. The source is a plain array of
 * `{ type, text }` literals, which is why a parse is enough.
 *
 *   node web/build-legal-pages.js
 *
 * RE-RUN THIS WHENEVER legalContent.ts CHANGES, or the hosted policy silently
 * drifts from the one in the app — which is exactly the mismatch a Data Safety
 * review looks for.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SOURCE = path.join(REPO, 'mobile', 'src', 'constants', 'legalContent.ts');
const OUT_DIR = __dirname;

const DOCUMENTS = [
  { constName: 'PRIVACY_POLICY', slug: 'privacy-policy', fallbackTitle: 'Privacy Policy' },
  { constName: 'TERMS_AND_CONDITIONS', slug: 'terms', fallbackTitle: 'Terms & Conditions' },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Turns bare emails and URLs into links, after escaping. */
function linkify(text) {
  return escapeHtml(text)
    .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1">$1</a>')
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

/**
 * Pulls one exported const's block out of the source and reads its
 * `{ type: "...", text: "..." }` entries in order.
 */
function extractBlocks(source, constName) {
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) throw new Error(`${constName} not found in ${SOURCE}`);

  // The next top-level `export const` bounds this document.
  const rest = source.slice(start + 1);
  const nextExport = rest.indexOf('\nexport const ');
  const block = nextExport === -1 ? source.slice(start) : source.slice(start, start + 1 + nextExport);

  const titleMatch = block.match(/title:\s*(['"])(.*?)\1/);

  const entryPattern =
    /\{\s*type:\s*(['"])(heading|subheading|paragraph|bullet)\1\s*,\s*text:\s*(['"])((?:\\.|(?!\3)[\s\S])*?)\3\s*,?\s*\}/g;

  const entries = [];
  let match;
  while ((match = entryPattern.exec(block)) !== null) {
    const text = match[4]
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, ' ')
      .replace(/\\\\/g, '\\');
    entries.push({ type: match[2], text });
  }

  return { title: titleMatch ? titleMatch[2] : null, entries };
}

function renderBody(entries) {
  const html = [];
  let inList = false;

  for (const entry of entries) {
    if (entry.type === 'bullet') {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`  <li>${linkify(entry.text)}</li>`);
      continue;
    }
    if (inList) { html.push('</ul>'); inList = false; }

    if (entry.type === 'heading') html.push(`<h2>${escapeHtml(entry.text)}</h2>`);
    else if (entry.type === 'subheading') html.push(`<h3>${escapeHtml(entry.text)}</h3>`);
    else html.push(`<p>${linkify(entry.text)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

function renderPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Swachham Laundry</title>
<meta name="description" content="${escapeHtml(title)} for the Swachham Laundry application.">
<style>
  :root { --bg:#f6f8f6; --surface:#fff; --text:#17241b; --muted:#5b6b60; --line:#dde5df; --accent:#1f7a45; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--text);
         font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:760px; margin:0 auto; background:var(--surface);
         border:1px solid var(--line); border-radius:12px; padding:28px 24px; }
  header { text-align:center; margin-bottom:24px; }
  .brand { font-weight:700; color:var(--accent); font-size:1.25rem; }
  h1 { font-size:1.5rem; margin:6px 0 0; }
  h2 { font-size:1.15rem; margin:28px 0 8px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  h3 { font-size:1rem; margin:20px 0 6px; color:var(--accent); }
  p { margin:0 0 12px; }
  ul { margin:0 0 12px 22px; padding:0; }
  li { margin-bottom:6px; }
  a { color:var(--accent); }
  footer { max-width:760px; margin:18px auto 0; text-align:center; color:var(--muted); font-size:.85rem; }
</style>
</head>
<body>
<main>
  <header>
    <div class="brand">Swachham Laundry</div>
    <h1>${escapeHtml(title)}</h1>
  </header>
${bodyHtml}
</main>
<footer>
  Swachham Laundry &middot; <a href="mailto:info@swachham.co.in">info@swachham.co.in</a><br>
  To delete your account, see the <a href="../delete-account/">account deletion page</a>.
</footer>
</body>
</html>
`;
}

function main() {
  const source = fs.readFileSync(SOURCE, 'utf8');

  for (const doc of DOCUMENTS) {
    const { title, entries } = extractBlocks(source, doc.constName);
    if (entries.length === 0) {
      throw new Error(`No content entries parsed for ${doc.constName} — check the source format.`);
    }
    const dir = path.join(OUT_DIR, doc.slug);
    fs.mkdirSync(dir, { recursive: true });
    const page = renderPage(title || doc.fallbackTitle, renderBody(entries));
    fs.writeFileSync(path.join(dir, 'index.html'), page, 'utf8');
    console.log(`${doc.slug}/index.html  <- ${doc.constName}  (${entries.length} blocks)`);
  }
}

main();
