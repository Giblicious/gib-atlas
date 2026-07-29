const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, setIcon } = require('obsidian');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline, env } = require('@huggingface/transformers');
const { UMAP } = require('umap-js');

const EMBEDDED_WASM_GZIP = null;
const EMBEDDED_WASM_MODULE_GZIP = null;
const VIEW_TYPE = 'gib-atlas-view';
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DEFAULT_SETTINGS = {
  folder: 'Atlas Demo',
  neighbors: 6,
  compactness: 0.18,
  collisionSpacing: 18,
  showConnections: true
};

function cachePath(root, request) {
  let key = typeof request === 'string' ? request : request?.url || String(request || '');
  try {
    const url = new URL(key);
    key = decodeURIComponent(url.pathname.replace(/^\//, '').replace('/resolve/main/', '/'));
  } catch {
    key = key.replace(/^\/?models\//, '').replace(/^\//, '');
  }
  const safe = key.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.' && part !== '..').join(path.sep);
  const target = path.resolve(root, safe);
  return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null;
}

class FileModelCache {
  constructor(root) { this.root = root; }
  async match(request) {
    const target = cachePath(this.root, request);
    if (!target || !fs.existsSync(target)) return undefined;
    const data = await fs.promises.readFile(target);
    return new Response(data, { headers: { 'Content-Length': String(data.length) } });
  }
  async put(request, response) {
    const target = cachePath(this.root, request);
    if (!target) throw new Error('Invalid model cache path');
    const data = Buffer.from(await response.arrayBuffer());
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.download`;
    await fs.promises.writeFile(temporary, data);
    await fs.promises.rename(temporary, target);
  }
}

function cleanDocument(file, source) {
  const body = source
    .replace(/^---\s*[\s\S]*?\n---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2 $1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, '')
    .replace(/[*_~`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${file.basename}. ${body}`.slice(0, 12000);
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashFiles(records) {
  let hash = 2166136261;
  for (const record of records) {
    const value = `${record.path}:${record.mtime}`;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function mutualEdges(vectors, k) {
  const nearest = vectors.map((vector, i) => vectors
    .map((other, j) => ({ j, score: i === j ? -Infinity : dot(vector, other) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(k, vectors.length - 1)));
  const sets = nearest.map((items) => new Set(items.map((item) => item.j)));
  const edges = [];
  for (let i = 0; i < nearest.length; i++) {
    for (const item of nearest[i]) {
      if (item.j > i && sets[item.j].has(i)) edges.push({ a: i, b: item.j, weight: item.score });
    }
  }
  return edges;
}

function normalizeLayout(points) {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const centered = points.map(([x, y]) => [x - cx, y - cy]);
  const distances = centered.map(([x, y]) => Math.hypot(x, y)).sort((a, b) => a - b);
  const scale = distances[Math.floor(distances.length * 0.9)] || 1;
  return centered.map(([x, y]) => ({ x: x / scale * 260, y: y / scale * 260 }));
}

function relaxCollisions(points, spacing) {
  const anchors = points.map((point) => ({ ...point }));
  for (let pass = 0; pass < 90; pass++) {
    const movement = points.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        let dx = points[j].x - points[i].x;
        let dy = points[j].y - points[i].y;
        let distance = Math.hypot(dx, dy);
        if (distance >= spacing) continue;
        if (distance < 0.001) { dx = ((i * 17 + j * 31) % 11) - 5; dy = ((i * 29 + j * 13) % 11) - 5; distance = Math.hypot(dx, dy) || 1; }
        const force = (spacing - distance) * 0.26;
        movement[i].x -= dx / distance * force;
        movement[i].y -= dy / distance * force;
        movement[j].x += dx / distance * force;
        movement[j].y += dy / distance * force;
      }
    }
    for (let i = 0; i < points.length; i++) {
      points[i].x += movement[i].x + (anchors[i].x - points[i].x) * 0.035;
      points[i].y += movement[i].y + (anchors[i].y - points[i].y) * 0.035;
    }
  }
  return points;
}

class AtlasView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.hovered = -1;
    this.drag = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Gib Atlas'; }
  getIcon() { return 'map'; }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('gib-atlas-view');
    const toolbar = this.contentEl.createDiv({ cls: 'gib-atlas-toolbar' });
    const identity = toolbar.createDiv({ cls: 'gib-atlas-identity' });
    const icon = identity.createSpan({ cls: 'gib-atlas-mark' });
    setIcon(icon, 'map');
    identity.createEl('strong', { text: 'Gib Atlas' });
    this.statusEl = toolbar.createDiv({ cls: 'gib-atlas-status', text: 'Preparing atlas…' });
    const fitButton = toolbar.createEl('button', { attr: { 'aria-label': 'Fit map' } });
    setIcon(fitButton, 'scan');
    fitButton.onclick = () => this.fit();
    const rebuildButton = toolbar.createEl('button', { text: 'Rebuild index' });
    rebuildButton.onclick = () => this.plugin.rebuild();
    this.stage = this.contentEl.createDiv({ cls: 'gib-atlas-stage' });
    this.canvas = this.stage.createEl('canvas');
    this.tip = this.stage.createDiv({ cls: 'gib-atlas-tip' });
    this.tip.hide();
    this.ctx = this.canvas.getContext('2d');
    this.resizeObserver = new ResizeObserver(() => { this.resize(); this.draw(); });
    this.resizeObserver.observe(this.stage);
    this.bindEvents();
    this.resize();
    this.refresh();
  }
  async onClose() { this.resizeObserver?.disconnect(); }
  refresh() {
    const count = this.plugin.layout?.records?.length || 0;
    this.statusEl.setText(this.plugin.status || (count ? `${count} notes · local semantic plane` : 'Index not built'));
    this.fit();
  }
  resize() {
    if (!this.canvas) return;
    const rect = this.stage.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ratio = ratio;
  }
  fit() {
    const layout = this.plugin.layout;
    if (!layout?.points?.length || !this.canvas) { this.draw(); return; }
    const xs = layout.points.map((p) => p.x), ys = layout.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = this.canvas.clientWidth || 1, height = this.canvas.clientHeight || 1;
    this.camera.x = (minX + maxX) / 2;
    this.camera.y = (minY + maxY) / 2;
    this.camera.zoom = Math.max(0.2, Math.min((width - 90) / Math.max(120, maxX - minX), (height - 90) / Math.max(120, maxY - minY)));
    this.draw();
  }
  worldToScreen(point) {
    return { x: (point.x - this.camera.x) * this.camera.zoom + this.canvas.clientWidth / 2, y: (point.y - this.camera.y) * this.camera.zoom + this.canvas.clientHeight / 2 };
  }
  screenToWorld(x, y) {
    return { x: (x - this.canvas.clientWidth / 2) / this.camera.zoom + this.camera.x, y: (y - this.canvas.clientHeight / 2) / this.camera.zoom + this.camera.y };
  }
  bindEvents() {
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left, sy = event.clientY - rect.top;
      const before = this.screenToWorld(sx, sy);
      this.camera.zoom = Math.max(0.15, Math.min(8, this.camera.zoom * Math.exp(-event.deltaY * 0.0012)));
      const after = this.screenToWorld(sx, sy);
      this.camera.x += before.x - after.x;
      this.camera.y += before.y - after.y;
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.drag = { x: event.clientX, y: event.clientY, cameraX: this.camera.x, cameraY: this.camera.y, moved: false };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.drag) {
        const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
        this.camera.x = this.drag.cameraX - dx / this.camera.zoom;
        this.camera.y = this.drag.cameraY - dy / this.camera.zoom;
        this.draw();
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const point = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      let nearest = -1, nearestDistance = 10 / this.camera.zoom;
      for (let i = 0; i < (this.plugin.layout?.points?.length || 0); i++) {
        const candidate = this.plugin.layout.points[i];
        const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (distance < nearestDistance) { nearest = i; nearestDistance = distance; }
      }
      this.hovered = nearest;
      if (nearest >= 0) {
        this.tip.setText(this.plugin.layout.records[nearest].name);
        this.tip.style.left = `${event.clientX - rect.left + 12}px`;
        this.tip.style.top = `${event.clientY - rect.top + 12}px`;
        this.tip.show();
      } else this.tip.hide();
      this.draw();
    });
    this.canvas.addEventListener('pointerup', async () => {
      const moved = this.drag?.moved;
      this.drag = null;
      if (!moved && this.hovered >= 0) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.layout.records[this.hovered].path);
        if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
      }
    });
    this.canvas.addEventListener('pointerleave', () => { this.drag = null; this.hovered = -1; this.tip.hide(); this.draw(); });
  }
  draw() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx, ratio = this.ratio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    const layout = this.plugin.layout;
    if (!layout?.points?.length) return;
    const style = getComputedStyle(this.contentEl);
    const muted = style.getPropertyValue('--text-muted').trim() || '#888';
    const accent = style.getPropertyValue('--interactive-accent').trim() || '#7c6ee6';
    if (this.plugin.settings.showConnections) {
      ctx.strokeStyle = muted;
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 0.8;
      for (const edge of layout.edges) {
        const a = this.worldToScreen(layout.points[edge.a]), b = this.worldToScreen(layout.points[edge.b]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < layout.points.length; i++) {
      const point = this.worldToScreen(layout.points[i]);
      const hovered = i === this.hovered;
      ctx.beginPath();
      ctx.arc(point.x, point.y, hovered ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = hovered ? accent : muted;
      ctx.globalAlpha = hovered ? 1 : 0.82;
      ctx.fill();
      if (hovered) {
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.28; ctx.lineWidth = 5; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

class AtlasSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Gib Atlas' });
    containerEl.createEl('p', { text: 'A small semantic-plane experiment. Rebuild after changing layout settings.' });
    new Setting(containerEl).setName('Source folder').setDesc('Only Markdown notes inside this folder are mapped.').addText((text) => text
      .setPlaceholder('Atlas Demo').setValue(this.plugin.settings.folder)
      .onChange(async (value) => { this.plugin.settings.folder = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Semantic neighbors').setDesc('Nearby notes used to establish local structure.').addSlider((slider) => slider
      .setLimits(3, 12, 1).setValue(this.plugin.settings.neighbors).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.neighbors = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Cluster compactness').setDesc('Lower values make close semantic neighborhoods tighter.').addSlider((slider) => slider
      .setLimits(0.05, 0.8, 0.05).setValue(this.plugin.settings.compactness).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.compactness = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Dot spacing').setDesc('Minimum visual separation after semantic placement.').addSlider((slider) => slider
      .setLimits(10, 32, 1).setValue(this.plugin.settings.collisionSpacing).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.collisionSpacing = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Show semantic connections').addToggle((toggle) => toggle
      .setValue(this.plugin.settings.showConnections)
      .onChange(async (value) => { this.plugin.settings.showConnections = value; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName('Rebuild semantic plane').setDesc('Re-embed changed notes and recalculate the layout.').addButton((button) => button
      .setButtonText('Rebuild').setCta().onClick(() => this.plugin.rebuild()));
  }
}

module.exports = class GibAtlasPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.layout = null;
    this.status = 'Loading cached atlas…';
    this.basePath = this.app.vault.adapter.getBasePath();
    this.pluginPath = path.join(this.basePath, this.app.vault.configDir, 'plugins', this.manifest.id);
    this.indexPath = path.join(this.pluginPath, 'atlas-index.json');
    this.registerView(VIEW_TYPE, (leaf) => new AtlasView(leaf, this));
    this.addRibbonIcon('map', 'Open Gib Atlas', () => this.activateView());
    this.addCommand({ id: 'open-atlas', name: 'Open semantic atlas', callback: () => this.activateView() });
    this.addCommand({ id: 'rebuild-atlas', name: 'Rebuild semantic atlas', callback: () => this.rebuild() });
    this.addSettingTab(new AtlasSettingTab(this.app, this));
    await this.loadIndex();
  }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
  refreshViews() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.refresh?.(); }
  setStatus(status) { this.status = status; this.refreshViews(); }
  async loadIndex() {
    try {
      if (!fs.existsSync(this.indexPath)) { this.status = 'Index not built'; return; }
      const parsed = JSON.parse(await fs.promises.readFile(this.indexPath, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.records) || !Array.isArray(parsed.points)) throw new Error('Unsupported cache');
      this.layout = parsed;
      this.status = `${parsed.records.length} notes · cached local atlas`;
      this.refreshViews();
    } catch (error) {
      console.error('Gib Atlas: failed to load index', error);
      this.status = 'Index needs rebuilding';
    }
  }
  async prepareModel() {
    if (this.extractor) return this.extractor;
    this.setStatus('Loading local semantic model…');
    const wasm = zlib.gunzipSync(Buffer.from(EMBEDDED_WASM_GZIP, 'base64'));
    const moduleSource = zlib.gunzipSync(Buffer.from(EMBEDDED_WASM_MODULE_GZIP, 'base64')).toString('utf8');
    const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useCustomCache = true;
    env.customCache = new FileModelCache(path.join(this.pluginPath, 'models'));
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = { mjs: moduleUrl, wasm };
    this.extractor = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      progress_callback: (event) => {
        if (event.status === 'progress' && Number.isFinite(event.progress)) this.setStatus(`Downloading model · ${Math.round(event.progress)}%`);
      }
    });
    return this.extractor;
  }
  async rebuild() {
    if (this.building) { new Notice('Gib Atlas is already rebuilding.'); return; }
    this.building = true;
    try {
      const prefix = this.settings.folder.replace(/^\/+|\/+$/g, '');
      const files = this.app.vault.getMarkdownFiles().filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`));
      files.sort((a, b) => a.path.localeCompare(b.path));
      if (files.length < 3) throw new Error(`Only ${files.length} notes found in “${prefix || '/'}”.`);
      const previous = this.layout?.records || [];
      const cached = new Map(previous.filter((record) => Array.isArray(record.vector)).map((record) => [record.path, record]));
      const extractor = await this.prepareModel();
      const records = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.setStatus(`Indexing ${i + 1} of ${files.length} · ${file.basename}`);
        const old = cached.get(file.path);
        let vector;
        if (old?.mtime === file.stat.mtime) vector = old.vector;
        else {
          const text = cleanDocument(file, await this.app.vault.cachedRead(file));
          const output = await extractor(text, { pooling: 'mean', normalize: true, truncation: true, max_length: 512 });
          vector = Array.from(output.data);
        }
        records.push({ path: file.path, name: file.basename, mtime: file.stat.mtime, vector });
        if (i % 2 === 1) await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      this.setStatus('Calculating semantic plane…');
      const vectors = records.map((record) => record.vector);
      const random = mulberry32(hashFiles(records));
      const umap = new UMAP({
        nComponents: 2,
        nNeighbors: Math.min(this.settings.neighbors, records.length - 1),
        minDist: this.settings.compactness,
        spread: 1,
        random,
        distanceFn: (a, b) => 1 - dot(a, b)
      });
      const points = relaxCollisions(normalizeLayout(umap.fit(vectors)), this.settings.collisionSpacing);
      const edges = mutualEdges(vectors, this.settings.neighbors);
      this.layout = { version: 1, model: MODEL_ID, createdAt: Date.now(), records, points, edges };
      await fs.promises.writeFile(this.indexPath, JSON.stringify(this.layout));
      this.status = `${records.length} notes · local semantic plane`;
      this.refreshViews();
      new Notice(`Gib Atlas mapped ${records.length} notes.`);
    } catch (error) {
      console.error('Gib Atlas: rebuild failed', error);
      this.setStatus(`Rebuild failed · ${error.message}`);
      new Notice(`Gib Atlas: ${error.message}`);
    } finally {
      this.building = false;
    }
  }
};
