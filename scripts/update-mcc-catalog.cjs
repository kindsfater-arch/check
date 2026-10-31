// Import only the JSON string from NSPK's public commission calculator bundle.
// No source JavaScript from the downloaded bundle is executed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const catalogPath = path.join(root, 'data', 'mcc-catalog.json');
const htmlPath = path.join(root, 'index.html');
const [bundlePath, bundleUrl] = process.argv.slice(2);

if (bundlePath) {
  if (!bundleUrl || !bundleUrl.startsWith('https://sbp.nspk.ru/_nuxt/')) {
    throw new Error('Usage: node scripts/update-mcc-catalog.cjs bundle.js https://sbp.nspk.ru/_nuxt/<bundle>.js');
  }
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  // The regex admits only a single quoted string literal, never executable code.
  const literal = [...bundle.matchAll(/JSON\.parse\(('(?:[^'\\]|\\.)*')\)/g)]
    .map(match => match[1]).find(value => value.includes('"Code"') && value.includes('"Text"'));
  if (!literal) throw new Error('MCC data was not found in this bundle.');
  const rows = JSON.parse(vm.runInNewContext(literal, Object.create(null), { timeout: 100 }));
  if (!Array.isArray(rows) || rows.length < 500) throw new Error('Incomplete MCC catalog.');
  const entries = Object.create(null);
  for (const row of rows) {
    if (!Number.isInteger(row.Code) || row.Code < 1 || row.Code > 9999 ||
        typeof row.Text !== 'string' || !row.Text.trim()) throw new Error('Invalid MCC entry.');
    const code = String(row.Code).padStart(4, '0');
    if (Object.hasOwn(entries, code)) throw new Error('Duplicate MCC: ' + code);
    entries[code] = row.Text.trim();
  }
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, JSON.stringify({
    source: 'https://sbp.nspk.ru/business/accepting-payments#business-commission-726',
    source_bundle: bundleUrl,
    source_sha256: crypto.createHash('sha256').update(bundle).digest('hex'),
    retrieved_on: new Date().toISOString().slice(0, 10),
    entries
  }, null, 2) + '\n');
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
// Keep index.html standalone; escaping '<' also prevents a closing script tag.
const json = JSON.stringify(catalog).replace(/</g, '\\u003c');
const block = '<!-- MCC_CATALOG_START -->\n<script type="application/json" id="mccCatalog">' + json + '</script>\n<!-- MCC_CATALOG_END -->';
const html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('<!-- MCC_CATALOG_START -->')) throw new Error('Missing catalog placeholder.');
fs.writeFileSync(htmlPath, html.replace(/<!-- MCC_CATALOG_START -->[\s\S]*?<!-- MCC_CATALOG_END -->/, () => block));
console.log('Embedded ' + Object.keys(catalog.entries).length + ' MCC descriptions.');
