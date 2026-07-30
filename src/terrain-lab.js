const { ItemView, Notice, Platform, setIcon } = require('obsidian');

const TERRAIN_VIEW_TYPE = 'gib-atlas-terrain-lab';
const MAX_GEOMETRY = 32;

const DEFAULT_TERRAIN_GEOMETRY = [
  { kind: 'ridge', ax: 0.06, ay: 0.72, bx: 0.38, by: 0.30, strength: 0.82, width: 0.075 },
  { kind: 'ridge', ax: 0.31, ay: 0.82, bx: 0.57, by: 0.42, strength: 0.92, width: 0.068 },
  { kind: 'ridge', ax: 0.55, ay: 0.70, bx: 0.91, by: 0.22, strength: 0.88, width: 0.072 },
  { kind: 'ridge', ax: 0.62, ay: 0.30, bx: 0.84, by: 0.12, strength: 0.72, width: 0.058 },
  { kind: 'ridge', ax: 0.10, ay: 0.26, bx: 0.27, by: 0.12, strength: 0.62, width: 0.062 },
  { kind: 'peak', ax: 0.34, ay: 0.31, bx: 0.34, by: 0.31, strength: 0.95, width: 0.105 },
  { kind: 'peak', ax: 0.57, ay: 0.43, bx: 0.57, by: 0.43, strength: 0.88, width: 0.096 },
  { kind: 'peak', ax: 0.78, ay: 0.25, bx: 0.78, by: 0.25, strength: 0.86, width: 0.085 },
  { kind: 'valley', ax: 0.08, ay: 0.53, bx: 0.85, by: 0.82, strength: 0.72, width: 0.055 },
  { kind: 'valley', ax: 0.42, ay: 0.08, bx: 0.48, by: 0.91, strength: 0.52, width: 0.044 }
];

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const HEIGHT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 out_color;
uniform float u_seed;
uniform int u_count;
uniform vec4 u_geometry_a[${MAX_GEOMETRY}];
uniform vec4 u_geometry_b[${MAX_GEOMETRY}];

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + u_seed * 0.017);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float total = 0.0, amplitude = 0.5;
  mat2 turn = mat2(0.80, -0.60, 0.60, 0.80);
  for (int octave = 0; octave < 5; octave++) {
    total += amplitude * noise2(p);
    p = turn * p * 2.03 + 17.1;
    amplitude *= 0.49;
  }
  return total;
}
float ridged(vec2 p) {
  float total = 0.0, amplitude = 0.55;
  mat2 turn = mat2(0.86, -0.51, 0.51, 0.86);
  for (int octave = 0; octave < 5; octave++) {
    float ridge = 1.0 - abs(noise2(p) * 2.0 - 1.0);
    total += amplitude * ridge * ridge;
    p = turn * p * 2.12 + 9.7;
    amplitude *= 0.48;
  }
  return total;
}
float segment_distance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.00001), 0.0, 1.0);
  return length(p - a - ab * t);
}
float geometry_field(vec2 p) {
  float field = 0.0;
  for (int index = 0; index < ${MAX_GEOMETRY}; index++) {
    if (index >= u_count) break;
    vec4 a = u_geometry_a[index];
    vec4 b = u_geometry_b[index];
    float kind = b.x;
    float strength = b.y;
    float width = max(0.018, b.z);
    float distance_value = kind < 0.5 ? length(p - a.xy) : segment_distance(p, a.xy, a.zw);
    float influence = exp(-pow(distance_value / width, 2.0));
    if (kind < 1.5) field += strength * influence;
    else field -= strength * influence;
  }
  return field;
}
float terrain_height(vec2 p) {
  vec2 seed_offset = vec2(u_seed * 0.013, u_seed * -0.009);
  vec2 warp = vec2(fbm(p * 2.2 + seed_offset), fbm(p * 2.2 + seed_offset + 31.7)) - 0.5;
  vec2 shaped = p + warp * 0.085;
  float geometry = geometry_field(shaped);
  float continental = fbm(shaped * 2.35 + seed_offset * 0.7) - 0.5;
  float mountain_detail = ridged(shaped * 7.4 + seed_offset * 1.9);
  float fine_detail = ridged(shaped * 20.0 + seed_offset * 3.1);
  float mountain_mask = smoothstep(0.05, 0.72, geometry + continental * 0.42);
  float height_value = 0.31 + continental * 0.16 + geometry * 0.37;
  height_value += mountain_detail * (0.055 + mountain_mask * 0.115);
  height_value += fine_detail * (0.010 + mountain_mask * 0.025);
  float terrace = smoothstep(0.0, 1.0, height_value);
  height_value = mix(height_value, terrace, 0.12);
  return clamp(height_value, 0.015, 0.985);
}
void main() {
  float height_value = terrain_height(v_uv);
  out_color = vec4(height_value, height_value, height_value, 1.0);
}`;

const RELIEF_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 out_color;
uniform sampler2D u_height;
uniform vec2 u_texel;
uniform vec2 u_viewport;
uniform float u_seed;
uniform float u_contours;

float height_at(vec2 uv) { return texture(u_height, clamp(uv, u_texel, 1.0 - u_texel)).r; }
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + u_seed * 0.017);
  return fract(p.x * p.y);
}
vec3 palette(float h, float rock) {
  vec3 low = vec3(0.30, 0.37, 0.15);
  vec3 meadow = vec3(0.48, 0.52, 0.20);
  vec3 dry = vec3(0.63, 0.56, 0.34);
  vec3 stone = vec3(0.56, 0.52, 0.47);
  vec3 pale = vec3(0.82, 0.78, 0.68);
  vec3 color = mix(low, meadow, smoothstep(0.18, 0.40, h));
  color = mix(color, dry, smoothstep(0.38, 0.60, h));
  color = mix(color, stone, smoothstep(0.57, 0.78, h));
  color = mix(color, pale, smoothstep(0.76, 0.94, h));
  color = mix(color, vec3(0.44, 0.40, 0.35), rock * 0.72);
  return color;
}
void main() {
  float h = height_at(v_uv);
  float left_h = height_at(v_uv - vec2(u_texel.x, 0.0));
  float right_h = height_at(v_uv + vec2(u_texel.x, 0.0));
  float down_h = height_at(v_uv - vec2(0.0, u_texel.y));
  float up_h = height_at(v_uv + vec2(0.0, u_texel.y));
  vec2 gradient = vec2(right_h - left_h, up_h - down_h);
  vec3 normal = normalize(vec3(-gradient.x * 32.0, -gradient.y * 32.0, 1.0));
  vec3 light = normalize(vec3(-0.58, 0.67, 0.46));
  float diffuse = max(0.0, dot(normal, light));
  float slope = 1.0 - normal.z;
  float rock = smoothstep(0.10, 0.58, slope) * smoothstep(0.25, 0.72, h);

  float cast_shadow = 0.0;
  vec2 ray = normalize(light.xy) * u_texel * 2.2;
  for (int step_index = 1; step_index <= 9; step_index++) {
    float step_value = float(step_index);
    float sample_h = height_at(v_uv + ray * step_value);
    float clearance = h + light.z * 0.0046 * step_value;
    cast_shadow += smoothstep(clearance, clearance + 0.022, sample_h) * (1.0 - step_value / 11.0);
  }
  cast_shadow = clamp(cast_shadow * 0.23, 0.0, 0.72);

  float occlusion = 0.0;
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(3.0, 2.0)) - h);
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(-3.0, 2.0)) - h);
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(2.0, -3.0)) - h);
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(-2.0, -3.0)) - h);
  occlusion = clamp(occlusion * 4.8, 0.0, 0.45);

  vec3 color = palette(h, rock);
  float lighting = 0.48 + diffuse * 0.72;
  color *= lighting * (1.0 - cast_shadow) * (1.0 - occlusion);
  color += vec3(0.12, 0.10, 0.065) * pow(max(0.0, dot(normal, normalize(vec3(0.55, -0.45, 0.68)))), 9.0);

  float contour_value = h * 38.0;
  float contour_distance = abs(fract(contour_value) - 0.5);
  float contour_width = max(fwidth(contour_value) * 0.72, 0.035);
  float minor_contour = 1.0 - smoothstep(contour_width, contour_width * 1.85, contour_distance);
  float major_value = h * 7.6;
  float major_distance = abs(fract(major_value) - 0.5);
  float major_width = max(fwidth(major_value) * 0.62, 0.026);
  float major_contour = 1.0 - smoothstep(major_width, major_width * 1.75, major_distance);
  color = mix(color, vec3(0.20, 0.17, 0.12), minor_contour * 0.34 * u_contours);
  color = mix(color, vec3(0.15, 0.12, 0.09), major_contour * 0.52 * u_contours);

  vec2 grid_uv = v_uv * vec2(12.0, 8.0);
  vec2 grid_distance = abs(fract(grid_uv) - 0.5);
  float grid = 1.0 - smoothstep(0.008, 0.018, min(grid_distance.x, grid_distance.y));
  color = mix(color, vec3(0.28, 0.20, 0.14), grid * 0.095);
  float grain = hash21(gl_FragCoord.xy + u_seed) - 0.5;
  color += grain * 0.035;
  float edge = smoothstep(0.0, 0.055, min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y)));
  color *= 0.86 + edge * 0.14;
  out_color = vec4(pow(max(color, 0.0), vec3(0.94)), 1.0);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed');
  return program;
}

class TerrainRenderer {
  constructor(canvas, mobile) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!this.gl) throw new Error('WebGL 2 is unavailable on this device');
    const gl = this.gl;
    this.heightProgram = createProgram(gl, HEIGHT_SHADER);
    this.reliefProgram = createProgram(gl, RELIEF_SHADER);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.floatTarget = Boolean(gl.getExtension('EXT_color_buffer_float'));
    this.heightTexture = null;
    this.framebuffer = null;
    this.heightWidth = 1;
    this.heightHeight = 1;
  }
  destroy() {
    const gl = this.gl;
    if (this.heightTexture) gl.deleteTexture(this.heightTexture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.heightProgram) gl.deleteProgram(this.heightProgram);
    if (this.reliefProgram) gl.deleteProgram(this.reliefProgram);
  }
  resize(width, height, ratio) {
    const pixelWidth = Math.max(1, Math.floor(width * ratio));
    const pixelHeight = Math.max(1, Math.floor(height * ratio));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
  }
  bindQuad(program) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const location = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }
  ensureHeightTarget(width, height) {
    const gl = this.gl;
    if (this.heightTexture && this.heightWidth === width && this.heightHeight === height) return;
    if (this.heightTexture) gl.deleteTexture(this.heightTexture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    this.heightWidth = width;
    this.heightHeight = height;
    this.heightTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.floatTarget) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.heightTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Terrain framebuffer is unavailable');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  uploadGeometry(program, geometry) {
    const gl = this.gl;
    const first = new Float32Array(MAX_GEOMETRY * 4);
    const second = new Float32Array(MAX_GEOMETRY * 4);
    const kinds = { peak: 0, ridge: 1, valley: 2 };
    geometry.slice(0, MAX_GEOMETRY).forEach((item, index) => {
      first.set([item.ax, 1 - item.ay, item.bx, 1 - item.by], index * 4);
      second.set([kinds[item.kind] ?? 0, item.strength, item.width, 0], index * 4);
    });
    gl.uniform1i(gl.getUniformLocation(program, 'u_count'), Math.min(MAX_GEOMETRY, geometry.length));
    gl.uniform4fv(gl.getUniformLocation(program, 'u_geometry_a[0]'), first);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_geometry_b[0]'), second);
  }
  render(geometry, seed, quality, contours) {
    const gl = this.gl;
    const aspect = Math.max(0.5, this.canvas.width / Math.max(1, this.canvas.height));
    const targetWidth = quality === 'draft' ? (this.mobile ? 256 : 384) : (this.mobile ? 768 : 1280);
    const targetHeight = Math.max(192, Math.round(targetWidth / aspect));
    this.ensureHeightTarget(targetWidth, targetHeight);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, targetWidth, targetHeight);
    this.bindQuad(this.heightProgram);
    gl.uniform1f(gl.getUniformLocation(this.heightProgram, 'u_seed'), seed);
    this.uploadGeometry(this.heightProgram, geometry);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.bindQuad(this.reliefProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.uniform1i(gl.getUniformLocation(this.reliefProgram, 'u_height'), 0);
    gl.uniform2f(gl.getUniformLocation(this.reliefProgram, 'u_texel'), 1 / targetWidth, 1 / targetHeight);
    gl.uniform2f(gl.getUniformLocation(this.reliefProgram, 'u_viewport'), this.canvas.width, this.canvas.height);
    gl.uniform1f(gl.getUniformLocation(this.reliefProgram, 'u_seed'), seed);
    gl.uniform1f(gl.getUniformLocation(this.reliefProgram, 'u_contours'), contours ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

class TerrainLabView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tool = 'ridge';
    this.geometry = JSON.parse(JSON.stringify(plugin.settings.terrainGeometry || DEFAULT_TERRAIN_GEOMETRY));
    this.seed = Number(plugin.settings.terrainSeed) || 37;
    this.contours = plugin.settings.terrainContours !== false;
    this.pending = null;
    this.refineTimer = null;
  }
  getViewType() { return TERRAIN_VIEW_TYPE; }
  getDisplayText() { return 'Gib Atlas terrain lab'; }
  getIcon() { return 'mountain'; }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('gib-terrain-view');
    const toolbar = this.contentEl.createDiv({ cls: 'gib-terrain-toolbar' });
    const identity = toolbar.createDiv({ cls: 'gib-terrain-identity' });
    const icon = identity.createSpan();
    setIcon(icon, 'mountain');
    identity.createEl('strong', { text: 'Terrain lab' });
    this.statusEl = toolbar.createDiv({ cls: 'gib-terrain-status', text: 'Live procedural relief' });
    this.toolButtons = new Map();
    for (const [tool, label, iconName] of [['peak', 'Peak', 'triangle'], ['ridge', 'Ridge', 'activity'], ['valley', 'Valley', 'waves']]) {
      const button = toolbar.createEl('button', { attr: { 'aria-label': `Draw ${label.toLowerCase()}` } });
      setIcon(button, iconName);
      button.createSpan({ text: label });
      button.onclick = () => this.setTool(tool);
      this.toolButtons.set(tool, button);
    }
    this.contourButton = toolbar.createEl('button', { attr: { 'aria-label': 'Toggle contour lines' } });
    setIcon(this.contourButton, 'scan-line');
    this.contourButton.onclick = async () => {
      this.contours = !this.contours;
      this.plugin.settings.terrainContours = this.contours;
      await this.plugin.saveSettings();
      this.updateToolbar();
      this.requestRender(false);
    };
    const undoButton = toolbar.createEl('button', { attr: { 'aria-label': 'Undo terrain geometry' } });
    setIcon(undoButton, 'undo-2');
    undoButton.onclick = () => { if (this.geometry.length) { this.geometry.pop(); this.commitGeometry(); } };
    const seedButton = toolbar.createEl('button', { attr: { 'aria-label': 'Generate another terrain variation' } });
    setIcon(seedButton, 'shuffle');
    seedButton.onclick = async () => { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; this.plugin.settings.terrainSeed = this.seed; await this.plugin.saveSettings(); this.requestRender(false); };
    const resetButton = toolbar.createEl('button', { text: 'Reset demo' });
    resetButton.onclick = () => { this.geometry = JSON.parse(JSON.stringify(DEFAULT_TERRAIN_GEOMETRY)); this.commitGeometry(); };

    this.stage = this.contentEl.createDiv({ cls: 'gib-terrain-stage' });
    this.canvas = this.stage.createEl('canvas', { cls: 'gib-terrain-canvas' });
    this.overlay = this.stage.createEl('canvas', { cls: 'gib-terrain-overlay' });
    this.overlayCtx = this.overlay.getContext('2d');
    try {
      this.renderer = new TerrainRenderer(this.canvas, Platform.isMobile);
    } catch (error) {
      this.statusEl.setText(error.message);
      this.stage.createDiv({ cls: 'gib-terrain-error', text: `Terrain renderer unavailable: ${error.message}` });
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
    this.bindEvents();
    this.updateToolbar();
    this.resize();
  }
  async onClose() {
    this.resizeObserver?.disconnect();
    clearTimeout(this.refineTimer);
    this.renderer?.destroy();
  }
  setTool(tool) { this.tool = tool; this.updateToolbar(); this.drawOverlay(); }
  updateToolbar() {
    for (const [tool, button] of this.toolButtons || []) button.toggleClass('is-active', tool === this.tool);
    this.contourButton?.toggleClass('is-active', this.contours);
  }
  resize() {
    if (!this.renderer) return;
    const rect = this.stage.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, Platform.isMobile ? 1.5 : 2);
    this.renderer.resize(rect.width, rect.height, ratio);
    this.overlay.width = Math.max(1, Math.floor(rect.width * ratio));
    this.overlay.height = Math.max(1, Math.floor(rect.height * ratio));
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    this.overlayRatio = ratio;
    this.requestRender(false);
  }
  requestRender(interactive = true) {
    if (!this.renderer) return;
    clearTimeout(this.refineTimer);
    this.renderer.render(this.pending ? [...this.geometry, this.pending] : this.geometry, this.seed, interactive ? 'draft' : 'refined', this.contours);
    this.statusEl?.setText(interactive ? 'Sculpting live relief…' : 'High-detail terrain');
    this.drawOverlay();
    if (interactive) this.refineTimer = setTimeout(() => {
      if (!this.renderer || this.pending) return;
      this.renderer.render(this.geometry, this.seed, 'refined', this.contours);
      this.statusEl?.setText('High-detail terrain');
    }, Platform.isMobile ? 320 : 180);
  }
  pointFromEvent(event) {
    const rect = this.stage.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  bindEvents() {
    this.stage.addEventListener('pointerdown', (event) => {
      if (this.geometry.length >= MAX_GEOMETRY) { new Notice(`Terrain geometry is limited to ${MAX_GEOMETRY} controls.`); return; }
      this.stage.setPointerCapture(event.pointerId);
      const point = this.pointFromEvent(event);
      if (this.tool === 'peak') {
        this.geometry.push({ kind: 'peak', ax: point.x, ay: point.y, bx: point.x, by: point.y, strength: 0.88, width: 0.10 });
        this.commitGeometry();
        return;
      }
      this.pending = { kind: this.tool, ax: point.x, ay: point.y, bx: point.x, by: point.y, strength: this.tool === 'ridge' ? 0.82 : 0.62, width: this.tool === 'ridge' ? 0.07 : 0.05 };
      this.requestRender(true);
    });
    this.stage.addEventListener('pointermove', (event) => {
      if (!this.pending) return;
      const point = this.pointFromEvent(event);
      this.pending.bx = point.x;
      this.pending.by = point.y;
      this.requestRender(true);
    });
    const finish = () => {
      if (!this.pending) return;
      if (Math.hypot(this.pending.bx - this.pending.ax, this.pending.by - this.pending.ay) > 0.015) this.geometry.push(this.pending);
      this.pending = null;
      this.commitGeometry();
    };
    this.stage.addEventListener('pointerup', finish);
    this.stage.addEventListener('pointercancel', finish);
  }
  async commitGeometry() {
    this.plugin.settings.terrainGeometry = this.geometry;
    this.plugin.settings.terrainSeed = this.seed;
    await this.plugin.saveSettings();
    this.requestRender(false);
  }
  drawOverlay() {
    if (!this.overlayCtx) return;
    const ctx = this.overlayCtx;
    const ratio = this.overlayRatio || 1;
    const width = this.overlay.clientWidth;
    const height = this.overlay.clientHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(this.contentEl);
    const accent = style.getPropertyValue('--interactive-accent').trim() || '#7c6ee6';
    const normal = style.getPropertyValue('--text-normal').trim() || '#ddd';
    const geometry = this.pending ? [...this.geometry, this.pending] : this.geometry;
    ctx.lineCap = 'round';
    geometry.forEach((item, index) => {
      const active = index === geometry.length - 1 && Boolean(this.pending);
      ctx.strokeStyle = active ? accent : normal;
      ctx.fillStyle = active ? accent : normal;
      ctx.globalAlpha = active ? 0.9 : 0.24;
      if (item.kind === 'peak') {
        ctx.beginPath();
        ctx.arc(item.ax * width, item.ay * height, active ? 6 : 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = active ? 2 : 1;
        if (item.kind === 'valley') ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(item.ax * width, item.ay * height);
        ctx.lineTo(item.bx * width, item.by * height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    ctx.globalAlpha = 1;
  }
}

export { TERRAIN_VIEW_TYPE, TerrainLabView, DEFAULT_TERRAIN_GEOMETRY };
