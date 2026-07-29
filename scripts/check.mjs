import fs from 'node:fs';

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  if (!fs.existsSync(new URL(`../${file}`, import.meta.url))) throw new Error(`${file} is missing`);
}
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
if (manifest.id !== 'gib-atlas' || manifest.version !== '0.1.0') throw new Error('Unexpected manifest identity');
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
for (const marker of ['Gib Atlas', 'Xenova/bge-small-en-v1.5', 'VIEW_TYPE']) {
  if (!main.includes(marker)) throw new Error(`Bundle is missing ${marker}`);
}
console.log(`Gib Atlas ${manifest.version}: release files are valid (${(main.length / 1024 / 1024).toFixed(1)} MB bundle).`);
