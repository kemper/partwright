const fs = require('fs');
const file = process.argv[2], out = process.argv[3] || '/tmp/thumb.png';
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const v = d.versions[d.versions.length - 1];
const t = v.thumbnail;
if (!t) { console.error('no thumbnail'); process.exit(1); }
const b64 = t.replace(/^data:image\/\w+;base64,/, '');
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log('wrote', out, 'label=', v.label, 'regions=', (v.colorRegions||[]).length);
