// 2026-11-06：候选挑选（词频加权 + 本地向量 + 可选 Gemini 嵌入）的测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {hybridRank, idfScorer} from '../lib/knowledge/retrieval.js';
import {VectorStore, createGeminiEmbedder, createLocalEmbedder} from '../lib/knowledge/embedding.js';
import {retrievalBenchmark, RETRIEVAL_PAIRS} from '../lib/knowledge/evaluate.js';
import {searchHybrid} from '../lib/knowledge/salience.js';
import {KnowledgeConsolidator} from '../lib/knowledge/consolidate.js';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const fakeEmbedder = (id, fn) => ({id, model: () => id, calls: 0, async embed(texts) { this.calls++; return texts.map(fn); }});
const tagVec = tags => t => { const v = new Float32Array(tags.length); tags.forEach((g, i) => { if (g.test(t)) v[i] = 1; }); const n = Math.hypot(...v) || 1; return v.map(x => x / n); };

test('hybrid ranking fuses lexical and vector ranks, so a paraphrase with no shared words still surfaces', () => {
  const docs = [{id: 'a', text: '青枔不吃香菜'}, {id: 'b', text: '青枔说受不了图书馆里的味道'}, {id: 'c', text: '青枔说一到晚上就受不了困'}, {id: 'd', text: '青枔说闻到雨的味道很舒服'}, {id: 'e', text: '岑舒在整理旧书'}];
  const q = '青枔说一闻到芫荽的味道就受不了';
  const rankOf = list => list.findIndex(r => r.id === 'a') + 1 || Infinity;
  const lexical = rankOf(hybridRank(q, docs));
  assert.ok(lexical > 3, 'lexical alone buries the paraphrase under shared words (rank ' + lexical + ')');
  const vec = new Map([q, ...docs.map(d => d.text)].map(t => [t, tagVec([/香菜|芫荽/, /图书馆/, /困/, /雨/, /旧书/])(t)]));
  const fused = rankOf(hybridRank(q, docs, {local: vec}));
  assert.ok(fused <= 3 && fused < lexical, 'fusion lifts it into the top candidates (rank ' + fused + ')');
  const s = idfScorer(['青枔下周三考试', '青枔周末去图书馆', '青枔不吃香菜']);
  assert.ok(s('考试改到周五', '青枔下周三考试') > s('考试改到周五', '青枔不吃香菜'), 'rare words weigh more than the common name');
});

test('vector cache: keyed by content hash, reused across restarts, pruned, and reset when the Gemini model changes', async () => {
  const home = tmp('knowledge-vec-');
  const local = fakeEmbedder('local:x', () => Float32Array.of(1, 0));
  const store = new VectorStore({home, local});
  await store.localVectors(['甲', '乙']); await store.localVectors(['甲', '乙', '丙']); assert.equal(local.calls, 2);
  store.save(new Set(['甲']));
  const again = new VectorStore({home, local}); assert.equal((await again.localVectors(['甲'])).size, 1); assert.equal(local.calls, 2, 'reloaded from disk, not recomputed');
  let model = 'gemini-embedding-2';
  const gem = {id: 'gemini:768', model: () => model, async embed(t) { return t.map(() => Float32Array.of(0, 1)); }};
  const s2 = new VectorStore({home, local, gemini: gem});
  await s2.geminiVectors(['甲']); assert.equal(Object.keys(s2.space('gemini:768').vectors).length, 1);
  model = 'gemini-embedding-001'; await s2.geminiVectors(['乙']);
  assert.equal(s2.space('gemini:768').model, 'gemini-embedding-001'); assert.equal(Object.keys(s2.space('gemini:768').vectors).length, 1, 'vectors from the old model are dropped');
  fs.rmSync(home, {recursive: true, force: true});
});

test('Gemini embedding failures or a "not useful" verdict only drop that signal; consolidation still runs', async () => {
  const home = tmp('knowledge-gem-');
  let allowed = true;
  const store = new VectorStore({home, local: fakeEmbedder('local:x', tagVec([/摄影/])), gemini: {id: 'gemini:768', model: () => 'm', async embed() { throw Object.assign(Error('HTTP 402'), {httpStatus: 402}); }}, geminiAllowed: () => allowed});
  assert.equal(await store.geminiVectors(['摄影']), null); assert.match(store.geminiError, /402/);
  allowed = false; store.gemini = {id: 'gemini:768', model: () => 'm', embed: async () => assert.fail('must not call when disallowed')};
  assert.equal(await store.geminiVectors(['摄影']), null);
  const c = new KnowledgeConsolidator({home, now: () => Date.now(), sourceOptions: () => ({}), vectorStore: store, generate: async (_p, _s, input) => ({decisions: input.sources.map(s => ({sourceKey: s.sourceKey, relation: 'new', changeType: 'formed', reason: 'r', item: {subject: '岑舒', kind: 'interest', stage: 'intended', content: s.text}, importance: {level: 'medium', class: 'experience', holdDays: 30, reason: 'r'}}))})});
  const idx = {version: 1, revision: 0, sources: {'life:a': {key: 'life:a', store: 'life', text: '岑舒想学摄影', hash: 'h', visibility: 'shared', origin: 'her-life', reviewed: false}}, items: {}, ignored: {}, cost: {}};
  await c.processBatch(idx, [idx.sources['life:a']]);
  assert.deepEqual(idx.retrieval.signals, ['lexical', 'local']); assert.equal(Object.keys(idx.items).length, 1);
  fs.rmSync(home, {recursive: true, force: true});
});

test('Gemini embedder falls back across model variants on 400/404, normalizes vectors, and surfaces billing errors', async () => {
  const home = tmp('knowledge-gfetch-'), old = process.env.DSH_HOME; process.env.DSH_HOME = home;
  try {
    const seen = [];
    const fetcher = async (url, init) => {
      const body = JSON.parse(init.body); seen.push([url.includes('gemini-embedding-2') ? 2 : 1, Boolean(body.requests[0].taskType)]);
      if (url.includes('gemini-embedding-2')) return {ok: false, status: 404, json: async () => ({error: {message: 'not found'}})};
      return {ok: true, status: 200, json: async () => ({embeddings: body.requests.map(() => ({values: [3, 4]}))})};
    };
    const e = createGeminiEmbedder({config: () => ({}), fetcher, keyReader: async () => 'k'});
    const v = await e.embed(['a', 'b']);
    assert.equal(v.length, 2); assert.ok(Math.abs(v[0][0] - 0.6) < 1e-6, 'normalized'); assert.equal(e.model(), 'gemini-embedding-001');
    assert.deepEqual(seen, [[2, true], [2, false], [1, true]]);
    const broke = createGeminiEmbedder({config: () => ({}), keyReader: async () => 'k', fetcher: async () => ({ok: false, status: 402, json: async () => ({error: {message: 'credits depleted'}})})});
    await assert.rejects(broke.embed(['a']), /402/);
  } finally { process.env.DSH_HOME = old; fs.rmSync(home, {recursive: true, force: true}); }
});

test('retrieval benchmark measures each method and decides whether Gemini embeddings are worth keeping', async () => {
  const tags = [/摄影|相机|光圈/, /构图|三分法|教程/, /考试|复习/, /考研|研究生|图书馆/, /爬山|山上/, /香菜|芫荽/, /吉他|琴弦/, /猫|橘色的小家伙/, /失眠|睡着/];
  const good = tagVec(tags), noisy = t => Float32Array.of(1, t.length % 3, 0);
  const index = {sources: {x: {text: '岑舒在整理旧书', visibility: 'shared'}, y: {text: '青枔去海边玩了', visibility: 'shared'}}};
  const helps = await retrievalBenchmark({index, vectorStore: new VectorStore({home: tmp('kb-'), local: fakeEmbedder('local:noisy', noisy), gemini: fakeEmbedder('gemini:768', good)})});
  assert.equal(helps.pairs, RETRIEVAL_PAIRS.length);
  assert.ok(helps.methods.hybridAll.recall >= helps.methods.hybridLocal.recall);
  const same = await retrievalBenchmark({index, vectorStore: new VectorStore({home: tmp('kb-'), local: fakeEmbedder('local:good', good), gemini: fakeEmbedder('gemini:768', good)})});
  assert.equal(same.methods.hybridLocal.recall, 1); assert.equal(same.geminiUseful, false, 'no gain over the local hybrid → Gemini embeddings get switched off');
  const down = await retrievalBenchmark({index, vectorStore: new VectorStore({home: tmp('kb-'), local: fakeEmbedder('local:good', good), gemini: {id: 'gemini:768', model: () => 'm', embed: async () => { throw Error('HTTP 402'); }}})});
  assert.equal(down.geminiUseful, undefined, 'unmeasured: the previous decision stays'); assert.match(down.geminiError, /402/);
});

test('chat-time recall stays local and falls back to lexical when the local model is unavailable', async () => {
  const mk = (id, subject, content) => ({id, subject, kind: 'interest', stage: 'ongoing', content, status: 'active', visibility: 'shared', sources: [], links: [], history: []});
  const idx = {sources: {}, items: {a: mk('a', '青枔', '青枔不吃香菜'), b: mk('b', '岑舒', '岑舒想学吉他')}};
  const home = tmp('knowledge-sh-');
  const store = new VectorStore({home, local: fakeEmbedder('local:x', tagVec([/香菜|芫荽/, /吉他|琴弦/])), gemini: {id: 'gemini:768', model: () => 'm', embed: async () => assert.fail('chat path must not call Gemini')}});
  assert.equal((await searchHybrid(idx, {rows: []}, '一闻到芫荽就受不了', {vectorStore: store}))[0].id, 'a');
  const broken = new VectorStore({home, local: {id: 'local:y', model: () => 'y', embed: async () => { throw Error('no model'); }}});
  assert.deepEqual((await searchHybrid(idx, {rows: []}, '吉他', {vectorStore: broken})).map(i => i.id), ['b']);
  fs.rmSync(home, {recursive: true, force: true});
});

const realModel = path.join(os.homedir(), '.dsh', 'engram', 'models', 'Xenova', 'bge-small-zh-v1.5');
test('integration: the real local bge-small-zh model puts every benchmark pair into the candidates', {skip: !fs.existsSync(realModel)}, async () => {
  const local = createLocalEmbedder({home: path.join(os.homedir(), '.dsh')});
  const r = await retrievalBenchmark({index: {sources: {}}, vectorStore: new VectorStore({home: tmp('kb-real-'), local})});
  assert.equal(r.methods.hybridLocal.recall, 1, JSON.stringify(r.methods));
  assert.ok(r.methods.hybridLocal.recall >= r.methods.lexical.recall);
});
