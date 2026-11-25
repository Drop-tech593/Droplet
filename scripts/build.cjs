const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
console.log('Built upload-ready files in dist/.');
