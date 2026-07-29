import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist');
const wasm = fs.readFileSync(path.join(dist, 'ort-wasm-simd-threaded.jsep.wasm'));
const embeddedWasm = zlib.gzipSync(wasm, { level: 9 }).toString('base64');
const wasmModule = fs.readFileSync(path.join(dist, 'ort-wasm-simd-threaded.jsep.mjs'), 'utf8')
  .replace('n="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type', 'n=false')
  .replace("var isNode = typeof globalThis.process?.versions?.node == 'string';\nif (isNode) isPthread = (await import('worker_threads')).workerData === 'em-pthread';", 'var isNode = false;')
  .replace('Xa??=e.locateFile?e.locateFile?e.locateFile("ort-wasm-simd-threaded.jsep.wasm",v):v+"ort-wasm-simd-threaded.jsep.wasm":(new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url)).href', 'Xa??="embedded.wasm"');
if (!wasmModule.includes('n=false') || !wasmModule.includes('var isNode = false;') || !wasmModule.includes('Xa??="embedded.wasm"')) {
  throw new Error('Could not prepare the embedded browser WASM module');
}
const embeddedModule = zlib.gzipSync(wasmModule, { level: 9 }).toString('base64');
const source = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8')
  .replace('const EMBEDDED_WASM_GZIP = null;', `const EMBEDDED_WASM_GZIP = '${embeddedWasm}';`)
  .replace('const EMBEDDED_WASM_MODULE_GZIP = null;', `const EMBEDDED_WASM_MODULE_GZIP = '${embeddedModule}';`);

await build({
  stdin: { contents: source, resolveDir: path.join(root, 'src'), sourcefile: 'main.js', loader: 'js' },
  outfile: path.join(root, 'main.js'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  external: ['obsidian', 'electron', 'fs', 'path', 'zlib', 'node:*'],
  conditions: ['browser', 'module', 'import'],
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' },
  legalComments: 'none',
  logLevel: 'warning'
});
