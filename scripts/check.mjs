import fs from 'node:fs';

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  if (!fs.existsSync(new URL(`../${file}`, import.meta.url))) throw new Error(`${file} is missing`);
}
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
if (manifest.id !== 'gib-atlas' || manifest.version !== '0.6.0') throw new Error('Unexpected manifest identity');
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
for (const marker of ['Gib Atlas', 'Xenova/bge-small-en-v1.5', 'VIEW_TYPE', 'documentChunks', 'stableCommunities', 'buildRegionLabels', 'buildPropertyProfiles', 'buildLandPartition', 'powerPartition', 'commonSignalRemoval']) {
  if (!main.includes(marker)) throw new Error(`Bundle is missing ${marker}`);
}
for (const marker of ['Terrain laboratory', 'gib-atlas-terrain-lab', 'HEIGHT_SHADER', 'RELIEF_SHADER', 'Ridge pen', 'u_ridges', 'u_brush']) {
  if (!main.includes(marker)) throw new Error(`Bundle is missing terrain engine marker: ${marker}`);
}
if (manifest.isDesktopOnly !== false) throw new Error('Terrain laboratory release must remain mobile-compatible');
if (!main.includes('wasmBinary = wasm') || !main.includes('wasmPaths = { mjs: moduleUrl }')) {
  throw new Error('Embedded WASM bytes are not connected to the ONNX runtime');
}
console.log(`Gib Atlas ${manifest.version}: release files are valid (${(main.length / 1024 / 1024).toFixed(1)} MB bundle).`);
