// Use before source-directory deployments; build.cjs also versions the dist copy.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let pages = 0;
for (const name of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
  const file = path.join(root, name);
  const original = fs.readFileSync(file, 'utf8');
  const updated = original.replace(/((?:src|href)=["'])(\/assets\/[^"'?]+\.(?:js|css))(?:\?[^"']*)?(["'])/g, (match, prefix, asset, quote) => {
    const local = path.join(root, asset);
    if (!fs.existsSync(local)) return match;
    const hash = createHash('sha256').update(fs.readFileSync(local)).digest('hex').slice(0, 12);
    return `${prefix}${asset}?v=${hash}${quote}`;
  });
  if (updated !== original) { fs.writeFileSync(file, updated); pages++; }
}
console.log(`Versioned asset links in ${pages} source pages.`);
