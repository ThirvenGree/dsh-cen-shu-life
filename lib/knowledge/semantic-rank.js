// 2026-11-09：给独处“带着问题回忆”按意思排候选。
//   字面重叠（字二元组，常见词自动降权）+ 本地中文向量（bge-small-zh，只在本机计算、不花钱、Gemini 暂停时也能用），按排名融合。
//   这里只决定“让模型看哪些候选”；最终选哪几条仍由模型判断。
//   向量缓存单独存放在 recall-vectors.json，不碰知识层的 vectors.json（那边保存时会清掉自己不再引用的向量）。
import path from 'node:path';
import {createLocalEmbedder, VectorStore} from './embedding.js';
import {hybridRank} from './retrieval.js';
import {dir} from './common.js';

const MAX_DOCS = 3000, MAX_CHARS = 600, MAX_CACHE = 8000;

export function createSemanticRanker({home, now = () => Date.now(), embedder = null}) {
  const store = new VectorStore({home, local: embedder || createLocalEmbedder({home, now}), gemini: null});
  store.file = path.join(dir(home), 'recall-vectors.json');
  let queue = Promise.resolve();
  /** queries: string | string[]; docs: [{id, text}]. Returns {ids, signals} best first, or null when vectors are unavailable. */
  return function semanticRank({queries, docs} = {}) {
    const query = (Array.isArray(queries) ? queries : [queries]).map(q => String(q ?? '').trim()).filter(Boolean).join('\n').slice(0, MAX_CHARS);
    const rows = (Array.isArray(docs) ? docs : []).slice(0, MAX_DOCS)
      .filter(d => d && typeof d.id === 'string')
      .map(d => ({id: d.id, text: String(d.text ?? '').slice(0, MAX_CHARS)}))
      .filter(d => d.text.trim());
    if (!query || !rows.length) return Promise.resolve(null);
    // One embedding run at a time: the local model is CPU-bound and shared by every caller.
    const run = queue.then(async () => {
      const texts = [query, ...rows.map(d => d.text)];
      const local = await store.localVectors(texts);
      if (!local?.get(query)) return null;
      const ranked = hybridRank(query, rows, {local});
      const space = store.load().spaces[store.local.id];
      store.save(space && Object.keys(space.vectors).length > MAX_CACHE ? texts : undefined);
      return {ids: ranked.map(r => r.id), signals: ['lexical', 'local']};
    });
    queue = run.catch(() => {});
    return run;
  };
}
