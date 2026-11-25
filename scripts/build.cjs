const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const cli = process.env.DROPLET_TAILWIND_CLI || require.resolve('tailwindcss/lib/cli.js');
execFileSync(process.execPath, [cli, '-c', path.join(root, 'tailwind.config.cjs'), '-i', path.join(root, 'scripts/toolkit-input.css'), '-o', path.join(root, 'assets/toolkit.css'), '--minify'], { cwd: root, stdio: 'inherit' });
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
const allowed = /\.(html|js|css|json|png|jpg|jpeg|svg|ico|webmanifest|txt|xml)$/i;
const ignored = new Set(['vendor-sources.json', 'package.json', 'package-lock.json']);
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && allowed.test(entry.name) && !ignored.has(entry.name)) fs.copyFileSync(path.join(root, entry.name), path.join(dist, entry.name));
}
for (const folder of ['assets', 'voice-engine']) {
  if (fs.existsSync(path.join(root, folder))) fs.cpSync(path.join(root, folder), path.join(dist, folder), { recursive: true });
}
fs.copyFileSync(path.join(root, 'vendor-sources.json'), path.join(dist, 'assets/vendor/sources.json'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));
// A returning visitor must receive the matching stylesheet and engine for each page.
for (const name of fs.readdirSync(dist).filter(name => name.endsWith('.html'))) {
  const file = path.join(dist, name);
  const html = fs.readFileSync(file, 'utf8').replace(/((?:src|href)=["'])(\/assets\/[^"'?]+\.(?:js|css))(?:\?[^"']*)?(["'])/g, (match, prefix, asset, quote) => {
    const local = path.join(dist, asset);
    if (!fs.existsSync(local)) return match;
    const hash = createHash('sha256').update(fs.readFileSync(local)).digest('hex').slice(0, 12);
    return `${prefix}${asset}?v=${hash}${quote}`;
  });
  fs.writeFileSync(file, html);
}
console.log('Built upload-ready files in dist/.');
