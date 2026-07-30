const { ItemView, Notice, Platform, setIcon } = require('obsidian');

const TERRAIN_VIEW_TYPE = 'gib-atlas-terrain-lab';
const BRUSH_WIDTH = 384;
const BRUSH_HEIGHT = 240;
const MAX_UNDO = 12;

const DEFAULT_TERRAIN_PATHS = [
  { width: 0.050, strength: 0.92, points: [[0.04, 0.76], [0.10, 0.69], [0.16, 0.59], [0.22, 0.49], [0.28, 0.38], [0.35, 0.29], [0.42, 0.25]] },
  { width: 0.045, strength: 0.86, points: [[0.27, 0.88], [0.34, 0.79], [0.40, 0.69], [0.47, 0.58], [0.54, 0.47], [0.60, 0.38]] },
  { width: 0.047, strength: 0.90, points: [[0.51, 0.76], [0.58, 0.69], [0.65, 0.59], [0.72, 0.47], [0.79, 0.34], [0.86, 0.23], [0.93, 0.14]] },
  { width: 0.035, strength: 0.72, points: [[0.62, 0.41], [0.68, 0.32], [0.74, 0.24], [0.80, 0.18]] },
  { width: 0.034, strength: 0.68, points: [[0.10, 0.31], [0.16, 0.24], [0.23, 0.17], [0.30, 0.12]] }
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
uniform sampler2D u_ridges;
uniform sampler2D u_brush;
uniform vec2 u_source_texel;
uniform float u_seed;

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
  mat2 turn = mat2(0.82, -0.57, 0.57, 0.82);
  for (int octave = 0; octave < 4; octave++) {
    total += amplitude * noise2(p);
    p = turn * p * 2.04 + 13.7;
    amplitude *= 0.49;
  }
  return total;
}
float ridged(vec2 p) {
  float total = 0.0, amplitude = 0.56;
  mat2 turn = mat2(0.87, -0.49, 0.49, 0.87);
  for (int octave = 0; octave < 5; octave++) {
    float ridge = 1.0 - abs(noise2(p) * 2.0 - 1.0);
    total += amplitude * ridge * ridge;
    p = turn * p * 2.11 + 8.3;
    amplitude *= 0.47;
  }
  return total;
}
void main() {
  vec2 p = v_uv;
  float ridge = texture(u_ridges, p).r;
  float brush = texture(u_brush, p).r * 2.0 - 1.0;
  float ridge_left = texture(u_ridges, p - vec2(u_source_texel.x, 0.0)).r;
  float ridge_right = texture(u_ridges, p + vec2(u_source_texel.x, 0.0)).r;
  float ridge_down = texture(u_ridges, p - vec2(0.0, u_source_texel.y)).r;
  float ridge_up = texture(u_ridges, p + vec2(0.0, u_source_texel.y)).r;
  vec2 ridge_gradient = vec2(ridge_right - ridge_left, ridge_up - ridge_down);
  vec2 ridge_normal = length(ridge_gradient) > 0.0002 ? normalize(ridge_gradient) : vec2(1.0, 0.0);
  vec2 ridge_tangent = vec2(-ridge_normal.y, ridge_normal.x);

  vec2 seed_offset = vec2(u_seed * 0.013, u_seed * -0.009);
  vec2 broad_warp = vec2(fbm(p * 1.8 + seed_offset), fbm(p * 1.8 + seed_offset + 27.4)) - 0.5;
  vec2 shaped = p + broad_warp * 0.040;
  float broad = fbm(shaped * 2.35 + seed_offset * 0.6) - 0.5;
  float mountain_mask = smoothstep(0.035, 0.50, ridge);

  vec2 oriented = vec2(dot(p, ridge_tangent), dot(p, ridge_normal));
  float folded_rock = ridged(oriented * vec2(15.0, 38.0) + seed_offset * 1.7);
  float gullies = pow(1.0 - noise2(oriented * vec2(8.0, 62.0) + seed_offset * 2.4), 4.0);
  float broken_crest = ridged(oriented * vec2(31.0, 12.0) + seed_offset * 3.2);

  float height_value = 0.335 + broad * 0.085 + brush * 0.39;
  height_value += pow(ridge, 0.82) * 0.49;
  height_value += mountain_mask * (folded_rock * 0.072 + broken_crest * 0.030 - gullies * 0.038);
  height_value += (fbm(shaped * 13.0 + seed_offset * 2.1) - 0.5) * (0.008 + mountain_mask * 0.019);
  out_color = vec4(vec3(clamp(height_value, 0.012, 0.988)), 1.0);
}`;

const RELIEF_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 out_color;
uniform sampler2D u_height;
uniform vec2 u_texel;
uniform float u_seed;
uniform float u_contours;

float height_at(vec2 uv) { return texture(u_height, clamp(uv, u_texel, 1.0 - u_texel)).r; }
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + u_seed * 0.017);
  return fract(p.x * p.y);
}
vec3 terrain_palette(float h, float rock, float shadow) {
  vec3 forest = vec3(0.255, 0.315, 0.115);
  vec3 grass = vec3(0.465, 0.500, 0.190);
  vec3 ochre = vec3(0.655, 0.555, 0.315);
  vec3 stone = vec3(0.575, 0.535, 0.480);
  vec3 limestone = vec3(0.835, 0.795, 0.690);
  vec3 color = mix(forest, grass, smoothstep(0.17, 0.38, h));
  color = mix(color, ochre, smoothstep(0.38, 0.59, h));
  color = mix(color, stone, smoothstep(0.56, 0.77, h));
  color = mix(color, limestone, smoothstep(0.76, 0.94, h));
  color = mix(color, vec3(0.39, 0.365, 0.335), rock * 0.76);
  return mix(color, color * vec3(0.76, 0.80, 0.88), shadow * 0.16);
}
void main() {
  float h = height_at(v_uv);
  vec2 one = u_texel;
  vec2 three = u_texel * 3.0;
  vec2 fine_gradient = vec2(height_at(v_uv + vec2(one.x, 0.0)) - height_at(v_uv - vec2(one.x, 0.0)),
                            height_at(v_uv + vec2(0.0, one.y)) - height_at(v_uv - vec2(0.0, one.y)));
  vec2 broad_gradient = vec2(height_at(v_uv + vec2(three.x, 0.0)) - height_at(v_uv - vec2(three.x, 0.0)),
                             height_at(v_uv + vec2(0.0, three.y)) - height_at(v_uv - vec2(0.0, three.y))) / 3.0;
  vec2 gradient = fine_gradient * 0.78 + broad_gradient * 0.22;
  vec3 normal = normalize(vec3(-gradient.x * 58.0, -gradient.y * 58.0, 1.0));
  vec3 light = normalize(vec3(-0.64, 0.69, 0.40));
  float diffuse = max(0.0, dot(normal, light));
  float slope = 1.0 - normal.z;
  float neighbor_mean = (height_at(v_uv + vec2(one.x, 0.0)) + height_at(v_uv - vec2(one.x, 0.0)) + height_at(v_uv + vec2(0.0, one.y)) + height_at(v_uv - vec2(0.0, one.y))) * 0.25;
  float curvature = h - neighbor_mean;
  float rock = smoothstep(0.055, 0.44, slope + abs(curvature) * 26.0) * smoothstep(0.26, 0.68, h);

  float cast_shadow = 0.0;
  vec2 ray = normalize(light.xy) * u_texel * 2.15;
  for (int step_index = 1; step_index <= 13; step_index++) {
    float step_value = float(step_index);
    float sample_h = height_at(v_uv + ray * step_value);
    float clearance = h + light.z * 0.0035 * step_value;
    cast_shadow += smoothstep(clearance + 0.003, clearance + 0.016, sample_h) * (1.0 - step_value / 15.0);
  }
  cast_shadow = clamp(cast_shadow * 0.155, 0.0, 0.78);

  float occlusion = 0.0;
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(4.0, 2.0)) - h);
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(-4.0, 2.0)) - h);
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(2.0, -4.0)) - h);
  occlusion += max(0.0, height_at(v_uv + u_texel * vec2(-2.0, -4.0)) - h);
  occlusion = clamp(occlusion * 5.8, 0.0, 0.48);

  vec3 color = terrain_palette(h, rock, cast_shadow);
  color *= (0.40 + diffuse * 0.82) * (1.0 - cast_shadow) * (1.0 - occlusion);
  float rim = pow(max(0.0, dot(normal, normalize(vec3(0.52, -0.48, 0.70)))), 11.0);
  color += vec3(0.15, 0.125, 0.082) * rim;

  float minor_value = h * 49.0;
  float minor_distance = abs(fract(minor_value) - 0.5);
  float minor_width = max(fwidth(minor_value) * 0.50, 0.020);
  float minor = 1.0 - smoothstep(minor_width, minor_width * 1.55, minor_distance);
  float major_value = h * 9.8;
  float major_distance = abs(fract(major_value) - 0.5);
  float major_width = max(fwidth(major_value) * 0.48, 0.018);
  float major = 1.0 - smoothstep(major_width, major_width * 1.48, major_distance);
  color = mix(color, vec3(0.19, 0.145, 0.095), minor * 0.38 * u_contours);
  color = mix(color, vec3(0.115, 0.085, 0.060), major * 0.58 * u_contours);

  vec2 grid_uv = v_uv * vec2(12.0, 8.0);
  vec2 grid_distance = abs(fract(grid_uv) - 0.5);
  float grid = 1.0 - smoothstep(0.006, 0.014, min(grid_distance.x, grid_distance.y));
  color = mix(color, vec3(0.26, 0.18, 0.12), grid * 0.050);
  color += (hash21(gl_FragCoord.xy + u_seed) - 0.5) * 0.012;
  float edge = smoothstep(0.0, 0.040, min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y)));
  color *= 0.88 + edge * 0.12;
  out_color = vec4(pow(max(color, 0.0), vec3(0.93)), 1.0);
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

function clonePaths(paths) { return JSON.parse(JSON.stringify(paths)); }

function stampField(field, nx, ny, radius, strength) {
  const minX = Math.max(0, Math.floor((nx - radius / (BRUSH_WIDTH / BRUSH_HEIGHT)) * BRUSH_WIDTH));
  const maxX = Math.min(BRUSH_WIDTH - 1, Math.ceil((nx + radius / (BRUSH_WIDTH / BRUSH_HEIGHT)) * BRUSH_WIDTH));
  const minY = Math.max(0, Math.floor((ny - radius) * BRUSH_HEIGHT));
  const maxY = Math.min(BRUSH_HEIGHT - 1, Math.ceil((ny + radius) * BRUSH_HEIGHT));
  const aspect = BRUSH_WIDTH / BRUSH_HEIGHT;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const dx = (x / (BRUSH_WIDTH - 1) - nx) * aspect;
    const dy = y / (BRUSH_HEIGHT - 1) - ny;
    const distance = Math.hypot(dx, dy);
    if (distance >= radius) continue;
    const t = 1 - distance / radius;
    const falloff = t * t * (3 - 2 * t);
    const index = y * BRUSH_WIDTH + x;
    field[index] = Math.max(-1, Math.min(1, field[index] + strength * falloff));
  }
}

function defaultBrushData() {
  const field = new Float32Array(BRUSH_WIDTH * BRUSH_HEIGHT);
  stampField(field, 0.18, 0.64, 0.31, 0.34);
  stampField(field, 0.42, 0.46, 0.28, 0.28);
  stampField(field, 0.73, 0.37, 0.32, 0.32);
  stampField(field, 0.58, 0.78, 0.25, 0.20);
  stampField(field, 0.48, 0.66, 0.13, -0.34);
  stampField(field, 0.30, 0.54, 0.10, -0.24);
  return field;
}

function encodeBrush(field) {
  const bytes = new Uint8Array(field.length);
  for (let index = 0; index < field.length; index++) bytes[index] = Math.round((Math.max(-1, Math.min(1, field[index])) * 0.5 + 0.5) * 255);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

function decodeBrush(encoded) {
  if (!encoded) return defaultBrushData();
  try {
    const binary = atob(encoded);
    if (binary.length !== BRUSH_WIDTH * BRUSH_HEIGHT) return defaultBrushData();
    const field = new Float32Array(binary.length);
    for (let index = 0; index < binary.length; index++) field[index] = (binary.charCodeAt(index) / 255 - 0.5) * 2;
    return field;
  } catch {
    return defaultBrushData();
  }
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
    this.floatLinear = Boolean(gl.getExtension('OES_texture_float_linear'));
    this.floatTarget = Boolean(gl.getExtension('EXT_color_buffer_float')) && this.floatLinear;
    this.ridgeCanvas = document.createElement('canvas');
    this.ridgeContext = this.ridgeCanvas.getContext('2d');
    this.ridgeTexture = gl.createTexture();
    this.brushTexture = gl.createTexture();
    this.heightTexture = null;
    this.framebuffer = null;
    this.heightWidth = 1;
    this.heightHeight = 1;
    this.brushRevision = -1;
  }
  destroy() {
    const gl = this.gl;
    for (const texture of [this.ridgeTexture, this.brushTexture, this.heightTexture]) if (texture) gl.deleteTexture(texture);
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
    const allocate = (floating) => {
      this.heightTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
      const filter = floating && !this.floatLinear ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (floating) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.heightTexture, 0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    };
    if (!allocate(this.floatTarget)) {
      gl.deleteTexture(this.heightTexture);
      gl.deleteFramebuffer(this.framebuffer);
      this.floatTarget = false;
      if (!allocate(false)) throw new Error('Terrain framebuffer is unavailable');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  drawSpline(context, points, width, height) {
    if (!points?.length) return;
    context.beginPath();
    context.moveTo(points[0][0] * width, points[0][1] * height);
    if (points.length === 1) {
      context.lineTo(points[0][0] * width + 0.01, points[0][1] * height);
    } else {
      for (let index = 1; index < points.length - 1; index++) {
        const current = points[index];
        const next = points[index + 1];
        context.quadraticCurveTo(current[0] * width, current[1] * height, (current[0] + next[0]) * 0.5 * width, (current[1] + next[1]) * 0.5 * height);
      }
      const last = points[points.length - 1];
      context.lineTo(last[0] * width, last[1] * height);
    }
    context.stroke();
  }
  updateRidgeTexture(paths, width, height) {
    const gl = this.gl;
    if (this.ridgeCanvas.width !== width || this.ridgeCanvas.height !== height) {
      this.ridgeCanvas.width = width;
      this.ridgeCanvas.height = height;
    }
    const context = this.ridgeContext;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalCompositeOperation = 'lighter';
    const scale = Math.min(width, height);
    for (const path of paths) {
      const base = Math.max(1.2, path.width * scale);
      const strength = Math.max(0.15, Math.min(1, path.strength));
      for (const layer of [[5.2, 0.16], [3.0, 0.25], [1.55, 0.40], [0.62, 0.78], [0.19, 1.0]]) {
        const value = Math.round(255 * strength * layer[1]);
        context.strokeStyle = `rgb(${value},${value},${value})`;
        context.lineWidth = Math.max(1, base * layer[0]);
        this.drawSpline(context, path.points, width, height);
      }
    }
    context.globalCompositeOperation = 'source-over';
    gl.bindTexture(gl.TEXTURE_2D, this.ridgeTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.ridgeCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  updateBrushTexture(field, revision) {
    if (revision === this.brushRevision) return;
    this.brushRevision = revision;
    const gl = this.gl;
    const bytes = new Uint8Array(BRUSH_WIDTH * BRUSH_HEIGHT);
    for (let y = 0; y < BRUSH_HEIGHT; y++) for (let x = 0; x < BRUSH_WIDTH; x++) {
      const source = y * BRUSH_WIDTH + x;
      const target = (BRUSH_HEIGHT - 1 - y) * BRUSH_WIDTH + x;
      bytes[target] = Math.round((Math.max(-1, Math.min(1, field[source])) * 0.5 + 0.5) * 255);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.brushTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, BRUSH_WIDTH, BRUSH_HEIGHT, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  }
  render(paths, field, brushRevision, seed, quality, contours) {
    const gl = this.gl;
    const aspect = Math.max(0.5, this.canvas.width / Math.max(1, this.canvas.height));
    const targetWidth = quality === 'draft' ? (this.mobile ? 512 : 768) : (this.mobile ? 1024 : 2048);
    const targetHeight = Math.max(256, Math.round(targetWidth / aspect));
    this.ensureHeightTarget(targetWidth, targetHeight);
    this.updateRidgeTexture(paths, targetWidth, targetHeight);
    this.updateBrushTexture(field, brushRevision);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, targetWidth, targetHeight);
    this.bindQuad(this.heightProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.ridgeTexture);
    gl.uniform1i(gl.getUniformLocation(this.heightProgram, 'u_ridges'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.brushTexture);
    gl.uniform1i(gl.getUniformLocation(this.heightProgram, 'u_brush'), 1);
    gl.uniform2f(gl.getUniformLocation(this.heightProgram, 'u_source_texel'), 1 / targetWidth, 1 / targetHeight);
    gl.uniform1f(gl.getUniformLocation(this.heightProgram, 'u_seed'), seed);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.bindQuad(this.reliefProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.uniform1i(gl.getUniformLocation(this.reliefProgram, 'u_height'), 0);
    gl.uniform2f(gl.getUniformLocation(this.reliefProgram, 'u_texel'), 1 / targetWidth, 1 / targetHeight);
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
    this.paths = clonePaths(plugin.settings.terrainPaths || DEFAULT_TERRAIN_PATHS);
    this.brush = decodeBrush(plugin.settings.terrainBrush);
    this.brushRevision = 1;
    this.seed = Number(plugin.settings.terrainSeed) || 37;
    this.contours = plugin.settings.terrainContours !== false;
    this.toolSize = Number(plugin.settings.terrainToolSize) || 44;
    this.toolStrength = Number(plugin.settings.terrainToolStrength) || 68;
    this.pendingPath = null;
    this.undoStack = [];
    this.pointer = null;
    this.refineTimer = null;
    this.renderFrame = null;
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
    this.statusEl = toolbar.createDiv({ cls: 'gib-terrain-status', text: 'High-detail terrain' });
    this.toolButtons = new Map();
    for (const [tool, label, iconName] of [['ridge', 'Ridge pen', 'pen-tool'], ['raise', 'Raise', 'circle-plus'], ['lower', 'Lower', 'circle-minus']]) {
      const button = toolbar.createEl('button', { attr: { 'aria-label': label } });
      setIcon(button, iconName);
      button.createSpan({ text: label });
      button.onclick = () => this.setTool(tool);
      this.toolButtons.set(tool, button);
    }
    this.sizeInput = this.addSlider(toolbar, 'Size', this.toolSize, (value) => { this.toolSize = value; this.saveToolSettings(); this.drawOverlay(); });
    this.strengthInput = this.addSlider(toolbar, 'Strength', this.toolStrength, (value) => { this.toolStrength = value; this.saveToolSettings(); });
    this.contourButton = toolbar.createEl('button', { attr: { 'aria-label': 'Toggle contour lines' } });
    setIcon(this.contourButton, 'scan-line');
    this.contourButton.onclick = async () => { this.contours = !this.contours; this.plugin.settings.terrainContours = this.contours; await this.plugin.saveSettings(); this.updateToolbar(); this.renderNow('refined'); };
    const undoButton = toolbar.createEl('button', { attr: { 'aria-label': 'Undo terrain stroke' } });
    setIcon(undoButton, 'undo-2');
    undoButton.onclick = () => this.undo();
    const seedButton = toolbar.createEl('button', { attr: { 'aria-label': 'Generate another terrain variation' } });
    setIcon(seedButton, 'shuffle');
    seedButton.onclick = async () => { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; this.plugin.settings.terrainSeed = this.seed; await this.plugin.saveSettings(); this.renderNow('refined'); };
    const resetButton = toolbar.createEl('button', { text: 'Reset demo' });
    resetButton.onclick = () => { this.captureUndo(); this.paths = clonePaths(DEFAULT_TERRAIN_PATHS); this.brush = defaultBrushData(); this.brushRevision++; this.commitTerrain(); };

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
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
    this.renderer?.destroy();
  }
  addSlider(toolbar, label, value, onChange) {
    const wrapper = toolbar.createDiv({ cls: 'gib-terrain-tool-control' });
    wrapper.createSpan({ text: label });
    const input = wrapper.createEl('input', { attr: { type: 'range', min: '1', max: '100', value: String(value), 'aria-label': label } });
    input.addClass('slider');
    input.oninput = () => onChange(Number(input.value));
    return input;
  }
  async saveToolSettings() {
    this.plugin.settings.terrainToolSize = this.toolSize;
    this.plugin.settings.terrainToolStrength = this.toolStrength;
    await this.plugin.saveSettings();
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
    this.renderNow('refined');
  }
  visiblePaths() { return this.pendingPath ? [...this.paths, this.pendingPath] : this.paths; }
  queueDraft() {
    clearTimeout(this.refineTimer);
    if (!this.renderFrame) this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderNow('draft');
    });
    this.refineTimer = setTimeout(() => { if (!this.pointer) this.renderNow('refined'); }, Platform.isMobile ? 320 : 190);
  }
  renderNow(quality) {
    if (!this.renderer) return;
    this.renderer.render(this.visiblePaths(), this.brush, this.brushRevision, this.seed, quality, this.contours);
    this.statusEl?.setText(quality === 'draft' ? 'Sculpting live relief…' : 'High-detail terrain');
    this.drawOverlay();
  }
  pointFromEvent(event) {
    const rect = this.stage.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  ridgeWidth() { return 0.012 + this.toolSize / 100 * 0.062; }
  ridgeStrength() { return 0.30 + this.toolStrength / 100 * 0.70; }
  brushRadius() { return 0.025 + this.toolSize / 100 * 0.175; }
  brushPower() { return 0.012 + this.toolStrength / 100 * 0.040; }
  captureUndo() {
    this.undoStack.push({ paths: clonePaths(this.paths), brush: this.brush.slice() });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }
  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.paths = previous.paths;
    this.brush = previous.brush;
    this.brushRevision++;
    this.commitTerrain();
  }
  paintBetween(from, to, sign) {
    const aspect = BRUSH_WIDTH / BRUSH_HEIGHT;
    const distance = Math.hypot((to.x - from.x) * aspect, to.y - from.y);
    const radius = this.brushRadius();
    const steps = Math.max(1, Math.ceil(distance / Math.max(0.005, radius * 0.22)));
    for (let index = 1; index <= steps; index++) {
      const t = index / steps;
      stampField(this.brush, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, this.brushPower() * sign);
    }
    this.brushRevision++;
  }
  bindEvents() {
    this.stage.addEventListener('pointerenter', (event) => { this.hoverPoint = this.pointFromEvent(event); this.drawOverlay(); });
    this.stage.addEventListener('pointerleave', () => { if (!this.pointer) { this.hoverPoint = null; this.drawOverlay(); } });
    this.stage.addEventListener('pointerdown', (event) => {
      this.captureUndo();
      this.stage.setPointerCapture(event.pointerId);
      const point = this.pointFromEvent(event);
      this.pointer = { previous: point };
      this.hoverPoint = point;
      if (this.tool === 'ridge') this.pendingPath = { width: this.ridgeWidth(), strength: this.ridgeStrength(), points: [[point.x, point.y]] };
      else stampField(this.brush, point.x, point.y, this.brushRadius(), this.brushPower() * (this.tool === 'raise' ? 1 : -1));
      if (this.tool !== 'ridge') this.brushRevision++;
      this.queueDraft();
    });
    this.stage.addEventListener('pointermove', (event) => {
      const point = this.pointFromEvent(event);
      this.hoverPoint = point;
      if (!this.pointer) { this.drawOverlay(); return; }
      if (this.tool === 'ridge') {
        const previous = this.pendingPath.points[this.pendingPath.points.length - 1];
        const rect = this.stage.getBoundingClientRect();
        if (Math.hypot((point.x - previous[0]) * rect.width, (point.y - previous[1]) * rect.height) >= 4) this.pendingPath.points.push([point.x, point.y]);
      } else this.paintBetween(this.pointer.previous, point, this.tool === 'raise' ? 1 : -1);
      this.pointer.previous = point;
      this.queueDraft();
    });
    const finish = () => {
      if (!this.pointer) return;
      if (this.pendingPath?.points.length >= 2) this.paths.push(this.pendingPath);
      else if (this.pendingPath) this.undoStack.pop();
      this.pendingPath = null;
      this.pointer = null;
      this.commitTerrain();
    };
    this.stage.addEventListener('pointerup', finish);
    this.stage.addEventListener('pointercancel', finish);
  }
  async commitTerrain() {
    clearTimeout(this.refineTimer);
    if (this.renderFrame) { cancelAnimationFrame(this.renderFrame); this.renderFrame = null; }
    this.plugin.settings.terrainPaths = this.paths;
    this.plugin.settings.terrainBrush = encodeBrush(this.brush);
    this.plugin.settings.terrainSeed = this.seed;
    await this.plugin.saveSettings();
    this.renderNow('refined');
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
    if (this.pendingPath) {
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.86;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.pendingPath.points.forEach((point, index) => { if (index) ctx.lineTo(point[0] * width, point[1] * height); else ctx.moveTo(point[0] * width, point[1] * height); });
      ctx.stroke();
    }
    if (this.hoverPoint && this.tool !== 'ridge') {
      const radius = this.brushRadius() * height;
      ctx.beginPath();
      ctx.arc(this.hoverPoint.x * width, this.hoverPoint.y * height, radius, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.hoverPoint.x * width, this.hoverPoint.y * height, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

export { TERRAIN_VIEW_TYPE, TerrainLabView, DEFAULT_TERRAIN_PATHS };
