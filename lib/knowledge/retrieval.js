// 候选挑选：最多三路信号，按排名融合（RRF，与 engram 自身的检索方式一致）。
//   ① 词频加权的字二元组重叠（常见词由语料自动降权，不靠手写停用词）——擅长专名、数字、日期；
//   ② 本地中文向量（bge-small-zh）——擅长换了说法的同一件事；
//   ③ Gemini 嵌入（可选）——由评估决定是否值得使用。
// 这一步只决定“让 Gemini 看哪些候选”；是不是同一件事仍由 Gemini 判断。
const grams = text => { const s = String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, ''); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); if (s.length === 1) g.add(s); return g; };

export function idfScorer(texts) {
  const df = new Map(), n = Math.max(1, texts.length);
  for (const t of texts) for (const g of grams(t)) df.set(g, (df.get(g) || 0) + 1);
  const idf = g => Math.log(1 + n / (1 + (df.get(g) || 0)));
  return (a, b) => { const A = grams(a), B = grams(b); let hit = 0, wa = 0, wb = 0; for (const g of A) { const w = idf(g); wa += w; if (B.has(g)) hit += w; } for (const g of B) wb += idf(g); return wa && wb ? hit / Math.min(wa, wb) : 0; };
}

const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * Rank docs for a query. docs: [{id, text}]; vectors: optional Map(text→Float32Array) per space, which must
 * include the query text. Returns [{id, score, ranks}] best first.
 */
export function hybridRank(query, docs, {local = null, gemini = null, scorer = null} = {}) {
  const lex = scorer || idfScorer([query, ...docs.map(d => d.text)]);
  const lists = [['lexical', docs.map(d => [d.id, lex(query, d.text)]).filter(([, s]) => s > 0)]];
  for (const [name, map] of [['local', local], ['gemini', gemini]]) {
    const q = map?.get(query); if (!q) continue;
    lists.push([name, docs.filter(d => map.has(d.text)).map(d => [d.id, cos(q, map.get(d.text))])]);
  }
  const fused = new Map();
  for (const [name, list] of lists) {
    list.sort((a, b) => b[1] - a[1]).forEach(([id], i) => { const r = fused.get(id) || {id, score: 0, ranks: {}}; r.score += 1 / (60 + i + 1); r.ranks[name] = i + 1; fused.set(id, r); });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

export const signalsUsed = ({local, gemini}) => ['lexical', ...(local ? ['local'] : []), ...(gemini ? ['gemini'] : [])];
