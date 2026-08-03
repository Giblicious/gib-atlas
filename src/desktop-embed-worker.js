const { pipeline, env } = require('@huggingface/transformers');

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const RELATION_MODEL_ID = 'Xenova/mobilebert-uncased-mnli';
const TOPIC_LABEL_MODEL_ID = 'Xenova/flan-t5-base';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
let configuration = null;
let pipe = null;
let modelPromise = null;
let relationPipe = null;
let relationPromise = null;
let topicLabelPipe = null;
let topicLabelPromise = null;
let nextCacheId = 1;
const pendingCache = new Map();
let embedQueue = Promise.resolve();

function requestKey(request) { return typeof request === 'string' ? request : request?.url || String(request || ''); }
function cacheRequest(action, key, buffer = null) {
  const id = nextCacheId++;
  return new Promise((resolve, reject) => {
    pendingCache.set(id, { resolve, reject });
    const message = { type: 'cache', id, action, key };
    if (buffer) { message.buffer = buffer; self.postMessage(message, [buffer]); } else self.postMessage(message);
  });
}

const modelCache = {
  async match(request) {
    const buffer = await cacheRequest('match', requestKey(request));
    return buffer ? new Response(buffer, { headers: { 'Content-Length': String(buffer.byteLength) } }) : undefined;
  },
  async put(request, response) { await cacheRequest('put', requestKey(request), await response.arrayBuffer()); },
};

async function gunzipBase64(encoded, text = false) {
  const compressed = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return text ? new Response(stream).text() : new Uint8Array(await new Response(stream).arrayBuffer());
}

async function initializeModel() {
  if (pipe) return pipe;
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const mobile = Boolean(configuration.mobile); env.allowRemoteModels = true; env.allowLocalModels = false; env.useCustomCache = !mobile; env.customCache = mobile ? null : modelCache; env.useBrowserCache = mobile; env.useFSCache = false;
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
      const moduleSource = await gunzipBase64(configuration.wasmModuleGzip, true);
      env.backends.onnx.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' })) };
      env.backends.onnx.wasm.wasmBinary = await gunzipBase64(configuration.wasmGzip);
    }
    const loaded = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', progress_callback: progress => {
      if (progress.status === 'progress' && Number.isFinite(Number(progress.progress))) self.postMessage({ type: 'progress', file: progress.file || 'BGE', progress: Number(progress.progress) });
    } });
    await loaded([`${QUERY_PREFIX}warm semantic search`], { pooling: 'mean', normalize: true });
    pipe = loaded; self.postMessage({ type: 'ready' }); return pipe;
  })();
  try { return await modelPromise; } finally { modelPromise = null; }
}

async function embed(texts, query) {
  const model = await initializeModel(); const input = texts.map(text => query ? `${QUERY_PREFIX}${text}` : text);
  const output = await model(input, { pooling: 'mean', normalize: true }); const dimension = output.dims.at(-1);
  const buffers = input.map((_, index) => new Float32Array(output.data.slice(index * dimension, (index + 1) * dimension)).buffer);
  return { buffers, transfer: buffers };
}

async function initializeRelationModel() {
  if (relationPipe) return relationPipe; if (relationPromise) return relationPromise; await initializeModel();
  relationPromise = pipeline('text-classification', RELATION_MODEL_ID, { dtype: 'q8', progress_callback: progress => { if (progress.status === 'progress' && Number.isFinite(Number(progress.progress))) self.postMessage({ type: 'relation-progress', file: progress.file || 'relationship model', progress: Number(progress.progress) }); } });
  try { relationPipe = await relationPromise; self.postMessage({ type: 'relation-ready' }); return relationPipe; } finally { relationPromise = null; }
}
function softmax(values) { const maximum = Math.max(...values), exponents = values.map(value => Math.exp(value - maximum)), total = exponents.reduce((sum, value) => sum + value, 0) || 1; return exponents.map(value => value / total); }
async function classifyRelations(pairs) {
  const classifier = await initializeRelationModel(), results = [];
  for (let offset = 0; offset < pairs.length; offset += 24) { const batch = pairs.slice(offset, offset + 24), premises = batch.map(pair => String(pair.premise || '').slice(0, 1200)), hypotheses = batch.map(pair => String(pair.hypothesis || '').slice(0, 1200)), inputs = classifier.tokenizer(premises, { text_pair: hypotheses, padding: true, truncation: true, max_length: 256 }), output = await classifier.model(inputs), width = output.logits.dims.at(-1), labels = classifier.model.config.id2label || {}; results.push(...batch.map((_, index) => { const probabilities = softmax(Array.from(output.logits.data.slice(index * width, (index + 1) * width))), result = { entailment: 0, neutral: 0, contradiction: 0 }; probabilities.forEach((score, labelIndex) => { const label = String(labels[labelIndex] || labels[String(labelIndex)] || '').toLowerCase(); if (label.includes('entail') || !label && labelIndex === 2) result.entailment = score; else if (label.includes('contrad') || !label && labelIndex === 0) result.contradiction = score; else result.neutral = score; }); return result; })); }
  return results;
}

async function initializeTopicLabelModel() {
  if (topicLabelPipe) return topicLabelPipe;
  if (topicLabelPromise) return topicLabelPromise;
  await initializeModel();
  topicLabelPromise = pipeline('text2text-generation', TOPIC_LABEL_MODEL_ID, { dtype: 'q8', progress_callback: progress => {
    if (progress.status === 'progress' && Number.isFinite(Number(progress.progress))) self.postMessage({ type: 'topic-label-progress', file: progress.file || 'topic label model', progress: Number(progress.progress) });
  } });
  try { topicLabelPipe = await topicLabelPromise; self.postMessage({ type: 'topic-label-ready' }); return topicLabelPipe; }
  finally { topicLabelPromise = null; }
}

async function generateTopicLabels(prompts) {
  const generator = await initializeTopicLabelModel(), labels = [];
  for (const prompt of prompts) {
    const output = await generator(String(prompt || ''), { max_new_tokens: 8, do_sample: false, num_beams: 4, repetition_penalty: 1.1 });
    labels.push(String(output?.[0]?.generated_text || '').trim());
  }
  return labels;
}

async function handleEmbed(message) {
  try { const result = await embed(message.texts || [], Boolean(message.query)); self.postMessage({ type: 'result', id: message.id, buffers: result.buffers }, result.transfer); }
  catch (error) { self.postMessage({ type: 'error', id: message.id, message: error?.message || String(error) }); }
}
async function handleRelations(message) { try { self.postMessage({ type: 'relation-result', id: message.id, results: await classifyRelations(message.pairs || []) }); } catch (error) { self.postMessage({ type: 'error', id: message.id, message: error?.message || String(error) }); } }
async function handleTopicLabels(message) { try { self.postMessage({ type: 'topic-label-result', id: message.id, labels: await generateTopicLabels(message.prompts || []) }); } catch (error) { self.postMessage({ type: 'error', id: message.id, message: error?.message || String(error) }); } }

self.onmessage = event => {
  const message = event.data;
  if (message.type === 'cache-result') {
    const pending = pendingCache.get(message.id); if (!pending) return; pendingCache.delete(message.id);
    if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.buffer || null); return;
  }
  if (message.type === 'init') { configuration = message; self.postMessage({ type: 'initialized' }); return; }
  if (message.type === 'embed') embedQueue = embedQueue.then(() => handleEmbed(message));
  else if (message.type === 'relations') handleRelations(message);
  else if (message.type === 'topic-labels') handleTopicLabels(message);
};
