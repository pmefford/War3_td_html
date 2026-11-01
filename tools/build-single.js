// Bundles everything into dist/bastion-td.html (one file, works from file:// with no server).
const fs = require('fs'), path = require('path');
const r = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let html = r('index.html');
const svg = 'data:image/svg+xml;base64,' + Buffer.from(r('icons/icon.svg')).toString('base64');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '').replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '')
  .replace('<link rel="stylesheet" href="src/style.css">', '<style>' + r('src/style.css') + '</style>')
  .replace(/icons\/icon\.svg/g, svg);
for (const f of ['data', 'engine', 'ui']) html = html.replace(`<script src="src/${f}.js"></script>`, () => '<script>' + r(`src/${f}.js`) + '</script>');
fs.mkdirSync(path.join(__dirname, '../dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../dist/bastion-td.html'), html);
console.log('dist/bastion-td.html', (html.length / 1024).toFixed(0) + ' KB');
