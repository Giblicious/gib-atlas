import fs from 'node:fs';
import { TEXT_SIGNAL_PROFILES, TEXT_SIGNALS } from '../src/text-signals.js';
import { MobileSearchRuntime } from '../src/mobile-runtime.js';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
for (const file of ['main.js', 'manifest.json', 'styles.css', 'versions.json', 'package.json', 'package-lock.json']) {
  if (!fs.existsSync(new URL(file, root))) throw new Error(`${file} is missing`);
}

const manifest = JSON.parse(read('manifest.json'));
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const versions = JSON.parse(read('versions.json'));
if (manifest.id !== 'gib-atlas' || manifest.name !== 'Gib Atlas') throw new Error('Unexpected manifest identity');
if (manifest.version !== packageJson.version || packageLock.version !== manifest.version || packageLock.packages?.['']?.version !== manifest.version) throw new Error('Version surfaces disagree');
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error('versions.json is missing the release version');
if (manifest.isDesktopOnly !== false) throw new Error('Gib Atlas must remain mobile-compatible');

const source = read('src/main.js'), runtime = read('src/mobile-runtime.js'), styles = read('styles.css'), bundle = read('main.js');
for (const marker of ['class LivingSemanticMapCanvas', 'buildQueryMapModel', 'beginQuery(query, true)', 'SemanticMapWebGLRenderer', 'atlasRelationshipField', 'configureAtlasDimensionSelect', 'atlasProfilePolar', 'atlasProfileAngle', 'EMOTION_FAMILIES', 'atlasCompassSegments', 'communityFallbackLabel', 'atlasCompassGeometry', 'drawPerspectiveCompass', 'paintSemanticMycelium', 'buildMyceliumSkeleton', 'validMapVisualization', 'ambientAngle() { return 0; }', 'gib-atlas-compass-context', 'renderColorKey']) {
  if (!source.includes(marker)) throw new Error(`Graph source is missing ${marker}`);
}
for (const marker of ['paintSemanticMycelium', 'buildMyceliumSkeleton', 'gib-atlas-map-mycelium']) {
  if (!bundle.includes(marker)) throw new Error(`Built plugin is missing ${marker}`);
}
for (const removed of ['paintSemanticFabric', 'fabricTriangulation', 'gib-atlas-map-fabric']) {
  if (source.includes(removed) || bundle.includes(removed) || styles.includes(removed)) throw new Error(`Removed Fabric renderer remains in the release: ${removed}`);
}
for (const marker of [
  "queryRadius = .08 + (1 - relevance.get(entry.id)) * .72",
  'analyticalAngle = Number.isFinite',
  'async textSignalProfiles',
  'async indexingTurn()',
  'backgroundOnly = false',
  'if (this.plugin.eagerAtlasWarmup) this.warmGraphEvidence()',
  'Xenova/mobilebert-uncased-mnli',
  'wasmBinary = this.plugin.embeddedWasmBinary',
  'wasmPaths = { mjs: this.plugin.embeddedWasmModuleUrl }',
]) {
  if (!runtime.includes(marker) && !bundle.includes(marker)) throw new Error(`Runtime is missing ${marker}`);
}
for (const signal of ['semantic', 'emotion', 'purpose', 'form', 'position']) {
  if (!TEXT_SIGNALS[signal]) throw new Error(`Missing ${signal} signal`);
}
if (TEXT_SIGNAL_PROFILES.emotion.length < 20 || TEXT_SIGNAL_PROFILES.purpose.length < 6 || TEXT_SIGNAL_PROFILES.form.length < 5 || TEXT_SIGNAL_PROFILES.position.length < 5) throw new Error('Writing-quality profiles are incomplete');
for (const marker of ['gib-atlas-dimension-select', 'gib-atlas-map-detail-analysis', 'gib-atlas-map-stage', 'gib-atlas-map-visualization', 'gib-atlas-map-mycelium', 'gib-atlas-color-key']) {
  if (!styles.includes(marker)) throw new Error(`Styles are missing ${marker}`);
}
for (const forbidden of ['gib-search', 'Terrain laboratory', 'gib-atlas-terrain-lab', 'Ridge pen', 'buildLandPartition']) {
  if (source.includes(forbidden) || styles.includes(forbidden) || bundle.includes(forbidden)) throw new Error(`Legacy marker remains: ${forbidden}`);
}

const basisVector = index => { const vector = new Float32Array(384); vector[index] = 1; return vector; };
const normalizedVector = values => { const vector = new Float32Array(384); for (const [index, value] of values) vector[index] = value; const length = Math.hypot(...vector); for (let index = 0; index < vector.length; index++) vector[index] /= length; return vector; };
const vectors = new Map([
  ['a.md', normalizedVector([[0, .9], [1, .44]])],
  ['b.md', normalizedVector([[0, .72], [2, .69]])],
  ['c.md', normalizedVector([[0, .45], [1, -.89]])],
]);
const runtimePlugin = { app: { vault: { adapter: { getBasePath: () => '/test' }, configDir: '.obsidian', getName: () => 'test' } }, manifest: { id: 'gib-atlas' }, settings: { mapTuning: {} }, isMobile: false };
const testRuntime = new MobileSearchRuntime(runtimePlugin);
testRuntime.fileVectors = files => new Map((files || [...vectors.keys()]).filter(file => vectors.has(file)).map(file => [file, { vector: vectors.get(file) }]));
testRuntime.queryVector = async () => basisVector(0);
testRuntime.correctQuery = value => value;
testRuntime.topicBasis = () => ({ center: basisVector(0), axes: [basisVector(1), basisVector(2)] });
testRuntime.fileEntities = files => new Map(files.map(file => [file, new Set()]));
const layoutNodes = [{ id: 'a.md', relevance: .95, generation: 1 }, { id: 'b.md', relevance: .6, generation: 1 }, { id: 'c.md', relevance: .2, generation: 1 }];
const semanticLayout = await testRuntime.multiRelationalLayout('query', layoutNodes, new Map(), { lens: 'relevance' });
for (const node of layoutNodes) {
  const point = semanticLayout.get(node.id), expected = .08 + (1 - node.relevance) * .72;
  if (!point || Math.abs(Math.hypot(point.x, point.y) - expected) > .002) throw new Error('Query relevance no longer controls radial distance');
}
const emotionProfiles = new Map([
  ['a.md', { scores: { 'emotion:joy': .9, 'emotion:sadness': .1 } }],
  ['b.md', { scores: { 'emotion:joy': .85, 'emotion:sadness': .15 } }],
  ['c.md', { scores: { 'emotion:joy': .1, 'emotion:sadness': .9 } }],
]);
const emotionLayout = await testRuntime.multiRelationalLayout('query', layoutNodes, new Map(), { lens: 'relevance', relationshipField: { weights: { emotion: 1 }, profiles: new Map([['emotion', emotionProfiles]]) } });
const angle = point => Math.atan2(point.y, point.x), angleDistance = (first, second) => Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
if (!(angleDistance(angle(emotionLayout.get('a.md')), angle(emotionLayout.get('b.md'))) < angleDistance(angle(emotionLayout.get('a.md')), angle(emotionLayout.get('c.md'))))) throw new Error('Emotion profiles do not influence angular placement');
const radialField = { weights: { emotion: 1 }, profiles: new Map([['emotion', emotionProfiles]]), profilePolar: new Map([
  ['a.md', { angle: 0, strength: .9 }], ['b.md', { angle: Math.PI / 2, strength: .5 }], ['c.md', { angle: Math.PI, strength: .15 }],
]) };
const radialLayout = await testRuntime.multiRelationalLayout('', layoutNodes, new Map(), { lens: 'relevance', vaultCenter: true, relationshipField: radialField });
for (const [file, polar] of radialField.profilePolar) { const point = radialLayout.get(file), expectedRadius = (.1 + polar.strength * .7) * ((.68 + .55 * .28) / .73); if (!point || angleDistance(angle(point), polar.angle) > .002 || Math.abs(Math.hypot(point.x, point.y) - expectedRadius) > .002) throw new Error('Analytical perspective is not radially organized'); }

console.log(`Gib Atlas ${manifest.version}: graph, local analysis, mobile runtime, and BRAT assets are valid (${(bundle.length / 1024 / 1024).toFixed(1)} MB bundle).`);
