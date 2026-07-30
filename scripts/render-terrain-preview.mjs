import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../src/terrain-lab.js', import.meta.url), 'utf8');
function template(name) {
  const match = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
  if (!match) throw new Error(`Could not extract ${name}`);
  return match[1];
}
function between(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  if (first < 0 || last < 0) throw new Error(`Could not extract ${start}`);
  return source.slice(first, last);
}

const pathsMatch = source.match(/const DEFAULT_TERRAIN_PATHS = (\[[\s\S]*?\n\]);/);
if (!pathsMatch) throw new Error('Could not extract default terrain paths');
const defaultPaths = Function(`return ${pathsMatch[1]}`)();
const rendererCode = between('function compileShader', 'class TerrainLabView');
const brushCode = between('function stampField', 'function encodeBrush');
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gib-atlas-terrain-preview.png'));
const contours = !process.argv.includes('--no-contours');
const packed = process.argv.includes('--packed');
const htmlPath = path.join(os.tmpdir(), `gib-atlas-terrain-preview-${process.pid}.html`);
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#d8d0bd}canvas{display:block;width:1400px;height:900px}</style><canvas id="canvas"></canvas><script>
const BRUSH_WIDTH=384,BRUSH_HEIGHT=240;
const DEFAULT_TERRAIN_PATHS=${JSON.stringify(defaultPaths)};
const VERTEX_SHADER=${JSON.stringify(template('VERTEX_SHADER'))};
const HEIGHT_SHADER=${JSON.stringify(template('HEIGHT_SHADER'))};
const RELIEF_SHADER=${JSON.stringify(template('RELIEF_SHADER'))};
${brushCode}
${rendererCode}
const canvas=document.getElementById('canvas');
const renderer=new TerrainRenderer(canvas,false);
if(${packed}) renderer.floatTarget=false;
renderer.resize(1400,900,1);
renderer.render(DEFAULT_TERRAIN_PATHS,defaultBrushData(),1,37,'refined',${contours});
document.title='READY';
</script>`;
fs.writeFileSync(htmlPath, html);
const candidates = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const browser = candidates.find((candidate) => fs.existsSync(candidate));
if (!browser) throw new Error('Chrome or Edge was not found');
const result = spawnSync(browser, ['--headless=new', '--disable-gpu-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--hide-scrollbars', '--window-size=1400,900', `--screenshot=${output}`, `file:///${htmlPath.replaceAll('\\', '/')}`], { encoding: 'utf8', timeout: 60000 });
fs.rmSync(htmlPath, { force: true });
if (result.status !== 0 || !fs.existsSync(output)) throw new Error(`${result.stderr || result.stdout || 'Preview render failed'}`);
console.log(output);
