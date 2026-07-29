import fs from 'node:fs';

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  if (!fs.existsSync(new URL(`../${file}`, import.meta.url))) throw new Error(`${file} is missing`);
}
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
if (manifest.id !== 'gib-atlas' || manifest.version !== '0.2.1') throw new Error('Unexpected manifest identity');
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
for (const marker of ['Gib Atlas', 'Xenova/bge-small-en-v1.5', 'VIEW_TYPE', 'documentChunks', 'stableCommunities', 'buildRegionLabels', 'commonSignalRemoval']) {
  if (!main.includes(marker)) throw new Error(`Bundle is missing ${marker}`);
}
if (!main.includes('wasmBinary = wasm') || !main.includes('wasmPaths = { mjs: moduleUrl }')) {
  throw new Error('Embedded WASM bytes are not connected to the ONNX runtime');
}
console.log(`Gib Atlas ${manifest.version}: release files are valid (${(main.length / 1024 / 1024).toFixed(1)} MB bundle).`);
