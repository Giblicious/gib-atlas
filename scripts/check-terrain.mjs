import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../src/terrain-lab.js', import.meta.url), 'utf8');
function shader(name) {
  const match = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
  if (!match) throw new Error(`Could not extract ${name}`);
  return match[1].replaceAll('${MAX_GEOMETRY}', '32');
}

const vertex = shader('VERTEX_SHADER');
const height = shader('HEIGHT_SHADER');
const relief = shader('RELIEF_SHADER');
const html = `<!doctype html><meta charset="utf-8"><body>RUNNING<script>
const sources=${JSON.stringify({ vertex, height, relief })};
const canvas=document.createElement('canvas');
const gl=canvas.getContext('webgl2');
if(!gl){document.body.textContent='FAIL WebGL2 unavailable';}else{
  function compile(type,source){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;}
  function link(fragment){const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,sources.vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));return program;}
  try{link(sources.height);link(sources.relief);document.body.textContent='PASS';}catch(error){document.body.textContent='FAIL '+error.message;}
}
</script></body>`;

const testPath = path.join(os.tmpdir(), `gib-atlas-terrain-${process.pid}.html`);
fs.writeFileSync(testPath, html);
const candidates = process.platform === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = candidates.find((candidate) => fs.existsSync(candidate));
if (!browser) {
  fs.rmSync(testPath, { force: true });
  console.log('Terrain shader browser check skipped: Chrome or Edge was not found.');
  process.exit(0);
}
const result = spawnSync(browser, ['--headless=new', '--disable-gpu-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--dump-dom', `file:///${testPath.replaceAll('\\', '/')}`], { encoding: 'utf8', timeout: 30000 });
fs.rmSync(testPath, { force: true });
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (!output.includes('<body>PASS</body>')) throw new Error(`Terrain shader check failed.\n${output.slice(-2000)}`);
console.log('Terrain shaders compile in WebGL 2.');
