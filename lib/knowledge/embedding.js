// 向量：本地中文模型为基础层（一直可用、不出本机），Gemini 嵌入为可选的第三路信号。
//   本地：复用 engram 已下载的 Xenova/bge-small-zh-v1.5（只读模型文件，不碰 engram 代码）；
//   Gemini：batchEmbedContents，与其他 Gemini 调用共用密钥、代理与“欠费自动暂停”。
// 两种向量分开缓存（按内容哈希），从不混用；任何一路失败都只是少一路信号，不影响整理的其他部分。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readGoogleKey} from '../situation.js';
import {checkGeminiPause, noteGeminiError, noteGeminiSuccess} from '../gemini-pause.js';
import {observeGemini, addUsage} from '../gemini-telemetry.js';
import {dir, readJson, writeJson, sha} from './common.js';

const RETRY_LOCAL_MS = 60 * 60000;
const toB64 = v => Buffer.from(new Float32Array(v).buffer).toString('base64');
const fromB64 = s => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const normalize = v => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, x => x / n); };

export function createLocalEmbedder({home, modelId = 'Xenova/bge-small-zh-v1.5', now = () => Date.now()}) {
  let pipe = null, failedAt = 0, lastError = '';
  const load = async () => {
    const lib = path.join(home, 'profiles', 'desktop', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');
    const T = await import(pathToFileURL(lib).href);
    T.env.localModelPath = path.join(home, 'engram', 'models') + path.sep; T.env.allowRemoteModels = false;
    return T.pipeline('feature-extraction', modelId, {dtype: 'q8'});
  };
  return {
    id: 'local:' + modelId,
    status: () => ({ready: Boolean(pipe), failedAt, error: lastError}),
    async embed(texts) {
      if (failedAt && now() - failedAt < RETRY_LOCAL_MS) throw Error('本地向量模型暂不可用：' + lastError);
      try { pipe ||= await load(); } catch (e) { failedAt = now(); lastError = String(e?.message || e).slice(0, 160); pipe = null; throw e; }
      const out = [];
      for (let i = 0; i < texts.length; i += 32) {
        const batch = texts.slice(i, i + 32), o = await pipe(batch, {pooling: 'cls', normalize: true}), d = o.dims[1];
        batch.forEach((_, j) => out.push(Float32Array.from(o.data.slice(j * d, (j + 1) * d))));
      }
      failedAt = 0; return out;
    },
  };
}

// 型号依次尝试（新型号不可用或参数不兼容时退到上一代），记住第一个成功的组合。
const VARIANTS = [{model: 'gemini-embedding-2', taskType: true}, {model: 'gemini-embedding-2', taskType: false}, {model: 'gemini-embedding-001', taskType: true}];
/** Network blip worth one retry: no HTTP status, not cancelled, and undici/socket says the connection dropped. */
export function transientNetworkError(e, signal) {
  if (!e || e.httpStatus || signal?.aborted) return false;
  if (/abort|timeout/i.test(String(e.name) + ' ' + String(e.message))) return false;
  const text = [e.message, e.code, e.cause?.code, e.cause?.message].map(x => String(x ?? '')).join(' ');
  return /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT|socket hang up|other side closed|terminated/i.test(text);
}
export function createGeminiEmbedder({config, fetcher, keyReader = readGoogleKey, dims = 768, retryDelayMs = 1500}) {
  let chosen = null;
  async function call(variant, texts, key, signal, meta) {
    const cfg = config();
    let dispatcher;
    try {
      const f = fetcher || (await import('undici')).fetch;
      if (cfg.semanticProxyUrl) { const {ProxyAgent} = await import('undici'); const u = new URL(cfg.semanticProxyUrl); if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password) throw Error('语义代理须为本机 HTTP 地址'); dispatcher = new ProxyAgent(u.toString()); }
      const body = {requests: texts.map(t => ({model: 'models/' + variant.model, content: {parts: [{text: t}]}, outputDimensionality: dims, ...(variant.taskType ? {taskType: 'SEMANTIC_SIMILARITY'} : {})}))};
      const r = await f('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(variant.model) + ':batchEmbedContents', {method: 'POST', dispatcher, signal, headers: {'x-goog-api-key': key, 'content-type': 'application/json'}, body: JSON.stringify(body)});
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(Error('Gemini 嵌入失败（HTTP ' + r.status + '）：' + String(data.error?.message || '').replaceAll(key, '[redacted]').slice(0, 160)), {httpStatus: r.status});
      addUsage(meta, data.usageMetadata);
      const rows = data.embeddings || [];
      if (rows.length !== texts.length || rows.some(x => !Array.isArray(x?.values) || !x.values.length)) throw Error('Gemini 嵌入返回条数不符');
      return rows.map(x => normalize(x.values));
    } finally { if (dispatcher) void dispatcher.destroy().catch(() => {}); }
  }
  return {
    id: 'gemini:' + dims,          // 固定的缓存空间；实际型号记在空间的 model 字段里，型号变了就清空重算
    model: () => chosen?.model || null,
    async embed(texts, {signal} = {}) {
      checkGeminiPause();
      const key = await keyReader(); if (!key) throw Error('缺少 Gemini 密钥');
      const out = [];
      for (let i = 0; i < texts.length; i += 100) {
        const batch = texts.slice(i, i + 100);
        const tryVariants = chosen ? [chosen] : VARIANTS;
        let last;
        for (const v of tryVariants) {
          try {
            let vecs;
            try { vecs = await observeGemini('knowledge-embedding', v.model, meta => call(v, batch, key, signal, meta)); }
            catch (e) {
              // 2026-11-07: a momentary network drop (no HTTP status, e.g. "fetch failed"/ECONNRESET via the proxy) gets one retry.
              if (!transientNetworkError(e, signal)) throw e;
              await new Promise(r => setTimeout(r, retryDelayMs));
              vecs = await observeGemini('knowledge-embedding', v.model, meta => call(v, batch, key, signal, meta));
            }
            chosen = v; noteGeminiSuccess(); out.push(...vecs); last = null; break;
          } catch (e) { last = e; if (![400, 404].includes(Number(e.httpStatus))) break; }
        }
        if (last) { noteGeminiError(last); throw last; }
      }
      return out;
    },
  };
}

/** Hash-keyed vector cache for both embedders; never mixes the two spaces. */
export class VectorStore {
  constructor({home, local, gemini, geminiAllowed = () => true}) {
    Object.assign(this, {local, gemini, geminiAllowed});
    this.file = path.join(dir(home), 'vectors.json');
    this.data = null; this.dirty = false; this.geminiError = '';
  }
  load() { if (!this.data) { const d = readJson(this.file, null); this.data = d && d.version === 1 ? d : {version: 1, spaces: {}}; } return this.data; }
  space(id) { const d = this.load(); return d.spaces[id] ||= {vectors: {}}; }
  async ensure(embedder, texts, opts) {
    if (!embedder) return null;
    const unique = [...new Set(texts.filter(Boolean))], sp = this.space(embedder.id), missing = unique.filter(t => !sp.vectors[sha(t)]);
    if (missing.length) {
      const vecs = await embedder.embed(missing, opts);
      const model = embedder.model?.() || embedder.id;
      if (sp.model && sp.model !== model) { sp.vectors = {}; sp.model = model; this.dirty = true; return this.ensure(embedder, texts, opts); } // 型号变了：清空旧向量，用新型号重算一次
      sp.model = model;
      missing.forEach((t, i) => { sp.vectors[sha(t)] = toB64(vecs[i]); });
      this.dirty = true;
    }
    const final = this.space(embedder.id), map = new Map();
    for (const t of unique) if (final.vectors[sha(t)]) map.set(t, fromB64(final.vectors[sha(t)]));
    return map;
  }
  /** Local vectors (null when the local model is unavailable). */
  async localVectors(texts) { try { return await this.ensure(this.local, texts); } catch { return null; } }
  /** Gemini vectors only when allowed by config and the latest benchmark; failures just drop this signal. */
  async geminiVectors(texts, opts) {
    if (!this.gemini || !this.geminiAllowed()) return null;
    try { const m = await this.ensure(this.gemini, texts, opts); this.geminiError = ''; return m; } catch (e) { this.geminiError = String(e?.message || e).slice(0, 160); return null; }
  }
  /** Persist and drop vectors whose text is no longer referenced. */
  save(keepTexts) {
    if (!this.data) return;
    if (keepTexts) { const keep = new Set([...keepTexts].map(sha)); for (const sp of Object.values(this.data.spaces)) for (const h of Object.keys(sp.vectors)) if (!keep.has(h)) { delete sp.vectors[h]; this.dirty = true; } }
    if (this.dirty) { try { writeJson(this.file, this.data); this.dirty = false; } catch {} }
  }
}
