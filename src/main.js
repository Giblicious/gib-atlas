const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, setIcon } = require('obsidian');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline, env } = require('@huggingface/transformers');
const { UMAP } = require('umap-js');
const Graph = require('graphology');
const louvain = require('graphology-communities-louvain');

const EMBEDDED_WASM_GZIP = null;
const EMBEDDED_WASM_MODULE_GZIP = null;
const VIEW_TYPE = 'gib-atlas-view';
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DEFAULT_SETTINGS = {
  settingsVersion: 2,
  folder: 'Atlas Demo',
  neighbors: 8,
  compactness: 0.12,
  collisionSpacing: 10,
  commonSignalRemoval: 0.3,
  neighborhoodDetail: 1.35,
  showConnections: true,
  showRoads: true,
  showRegions: true,
  showRegionLabels: true,
  defaultPresentation: 'town'
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

function cleanText(source) {
  return source
    .replace(/^---\s*[\s\S]*?\n---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2 $1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, '')
    .replace(/[*_~`|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function documentChunks(file, source) {
  const body = cleanText(source);
  const title = /^\d{4}-\d{2}-\d{2}$/.test(file.basename) ? '' : `${file.basename}. `;
  const pieces = body.split(/\n\n+/).flatMap((paragraph) => {
    if (paragraph.length <= 1500) return [paragraph];
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
    const groups = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > 1400) { groups.push(current.trim()); current = ''; }
      current += `${sentence.trim()} `;
    }
    if (current.trim()) groups.push(current.trim());
    return groups;
  }).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > 1500) { chunks.push(current.trim()); current = ''; }
    current += `${piece} `;
  }
  if (current.trim()) chunks.push(current.trim());
  if (!chunks.length) chunks.push(file.basename);
  if (chunks.length > 6) {
    const sampled = [];
    for (let i = 0; i < 6; i++) sampled.push(chunks[Math.round(i * (chunks.length - 1) / 5)]);
    return sampled.map((chunk) => `${title}${chunk}`.slice(0, 1800));
  }
  return chunks.map((chunk) => `${title}${chunk}`.slice(0, 1800));
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}

function normalize(vector) {
  const length = Math.sqrt(dot(vector, vector)) || 1;
  return vector.map((value) => value / length);
}

function meanVector(vectors) {
  const output = Array(vectors[0].length).fill(0);
  for (const vector of vectors) for (let i = 0; i < output.length; i++) output[i] += vector[i];
  return normalize(output.map((value) => value / vectors.length));
}

function removeCommonSignal(vector, common, strength) {
  const projection = dot(vector, common) * strength;
  return normalize(vector.map((value, i) => value - common[i] * projection));
}

function topicMatch(a, b) {
  const directed = (source, target) => {
    const matches = source.map((vector) => Math.max(...target.map((other) => dot(vector, other)))).sort((x, y) => y - x);
    return matches.slice(0, Math.min(2, matches.length)).reduce((sum, value) => sum + value, 0) / Math.min(2, matches.length);
  };
  return (directed(a, b) + directed(b, a)) / 2;
}

function semanticMatrix(records, commonStrength, neighbors) {
  const common = meanVector(records.map((record) => record.vector));
  const docs = records.map((record) => removeCommonSignal(record.vector, common, commonStrength));
  const chunks = records.map((record) => record.chunkVectors.map((vector) => removeCommonSignal(vector, common, commonStrength * 0.7)));
  const matrix = records.map(() => Array(records.length).fill(1));
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      matrix[i][j] = dot(docs[i], docs[j]);
      matrix[j][i] = matrix[i][j];
    }
  }
  const candidateCount = Math.min(records.length - 1, Math.max(24, neighbors * 3));
  const candidates = new Set();
  for (let i = 0; i < records.length; i++) {
    const nearest = matrix[i].map((score, j) => ({ j, score: i === j ? -Infinity : score })).sort((a, b) => b.score - a.score).slice(0, candidateCount);
    for (const item of nearest) candidates.add(i < item.j ? `${i}:${item.j}` : `${item.j}:${i}`);
  }
  for (const pair of candidates) {
    const [i, j] = pair.split(':').map(Number);
    const similarity = Math.max(-1, Math.min(1, matrix[i][j] * 0.42 + topicMatch(chunks[i], chunks[j]) * 0.58));
    matrix[i][j] = similarity;
    matrix[j][i] = similarity;
  }
  return matrix;
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

function adaptiveGraph(similarities, k) {
  const nearest = similarities.map((row, i) => row
    .map((score, j) => ({ j, score: i === j ? -Infinity : score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(k, similarities.length - 1)));
  const sets = nearest.map((items) => new Set(items.map((item) => item.j)));
  const edges = [];
  for (let i = 0; i < nearest.length; i++) {
    for (const item of nearest[i]) {
      if (item.j > i && sets[item.j].has(i)) {
        const localFloor = Math.min(nearest[i].at(-1)?.score ?? item.score, nearest[item.j].at(-1)?.score ?? item.score);
        edges.push({ a: i, b: item.j, similarity: item.score, weight: Math.max(0.02, item.score - localFloor + 0.08) });
      }
    }
  }
  return { edges, nearest };
}

function stableCommunities(similarities, graphData, detail, seed) {
  const graph = new Graph({ type: 'undirected' });
  for (let i = 0; i < similarities.length; i++) graph.addNode(String(i));
  for (const edge of graphData.edges) graph.addUndirectedEdge(String(edge.a), String(edge.b), { weight: edge.weight });
  const broadRaw = louvain(graph, { resolution: 0.62, rng: mulberry32(seed), getEdgeWeight: 'weight' });
  const normalizeIds = (values) => {
    const groups = new Map();
    values.forEach((value, index) => { if (!groups.has(value)) groups.set(value, []); groups.get(value).push(index); });
    return [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  };
  const broadGroups = normalizeIds(Object.keys(broadRaw).sort((a, b) => Number(a) - Number(b)).map((key) => broadRaw[key])).filter((members) => members.length >= 3);
  const region = Array(similarities.length).fill(-1);
  const neighborhood = Array(similarities.length).fill(-1);
  let neighborhoodId = 0;
  broadGroups.forEach((members, regionId) => {
    members.forEach((index) => { region[index] = regionId; });
    if (members.length < 6) {
      members.forEach((index) => { neighborhood[index] = neighborhoodId; });
      neighborhoodId++;
      return;
    }
    const subgraph = graph.copy();
    for (const node of subgraph.nodes()) if (!members.includes(Number(node))) subgraph.dropNode(node);
    const subRaw = louvain(subgraph, { resolution: detail, rng: mulberry32(seed ^ (regionId + 1) * 2654435761), getEdgeWeight: 'weight' });
    const subGroups = normalizeIds(members.map((index) => subRaw[String(index)]));
    for (const localMembers of subGroups) {
      for (const localIndex of localMembers) neighborhood[members[localIndex]] = neighborhoodId;
      neighborhoodId++;
    }
  });
  const degree = Array(similarities.length).fill(0);
  graphData.edges.forEach((edge) => { degree[edge.a]++; degree[edge.b]++; });
  return { region, neighborhood, regionCount: broadGroups.length, neighborhoodCount: neighborhoodId, fringe: degree.map((value, index) => value < 2 || region[index] < 0) };
}

function hierarchicalDistances(similarities, communities) {
  return similarities.map((row, i) => row.map((similarity, j) => {
    if (i === j) return 0;
    let distance = Math.max(0.015, 1 - similarity);
    if (communities.neighborhood[i] >= 0 && communities.neighborhood[i] === communities.neighborhood[j]) distance *= 0.72;
    else if (communities.region[i] >= 0 && communities.region[i] === communities.region[j]) distance *= 0.9;
    else distance *= 1.18;
    if (communities.fringe[i] || communities.fringe[j]) distance *= 1.08;
    return distance;
  }));
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

function convexHull(points) {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  const upper = [];
  for (const point of sorted.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function paddedHull(points, padding) {
  const hull = convexHull(points);
  const center = hull.reduce((sum, point) => ({ x: sum.x + point.x / hull.length, y: sum.y + point.y / hull.length }), { x: 0, y: 0 });
  return hull.map((point) => {
    const dx = point.x - center.x, dy = point.y - center.y, length = Math.hypot(dx, dy) || 1;
    return { x: point.x + dx / length * padding, y: point.y + dy / length * padding };
  });
}

function regionColor(region, neighborhood = 0, alpha = 1) {
  const hue = (region * 137.508 + neighborhood * 11) % 360;
  return `hsla(${hue.toFixed(1)}, 58%, 62%, ${alpha})`;
}

const LABEL_STOP_WORDS = new Set(`a all an and are as at be been being but by can could did do does for from had has have he her hers him his how i if in into is it its may me might more most my no not of on one or our ours she should so than that the their theirs them then there these they this those through to too up us very was we were what when where which who why will with would you your yours`.split(' '));
const LABEL_NOISE_WORDS = new Set(`assistant chatgpt claude conversation entry entries journal note notes response said says saying asked question questions today yesterday tomorrow year years thing things something anything really just maybe perhaps also well much many get got make made look looks like think thinks thinking thought thoughts feel felt feeling feelings know knew want wanted temp pdf bummer file files`.split(' '));

function phraseTokens(text) {
  return (text.toLocaleLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) || [])
    .map((token) => token.replace(/[’']/g, "'").replace(/^[-']+|[-']+$/g, ''))
    .filter((token) => token.length > 1);
}

function documentPhrases(chunks) {
  const phrases = new Set();
  for (const chunk of chunks) {
    for (const sentence of chunk.split(/[.!?;:\n]+/)) {
      const tokens = phraseTokens(sentence);
      for (let start = 0; start < tokens.length; start++) {
        for (let length = 1; length <= 4 && start + length <= tokens.length; length++) {
          const selection = tokens.slice(start, start + length);
          if (LABEL_STOP_WORDS.has(selection[0]) || LABEL_STOP_WORDS.has(selection.at(-1))) continue;
          if (selection.every((token) => LABEL_STOP_WORDS.has(token) || LABEL_NOISE_WORDS.has(token))) continue;
          if (selection.some((token) => LABEL_NOISE_WORDS.has(token)) || new Set(selection).size !== selection.length) continue;
          const phrase = selection.join(' ');
          if (phrase.length <= 46) phrases.add(phrase);
        }
      }
    }
  }
  return phrases;
}

function labelCandidates(records, members, limit = 32) {
  const memberSet = new Set(members);
  const inside = new Map(), outside = new Map();
  records.forEach((record, index) => {
    for (const phrase of documentPhrases(record.chunks || [])) {
      const target = memberSet.has(index) ? inside : outside;
      target.set(phrase, (target.get(phrase) || 0) + 1);
    }
  });
  const outsideSize = Math.max(1, records.length - members.length);
  const minimumSupport = members.length >= 6 ? 2 : 1;
  const direct = [...inside.entries()].filter(([, count]) => count >= minimumSupport).map(([phrase, count]) => {
    const coverage = count / members.length;
    const outsideRate = (outside.get(phrase) || 0) / outsideSize;
    const wordCount = phrase.split(' ').length;
    const lengthWeight = wordCount === 1 ? 0.78 : wordCount === 2 ? 1.2 : wordCount === 3 ? 1.1 : 0.95;
    const lexical = (coverage - outsideRate) * Math.log2(count + 1) * lengthWeight;
    return { phrase, display: phrase, lexical, coverage, kind: 'phrase' };
  }).filter((candidate) => candidate.lexical > 0).sort((a, b) => b.lexical - a.lexical || a.phrase.localeCompare(b.phrase));
  return direct.slice(0, limit);
}

function formatLabel(phrase) {
  return phrase.split(' ').map((word, index) => index > 0 && LABEL_STOP_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(' ');
}

async function buildRegionLabels(records, communities, extractor) {
  const regions = Array.from({ length: communities.regionCount }, (_, region) => records.map((_, index) => index).filter((index) => communities.region[index] === region));
  const centroids = regions.map((members) => meanVector(members.map((index) => records[index].vector)));
  const candidatesByRegion = regions.map((members) => labelCandidates(records, members));
  const flat = candidatesByRegion.flatMap((candidates, region) => candidates.map((candidate) => ({ ...candidate, region })));
  if (!flat.length) return regions.map((_, region) => ({ region, label: `Region ${region + 1}`, confidence: 0, inferred: false }));
  const output = await extractor(flat.map((candidate) => candidate.phrase), { pooling: 'mean', normalize: true, truncation: true, max_length: 64 });
  const values = output.tolist();
  const vectors = (Array.isArray(values[0]?.[0]) ? values[0] : values).map((item) => Array.from(item));
  const best = Array(communities.regionCount).fill(null);
  flat.forEach((candidate, index) => {
    const regionSimilarity = dot(vectors[index], centroids[candidate.region]);
    const competingSimilarity = Math.max(-1, ...centroids.filter((_, region) => region !== candidate.region).map((centroid) => dot(vectors[index], centroid)));
    const margin = regionSimilarity - competingSimilarity;
    const lexical = Math.min(1, candidate.lexical);
    const words = candidate.phrase.split(' ');
    const quality = words.length === 2 ? 0.025 : words.length === 3 ? 0.012 : words.length >= 4 ? -0.025 : -0.01;
    const score = margin * 0.62 + regionSimilarity * 0.13 + lexical * 0.25 + quality;
    const confidence = Math.max(0, Math.min(1, ((margin - 0.004) / 0.075) * 0.62 + Math.min(1, candidate.coverage / 0.35) * 0.25 + lexical * 0.13 + quality));
    if (!best[candidate.region] || score > best[candidate.region].score) best[candidate.region] = { ...candidate, score, confidence };
  });
  return best.map((phrase, region) => {
    const candidate = phrase?.confidence >= 0.58 ? phrase : null;
    return candidate
      ? { region, label: formatLabel(candidate.display || candidate.phrase), confidence: candidate.confidence, inferred: true }
      : { region, label: `Region ${region + 1}`, confidence: phrase?.confidence || 0, inferred: false };
  });
}

function sourceStats(source) {
  const cleaned = cleanText(source);
  return {
    characters: cleaned.length,
    words: phraseTokens(cleaned).length,
    headings: (source.match(/^\s{0,3}#{1,6}\s+.+$/gm) || []).length,
    manualLinks: (source.match(/\[\[[^\]]+\]\]/g) || []).length
  };
}

function percentileRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = Array(values.length).fill(0);
  sorted.forEach((item, rank) => { ranks[item.index] = values.length <= 1 ? 0.5 : rank / (values.length - 1); });
  return ranks;
}

function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function buildPropertyProfiles(records, graphData, communities) {
  const sizeRank = percentileRanks(records.map((record) => Math.log1p(record.stats?.words || 0)));
  const headingRank = percentileRanks(records.map((record) => record.stats?.headings || 0));
  const linkRank = percentileRanks(records.map((record) => record.stats?.manualLinks || 0));
  const density = graphData.nearest.map((neighbors) => neighbors.length ? neighbors.reduce((sum, item) => sum + item.score, 0) / neighbors.length : 0);
  const densityRank = percentileRanks(density);
  const weightedDegree = Array(records.length).fill(0);
  const degree = Array(records.length).fill(0);
  const bridge = Array(records.length).fill(0);
  for (const edge of graphData.edges) {
    weightedDegree[edge.a] += edge.weight; weightedDegree[edge.b] += edge.weight;
    degree[edge.a]++; degree[edge.b]++;
    if (communities.neighborhood[edge.a] !== communities.neighborhood[edge.b]) { bridge[edge.a] += edge.weight; bridge[edge.b] += edge.weight; }
  }
  const centralityRank = percentileRanks(weightedDegree);
  const bridgeRank = percentileRanks(bridge);
  const breadth = records.map((record) => {
    const vectors = record.chunkVectors || [];
    if (vectors.length < 2) return 0;
    let difference = 0, pairs = 0;
    for (let i = 0; i < vectors.length; i++) for (let j = i + 1; j < vectors.length; j++) { difference += 1 - dot(vectors[i], vectors[j]); pairs++; }
    return difference / pairs;
  });
  const breadthRank = percentileRanks(breadth);
  return records.map((record, index) => {
    const isolation = 1 - densityRank[index];
    const fringe = Boolean(communities.fringe[index]);
    const rurality = clamp01(isolation * 0.68 + (fringe ? 0.32 : 0));
    const lotScale = clamp01(sizeRank[index] * 0.58 + rurality * 0.72);
    return {
      size: sizeRank[index],
      lotScale,
      lotRadius: 5 + lotScale * 10,
      buildingScale: 0.45 + sizeRank[index] * 0.75,
      rurality,
      centrality: centralityRank[index],
      topicBreadth: breadthRank[index],
      connections: degree[index],
      bridgeStrength: bridgeRank[index],
      sectionComplexity: headingRank[index],
      manualLinks: linkRank[index],
      character: fringe || rurality > 0.64 ? 'farmstead' : centralityRank[index] > 0.7 ? 'village-center' : 'cottage'
    };
  });
}

function relaxPropertyCollisions(basePoints, profiles) {
  const center = basePoints.reduce((sum, point) => ({ x: sum.x + point.x / basePoints.length, y: sum.y + point.y / basePoints.length }), { x: 0, y: 0 });
  const anchors = basePoints.map((point) => ({ x: center.x + (point.x - center.x) * 1.65, y: center.y + (point.y - center.y) * 1.65 }));
  const points = anchors.map((point) => ({ ...point }));
  for (let pass = 0; pass < 260; pass++) {
    const movement = points.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        let dx = points[j].x - points[i].x, dy = points[j].y - points[i].y;
        let distance = Math.hypot(dx, dy);
        const minimum = profiles[i].lotRadius + profiles[j].lotRadius + 3;
        if (distance >= minimum) continue;
        if (distance < 0.001) { dx = ((i * 19 + j * 23) % 13) - 6; dy = ((i * 31 + j * 11) % 13) - 6; distance = Math.hypot(dx, dy) || 1; }
        const force = (minimum - distance) * 0.28;
        movement[i].x -= dx / distance * force; movement[i].y -= dy / distance * force;
        movement[j].x += dx / distance * force; movement[j].y += dy / distance * force;
      }
    }
    for (let i = 0; i < points.length; i++) {
      const anchorStrength = 0.006 + profiles[i].centrality * 0.004;
      points[i].x += movement[i].x + (anchors[i].x - points[i].x) * anchorStrength;
      points[i].y += movement[i].y + (anchors[i].y - points[i].y) * anchorStrength;
    }
  }
  return points;
}

function buildRoadNetwork(edges, communities, profiles) {
  const selected = new Map();
  const key = (edge) => `${Math.min(edge.a, edge.b)}:${Math.max(edge.a, edge.b)}`;
  const add = (edge, kind) => {
    const id = key(edge), current = selected.get(id);
    const priority = { lane: 1, village: 2, regional: 3 };
    if (!current || priority[kind] > priority[current.kind]) selected.set(id, { ...edge, kind });
  };
  const neighborhoods = [...new Set(communities.neighborhood)].filter((value) => value >= 0);
  for (const neighborhood of neighborhoods) {
    const members = communities.neighborhood.map((value, index) => value === neighborhood ? index : -1).filter((index) => index >= 0);
    const memberSet = new Set(members);
    const candidates = edges.filter((edge) => memberSet.has(edge.a) && memberSet.has(edge.b)).sort((a, b) => b.weight - a.weight);
    const parent = new Map(members.map((member) => [member, member]));
    const find = (node) => { let root = node; while (parent.get(root) !== root) root = parent.get(root); while (parent.get(node) !== node) { const next = parent.get(node); parent.set(node, root); node = next; } return root; };
    for (const edge of candidates) {
      const a = find(edge.a), b = find(edge.b);
      if (a !== b) { parent.set(a, b); add(edge, 'lane'); }
    }
    const extraLimit = Math.max(0, Math.floor(members.length * 0.22));
    candidates.filter((edge) => !selected.has(key(edge))).slice(0, extraLimit).forEach((edge) => add(edge, 'lane'));
  }
  const villageBridges = new Map(), regionalBridges = new Map();
  for (const edge of edges) {
    const regionA = communities.region[edge.a], regionB = communities.region[edge.b];
    const neighborhoodA = communities.neighborhood[edge.a], neighborhoodB = communities.neighborhood[edge.b];
    if (regionA >= 0 && regionA === regionB && neighborhoodA !== neighborhoodB) {
      const id = [neighborhoodA, neighborhoodB].sort((a, b) => a - b).join(':');
      if (!villageBridges.has(id) || edge.weight > villageBridges.get(id).weight) villageBridges.set(id, edge);
    } else if (regionA >= 0 && regionB >= 0 && regionA !== regionB) {
      const id = [regionA, regionB].sort((a, b) => a - b).join(':');
      if (!regionalBridges.has(id) || edge.weight > regionalBridges.get(id).weight) regionalBridges.set(id, edge);
    }
  }
  villageBridges.forEach((edge) => add(edge, 'village'));
  regionalBridges.forEach((edge) => add(edge, 'regional'));
  return [...selected.values()].map((road) => ({ ...road, importance: clamp01((profiles[road.a].bridgeStrength + profiles[road.b].bridgeStrength) / 2) }));
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function lotPolygon(point, profile, pathKey) {
  const random = mulberry32(hashString(pathKey));
  const count = 9;
  const rotation = random() * Math.PI * 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + index / count * Math.PI * 2;
    const radius = profile.lotRadius * (0.82 + random() * 0.28);
    return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
  });
}

class AtlasView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.hovered = -1;
    this.drag = null;
    this.mode = plugin.settings.defaultPresentation || 'town';
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
    this.modeButton = toolbar.createEl('button', { attr: { 'aria-label': 'Toggle town and semantic point views' } });
    this.updateModeButton();
    this.modeButton.onclick = async () => {
      this.mode = this.mode === 'town' ? 'points' : 'town';
      this.plugin.settings.defaultPresentation = this.mode;
      await this.plugin.saveSettings();
      this.updateModeButton();
      this.fit();
    };
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
  updateModeButton() {
    if (!this.modeButton) return;
    this.modeButton.empty();
    setIcon(this.modeButton, this.mode === 'town' ? 'scatter-chart' : 'house');
    this.modeButton.setAttribute('aria-label', this.mode === 'town' ? 'Show semantic points' : 'Show hamlet view');
  }
  activePoints() {
    const layout = this.plugin.layout;
    return this.mode === 'town' && layout?.townPoints?.length === layout?.records?.length ? layout.townPoints : layout?.points || [];
  }
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
    const points = this.activePoints();
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
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
      const points = this.activePoints();
      for (let i = 0; i < points.length; i++) {
        const candidate = points[i];
        const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        const hitRadius = this.mode === 'town' ? this.plugin.layout?.profiles?.[i]?.lotRadius || nearestDistance : nearestDistance;
        if (distance < hitRadius && (nearest < 0 || distance < nearestDistance)) { nearest = i; nearestDistance = distance; }
      }
      this.hovered = nearest;
      if (nearest >= 0) {
        const layout = this.plugin.layout;
        const region = layout.communities?.region?.[nearest];
        const neighborhood = layout.communities?.neighborhood?.[nearest];
        const regionLabel = region >= 0 ? layout.labels?.[region]?.label || `Region ${region + 1}` : null;
        const profile = layout.profiles?.[nearest];
        this.tip.setText(`${layout.records[nearest].name}${region >= 0 ? ` · ${regionLabel} · Neighborhood ${neighborhood + 1}` : ' · Semantic outlier'}${this.mode === 'town' && profile ? ` · ${profile.character}` : ''}`);
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
  roadCurve(road, points) {
    const a = this.worldToScreen(points[road.a]), b = this.worldToScreen(points[road.b]);
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1;
    const random = mulberry32(hashString(`${road.a}:${road.b}`));
    const bend = (random() - 0.5) * Math.min(30, distance * 0.16);
    return { a, b, c: { x: (a.x + b.x) / 2 - dy / distance * bend, y: (a.y + b.y) / 2 + dx / distance * bend } };
  }
  drawRoads(ctx, layout, points) {
    const roads = layout.roads || [];
    const widths = { lane: 2.2, village: 3.8, regional: 5.4 };
    for (const pass of ['edge', 'surface']) {
      for (const road of roads) {
        const curve = this.roadCurve(road, points);
        const base = (widths[road.kind] || 2) + road.importance * 1.15;
        ctx.beginPath(); ctx.moveTo(curve.a.x, curve.a.y); ctx.quadraticCurveTo(curve.c.x, curve.c.y, curve.b.x, curve.b.y);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = pass === 'edge' ? base + 1.8 : base;
        ctx.strokeStyle = pass === 'edge' ? '#6f6552' : road.kind === 'regional' ? '#d7c39b' : '#e1d2ae';
        ctx.globalAlpha = pass === 'edge' ? 0.78 : 0.96;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  drawLot(ctx, layout, points, index) {
    const point = points[index], profile = layout.profiles[index], record = layout.records[index];
    const polygon = lotPolygon(point, profile, record.path);
    const screenPolygon = polygon.map((vertex) => this.worldToScreen(vertex));
    ctx.beginPath(); ctx.moveTo(screenPolygon[0].x, screenPolygon[0].y);
    for (let i = 1; i < screenPolygon.length; i++) ctx.lineTo(screenPolygon[i].x, screenPolygon[i].y);
    ctx.closePath();
    const region = layout.communities.region[index];
    ctx.fillStyle = profile.character === 'farmstead' ? '#cbd1a9' : regionColor(Math.max(0, region), 0, 0.12);
    ctx.globalAlpha = profile.character === 'farmstead' ? 0.58 : 0.5;
    ctx.fill();
    ctx.strokeStyle = '#786f5a'; ctx.globalAlpha = 0.62; ctx.lineWidth = index === this.hovered ? 1.7 : 0.75; ctx.stroke();
    if (profile.rurality > 0.42) {
      ctx.save();
      ctx.clip();
      const bounds = screenPolygon.reduce((box, vertex) => ({ minX: Math.min(box.minX, vertex.x), maxX: Math.max(box.maxX, vertex.x), minY: Math.min(box.minY, vertex.y), maxY: Math.max(box.maxY, vertex.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      ctx.strokeStyle = '#8b876a'; ctx.globalAlpha = 0.34; ctx.lineWidth = 0.65;
      const spacing = 5 + (1 - profile.topicBreadth) * 3;
      for (let offset = bounds.minX - (bounds.maxY - bounds.minY); offset < bounds.maxX + (bounds.maxY - bounds.minY); offset += spacing) {
        ctx.beginPath(); ctx.moveTo(offset, bounds.maxY); ctx.lineTo(offset + (bounds.maxY - bounds.minY) * 0.55, bounds.minY); ctx.stroke();
      }
      ctx.restore();
    }
    const connected = (layout.roads || []).filter((road) => road.a === index || road.b === index);
    let angle;
    if (connected.length) {
      const priority = { regional: 3, village: 2, lane: 1 };
      const road = connected.sort((a, b) => priority[b.kind] - priority[a.kind])[0];
      const other = points[road.a === index ? road.b : road.a];
      angle = Math.atan2(other.y - point.y, other.x - point.x);
    } else angle = mulberry32(hashString(record.path))() * Math.PI;
    const center = this.worldToScreen(point);
    const scale = Math.max(0.45, this.camera.zoom);
    const width = (5.2 + profile.buildingScale * 4.8) * scale;
    const height = (3.6 + profile.buildingScale * 2.8) * scale;
    ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(angle);
    ctx.fillStyle = '#d9c9a5'; ctx.strokeStyle = '#4f493d'; ctx.globalAlpha = 1; ctx.lineWidth = 1;
    ctx.fillRect(-width / 2, -height / 2, width, height); ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.fillStyle = profile.character === 'farmstead' ? '#9b674c' : '#a87557';
    ctx.beginPath(); ctx.moveTo(-width / 2 - 1, -height / 2); ctx.lineTo(0, -height / 2 - Math.max(2, height * 0.28)); ctx.lineTo(width / 2 + 1, -height / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -height / 2 - Math.max(2, height * 0.28)); ctx.lineTo(0, height / 2); ctx.stroke();
    if (profile.topicBreadth > 0.62 || profile.sectionComplexity > 0.7) {
      const annexWidth = width * 0.42, annexHeight = height * 0.52;
      ctx.fillStyle = '#ccb991'; ctx.fillRect(width * 0.28, height * 0.18, annexWidth, annexHeight); ctx.strokeRect(width * 0.28, height * 0.18, annexWidth, annexHeight);
    }
    if (profile.character === 'farmstead' && profile.topicBreadth > 0.38) {
      ctx.fillStyle = '#b68a66'; ctx.fillRect(-width * 0.75, height * 0.82, width * 0.34, height * 0.3); ctx.strokeRect(-width * 0.75, height * 0.82, width * 0.34, height * 0.3);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  draw() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx, ratio = this.ratio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    const layout = this.plugin.layout;
    if (!layout?.points?.length) return;
    if (this.mode === 'town') { ctx.fillStyle = '#e9e2d1'; ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight); }
    const points = this.activePoints();
    const style = getComputedStyle(this.contentEl);
    const muted = style.getPropertyValue('--text-muted').trim() || '#888';
    const accent = style.getPropertyValue('--interactive-accent').trim() || '#7c6ee6';
    if (this.plugin.settings.showRegions && layout.communities?.region) {
      const regionIds = [...new Set(layout.communities.region)].filter((region) => region >= 0);
      for (const regionId of regionIds) {
        const members = points.filter((_, index) => layout.communities.region[index] === regionId);
        if (members.length < 3) continue;
        const hull = paddedHull(members, 22).map((point) => this.worldToScreen(point));
        ctx.beginPath();
        ctx.moveTo(hull[0].x, hull[0].y);
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
        ctx.closePath();
        ctx.fillStyle = regionColor(regionId, 0, 0.045);
        ctx.strokeStyle = regionColor(regionId, 0, 0.3);
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.mode === 'town' && this.plugin.settings.showRoads) this.drawRoads(ctx, layout, points);
    if (this.mode !== 'town' && this.plugin.settings.showConnections) {
      ctx.strokeStyle = muted;
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 0.8;
      for (const edge of layout.edges) {
        const a = this.worldToScreen(points[edge.a]), b = this.worldToScreen(points[edge.b]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < points.length; i++) {
      if (this.mode === 'town' && layout.profiles?.[i]) { this.drawLot(ctx, layout, points, i); continue; }
      const point = this.worldToScreen(points[i]);
      const hovered = i === this.hovered;
      ctx.beginPath();
      ctx.arc(point.x, point.y, hovered ? 6 : 4, 0, Math.PI * 2);
      const region = layout.communities?.region?.[i];
      const neighborhood = layout.communities?.neighborhood?.[i] ?? 0;
      ctx.fillStyle = hovered ? accent : (region >= 0 ? regionColor(region, neighborhood) : muted);
      ctx.globalAlpha = hovered ? 1 : 0.82;
      ctx.fill();
      if (hovered) {
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.28; ctx.lineWidth = 5; ctx.stroke();
      }
    }
    if (this.plugin.settings.showRegionLabels && layout.communities?.region) {
      ctx.font = '600 11px var(--font-interface)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let region = 0; region < layout.communities.regionCount; region++) {
        const members = points.filter((_, index) => layout.communities.region[index] === region);
        if (!members.length) continue;
        const center = members.reduce((sum, point) => ({ x: sum.x + point.x / members.length, y: sum.y + point.y / members.length }), { x: 0, y: 0 });
        const screen = this.worldToScreen(center);
        const label = layout.labels?.[region]?.label || `Region ${region + 1}`;
        const width = ctx.measureText(label).width + 12;
        ctx.fillStyle = style.getPropertyValue('--background-primary').trim() || '#111';
        ctx.globalAlpha = 0.82;
        ctx.fillRect(screen.x - width / 2, screen.y - 10, width, 20);
        ctx.fillStyle = regionColor(region, 0, 1);
        ctx.globalAlpha = 0.95;
        ctx.fillText(label, screen.x, screen.y);
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
    containerEl.createEl('p', { text: 'A multiscale semantic plane. Rebuild after changing analysis or layout settings.' });
    const statusCard = containerEl.createDiv({ cls: 'gib-atlas-index-status' });
    const statusHeader = statusCard.createDiv({ cls: 'gib-atlas-index-status-header' });
    statusHeader.createEl('strong', { text: 'Indexer status' });
    this.plugin.settingStatusDot = statusHeader.createSpan({ cls: 'gib-atlas-status-dot' });
    this.plugin.settingStatusEl = statusCard.createDiv({ cls: 'gib-atlas-index-status-text' });
    this.plugin.settingProgressEl = statusCard.createEl('progress', { cls: 'gib-atlas-progress', attr: { max: '1' } });
    this.plugin.updateStatusUI();
    new Setting(containerEl).setName('Source folder').setDesc('Only Markdown notes inside this folder are mapped.').addText((text) => text
      .setPlaceholder('Atlas Demo').setValue(this.plugin.settings.folder)
      .onChange(async (value) => { this.plugin.settings.folder = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Semantic neighbors').setDesc('Nearby notes used to establish local structure.').addSlider((slider) => slider
      .setLimits(3, 12, 1).setValue(this.plugin.settings.neighbors).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.neighbors = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Cluster compactness').setDesc('Lower values make close semantic neighborhoods tighter.').addSlider((slider) => slider
      .setLimits(0.05, 0.8, 0.05).setValue(this.plugin.settings.compactness).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.compactness = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Common-signal removal').setDesc('Reduces themes shared by the entire collection so local distinctions remain visible.').addSlider((slider) => slider
      .setLimits(0, 0.6, 0.05).setValue(this.plugin.settings.commonSignalRemoval).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.commonSignalRemoval = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Neighborhood detail').setDesc('Higher values reveal finer communities inside broad semantic regions.').addSlider((slider) => slider
      .setLimits(0.8, 2.2, 0.05).setValue(this.plugin.settings.neighborhoodDetail).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.neighborhoodDetail = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Dot spacing').setDesc('Minimum visual separation after semantic placement.').addSlider((slider) => slider
      .setLimits(10, 32, 1).setValue(this.plugin.settings.collisionSpacing).setDynamicTooltip()
      .onChange(async (value) => { this.plugin.settings.collisionSpacing = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Show semantic connections').addToggle((toggle) => toggle
      .setValue(this.plugin.settings.showConnections)
      .onChange(async (value) => { this.plugin.settings.showConnections = value; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName('Show semantic roads').setDesc('Roads are a sparse hierarchy of genuine semantic graph relationships.').addToggle((toggle) => toggle
      .setValue(this.plugin.settings.showRoads)
      .onChange(async (value) => { this.plugin.settings.showRoads = value; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName('Show semantic regions').setDesc('Draw subtle boundaries around broad graph communities.').addToggle((toggle) => toggle
      .setValue(this.plugin.settings.showRegions)
      .onChange(async (value) => { this.plugin.settings.showRegions = value; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName('Show region labels').setDesc('Use a semantic label only when it is distinctive enough; otherwise show a neutral region number.').addToggle((toggle) => toggle
      .setValue(this.plugin.settings.showRegionLabels)
      .onChange(async (value) => { this.plugin.settings.showRegionLabels = value; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName('Rebuild semantic plane').setDesc('Re-embed changed notes and recalculate the layout.').addButton((button) => {
      this.plugin.rebuildButton = button;
      button.setButtonText(this.plugin.building ? 'Working…' : 'Rebuild').setCta().setDisabled(Boolean(this.plugin.building)).onClick(() => this.plugin.rebuild());
    });
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
  async loadSettings() {
    const saved = await this.loadData() || {};
    if ((saved.settingsVersion || 1) < 2) {
      saved.settingsVersion = 2;
      saved.neighbors = 8;
      saved.compactness = 0.12;
      saved.collisionSpacing = 10;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    await this.saveData(this.settings);
  }
  async saveSettings() { await this.saveData(this.settings); }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
  refreshViews() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.refresh?.(); }
  updateStatusUI() {
    if (this.settingStatusEl?.isConnected) this.settingStatusEl.setText(this.status || 'Idle');
    if (this.settingStatusDot?.isConnected) {
      this.settingStatusDot.toggleClass('is-working', Boolean(this.building));
      this.settingStatusDot.toggleClass('is-error', Boolean(this.status?.startsWith('Rebuild failed')));
    }
    if (this.settingProgressEl?.isConnected) {
      if (Number.isFinite(this.progress)) {
        this.settingProgressEl.value = this.progress;
        this.settingProgressEl.removeAttribute('data-indeterminate');
      } else {
        this.settingProgressEl.removeAttribute('value');
        this.settingProgressEl.setAttribute('data-indeterminate', 'true');
      }
      this.settingProgressEl.toggleClass('is-hidden', !this.building && !Number.isFinite(this.progress));
    }
    if (this.rebuildButton) {
      this.rebuildButton.setButtonText(this.building ? 'Working…' : 'Rebuild');
      this.rebuildButton.setDisabled(Boolean(this.building));
    }
  }
  setStatus(status, progress = null) {
    this.status = status;
    this.progress = progress;
    this.updateStatusUI();
    this.refreshViews();
  }
  async loadIndex() {
    try {
      if (!fs.existsSync(this.indexPath)) { this.status = 'Index not built'; return; }
      const parsed = JSON.parse(await fs.promises.readFile(this.indexPath, 'utf8'));
      if (parsed.version !== 4 || !Array.isArray(parsed.records) || !Array.isArray(parsed.points)) throw new Error('Unsupported cache');
      this.layout = parsed;
      this.status = `${parsed.records.length} notes · cached local atlas`;
      this.progress = null;
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
    env.backends.onnx.wasm.wasmBinary = wasm;
    env.backends.onnx.wasm.wasmPaths = { mjs: moduleUrl };
    this.extractor = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      progress_callback: (event) => {
        if (event.status === 'progress' && Number.isFinite(event.progress)) this.setStatus(`Downloading model · ${Math.round(event.progress)}%`, event.progress / 100);
      }
    });
    return this.extractor;
  }
  async rebuild() {
    if (this.building) { new Notice('Gib Atlas is already rebuilding.'); return; }
    this.building = true;
    this.updateStatusUI();
    try {
      const prefix = this.settings.folder.replace(/^\/+|\/+$/g, '');
      const files = this.app.vault.getMarkdownFiles().filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`));
      files.sort((a, b) => a.path.localeCompare(b.path));
      if (files.length < 3) throw new Error(`Only ${files.length} notes found in “${prefix || '/'}”.`);
      const previous = this.layout?.records || [];
      const cached = new Map(previous.filter((record) => Array.isArray(record.vector) && Array.isArray(record.chunkVectors) && Array.isArray(record.chunks) && record.stats).map((record) => [record.path, record]));
      const extractor = await this.prepareModel();
      const records = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.setStatus(`Indexing ${i + 1} of ${files.length} · ${file.basename}`, (i + 1) / files.length);
        const old = cached.get(file.path);
        let vector, chunkVectors, chunks, stats;
        if (old?.mtime === file.stat.mtime) { vector = old.vector; chunkVectors = old.chunkVectors; chunks = old.chunks; stats = old.stats; }
        else {
          const source = await this.app.vault.cachedRead(file);
          chunks = documentChunks(file, source);
          stats = sourceStats(source);
          const output = await extractor(chunks, { pooling: 'mean', normalize: true, truncation: true, max_length: 512 });
          const values = output.tolist();
          chunkVectors = (Array.isArray(values[0]?.[0]) ? values[0] : values).map((item) => Array.from(item));
          vector = meanVector(chunkVectors);
        }
        records.push({ path: file.path, name: file.basename, mtime: file.stat.mtime, vector, chunkVectors, chunks, stats });
        if (i % 2 === 1) await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      this.setStatus('Calculating semantic plane…');
      const seed = hashFiles(records);
      const similarities = semanticMatrix(records, this.settings.commonSignalRemoval, this.settings.neighbors);
      const graphData = adaptiveGraph(similarities, this.settings.neighbors);
      const communities = stableCommunities(similarities, graphData, this.settings.neighborhoodDetail, seed);
      this.setStatus('Deriving confident region labels…');
      const labels = await buildRegionLabels(records, communities, extractor);
      const distances = hierarchicalDistances(similarities, communities);
      const random = mulberry32(seed);
      const umap = new UMAP({
        nComponents: 2,
        nNeighbors: Math.min(this.settings.neighbors, records.length - 1),
        minDist: this.settings.compactness,
        spread: 1,
        random,
        distanceFn: (a, b) => distances[a[0]][b[0]]
      });
      const indexedRecords = records.map((_, index) => [index]);
      const points = relaxCollisions(normalizeLayout(umap.fit(indexedRecords)), this.settings.collisionSpacing);
      const edges = graphData.edges;
      const profiles = buildPropertyProfiles(records, graphData, communities);
      const townPoints = relaxPropertyCollisions(points, profiles);
      const roads = buildRoadNetwork(edges, communities, profiles);
      this.layout = { version: 4, model: MODEL_ID, createdAt: Date.now(), records, points, townPoints, edges, roads, profiles, communities, labels };
      await fs.promises.writeFile(this.indexPath, JSON.stringify(this.layout));
      this.status = `${records.length} properties · ${communities.regionCount} districts · ${roads.length} semantic roads`;
      this.progress = null;
      this.refreshViews();
      new Notice(`Gib Atlas mapped ${records.length} notes.`);
    } catch (error) {
      console.error('Gib Atlas: rebuild failed', error);
      this.setStatus(`Rebuild failed · ${error.message}`);
      new Notice(`Gib Atlas: ${error.message}`);
    } finally {
      this.building = false;
      this.updateStatusUI();
    }
  }
};
