import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasm = fs.readFileSync(path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.wasm'));
const embeddedWasm = zlib.gzipSync(wasm, { level: 9 }).toString('base64');
const wasmModulePath = path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.mjs');
const wasmModule = fs.readFileSync(wasmModulePath, 'utf8')
  .replace('n="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type', 'n=false')
  .replace("var isNode = typeof globalThis.process?.versions?.node == 'string';\nif (isNode) isPthread = (await import('worker_threads')).workerData === 'em-pthread';", 'var isNode = false;')
  .replace('Xa??=e.locateFile?e.locateFile?e.locateFile("ort-wasm-simd-threaded.jsep.wasm",v):v+"ort-wasm-simd-threaded.jsep.wasm":(new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url)).href', 'Xa??="embedded.wasm"');
if (!wasmModule.includes('n=false') || !wasmModule.includes('var isNode = false;') || !wasmModule.includes('Xa??="embedded.wasm"')) throw new Error('Could not prepare the browser-only WASM module');
const embeddedWasmModule = zlib.gzipSync(wasmModule, { level: 9 }).toString('base64');
const workerBuild = await build({
  entryPoints: [path.join(root, 'src', 'desktop-embed-worker.js')], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2020',
  conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' },
  logLevel: 'warning', legalComments: 'none',
});
const embeddedDesktopWorker = workerBuild.outputFiles[0].text;
const marker = 'const EMBEDDED_WASM_GZIP = null;';
const moduleMarker = 'const EMBEDDED_WASM_MODULE_GZIP = null;';
const workerMarker = 'const EMBEDDED_DESKTOP_WORKER = null;';
const source = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8')
  .replace(marker, `const EMBEDDED_WASM_GZIP = '${embeddedWasm}';`)
  .replace(moduleMarker, `const EMBEDDED_WASM_MODULE_GZIP = '${embeddedWasmModule}';`)
  .replace(workerMarker, () => `const EMBEDDED_DESKTOP_WORKER = ${JSON.stringify(embeddedDesktopWorker)};`);
await build({
  stdin: { contents: source, resolveDir: path.join(root, 'src'), sourcefile: 'main.js', loader: 'js' },
  outfile: path.join(root, 'main.js'), bundle: true, platform: 'browser', format: 'cjs', target: 'es2020',
  external: ['obsidian', 'electron', 'fs', 'path', 'os', 'crypto', 'node:*'],
  conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' },
  logLevel: 'warning', legalComments: 'none',
});
const outputPath = path.join(root, 'main.js');
fs.writeFileSync(outputPath, fs.readFileSync(outputPath, 'utf8').replace(/[ \t]+$/gm, ''));
