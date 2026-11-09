#!/usr/bin/env node
// 人设探针与分层消融。默认只预览，不调用模型。线上数据只复制到临时目录后使用，运行结果和评分单独存放。
//   node scripts/censhu-probe.mjs                         预览：各层有多少资料、这次要花多少调用
//   node scripts/censhu-probe.mjs run [--layers a,b] [--limit 40] [--repeats 1] [--categories task,daily]
//   node scripts/censhu-probe.mjs verdict                  让两家模型对最新一次运行重新下结论
//   node scripts/censhu-probe.mjs report [运行文件]        看某次运行的结果
//   node scripts/censhu-probe.mjs rate [--n 20]            盲评抽样，不显示是哪一层、模型打了多少分
//   node scripts/censhu-probe.mjs calibration              青枔的评分累积到多少，和模型评分的一致度
// 回复用 Gemini 生成，不是线上的主对话模型，所以这里比较的是各层的相对差异。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import {googleStructured} from '../lib/situation.js';
import {terraReview, independentReviewStatus} from '../lib/terra-review.js';
import {PROBES} from '../lib/probes/bank.js';
import {prepareProbeHome, bestProbeTime, candidateTimes, LAYERS, DEFAULT_LAYERS, callEstimate, bankCost, runProbes, summarizeRun, comparePairs, pairStats, judgeAgreement, modelVerdict, verdictReport, CONTROL_LAYER, profileForJudge, judgePrompt, judgeSchema, runsDir, readRatings, appendRating, blindSample, calibration} from '../lib/probes/harness.js';

const argv = process.argv.slice(2), command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'preview';
const option = (name, fallback) => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : fallback; };
const realHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const config = (() => { try { return JSON.parse(fs.readFileSync(path.join(realHome, 'cen-shu-life/config.json'), 'utf8')); } catch { return {}; } })();
const latestRun = () => { const dir = runsDir(realHome); const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : []; return files.length ? path.join(dir, files.at(-1)) : null; };
const loadRun = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const printSummary = s => { console.table(Object.fromEntries(Object.entries(s.layers).map(([k, v]) => [k, {n: v.n, 错误: v.errors, 矛盾: v.contradictions, 知识: v.knowledge, 风格: v.style, 不出戏: v.inCharacter, 知识差: v.knowledgeDelta, 风格差: v.styleDelta, 出戏差: v.inCharacterDelta}]))); console.log('差值是和 full 比较同一题的变化，负数表示去掉这层后分数变低。单次运行的小差异多半是噪声。'); for (const [k, v] of Object.entries(s.layers)) { if (v.drift) console.log(k, '长聊末尾减开头', JSON.stringify(v.drift)); if (v.response) console.log(k, '需要安慰时的回应', JSON.stringify(v.response)); } };

async function withParts(fn) {
  const home = prepareProbeHome(realHome);
  // 独处资料会过期：默认用这些资料还有效、能比较的层最多的那个时间点。用 --at 2026-11-05T12:00:00+08:00 可以指定。
  const at = option('at');
  const candidates = at ? [Date.parse(at)] : candidateTimes(home);
  if (candidates.some(t => !Number.isFinite(t))) throw Error('--at 时间格式无效');
  try { return await fn(await bestProbeTime({home, candidates})); } finally { fs.rmSync(home, {recursive: true, force: true}); }
}
const selectBank = () => { const cats = option('categories'), list = cats ? PROBES.filter(p => cats.split(',').includes(p.category)) : PROBES; return list.slice(0, Number(option('limit', list.length))); };
// 2026-11-09: the control group is always part of a run; without it no difference can be told from noise.
const selectLayers = () => { const chosen = (option('layers') || DEFAULT_LAYERS.join(',')).split(','); for (const l of chosen) if (!LAYERS[l]) throw Error('没有这一层：' + l); return [...new Set(['full', ...chosen, CONTROL_LAYER])]; };
const usable = (layers, effects) => layers.filter(l => l === 'full' || l === CONTROL_LAYER || effects[l] > 0);
const modelsFor = () => ({gemini: (system, schema, input, options = {}) => googleStructured(system, schema, input, config, {temperature: 0, signal: AbortSignal.timeout(60000), ...options}), ...(independentReviewStatus().configured ? {terra: (system, schema, input, options = {}) => terraReview(system, schema, input, config, {...options, maxOutputTokens: 4000})} : {})});
const printVerdict = v => { console.log('\n分层结论（两家一致才算）' + (v.note ? '：' + v.note : '')); for (const i of v.items) console.log('  ' + i.layer + ' · ' + i.decisionText + (i.agreed ? '' : '（两家不一致或缺结论）') + ' · ' + Object.entries(i.opinions).map(([n, o]) => n + '：' + (o ? o.decision + ' ' + o.reason : '无')).join(' / ')); console.log('噪声（对照组差异）', v.noise, '一致度', JSON.stringify(v.agreement)); };

if (command === 'preview') await withParts(({parts, innerError, now, effects}) => {
  console.log('使用的时间点', new Date(now + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '), '上下文段数', parts.length, innerError ? '（独处层未载入：' + innerError + '）' : '');
  console.table(Object.fromEntries(Object.entries(effects).map(([k, v]) => [k, {去掉的字符数: v, 说明: k !== 'full' && v === 0 ? '现在没有这层的资料，跑了也没有差别' : ''}])));
  const layers = usable(selectLayers(), effects), bank = selectBank(), judges = independentReviewStatus().configured ? 2 : 1;
  console.log('题目', bank.length, '层', layers.join('、'), '评分家数', judges, '预计调用', callEstimate({...bankCost(bank), layers: layers.length, repeats: Number(option('repeats', 1)), judges, comparisons: true}));
});
else if (command === 'run') await withParts(async ({parts, engine, effects}) => {
  // 没有资料的层和完整上下文一模一样，不花调用。
  const layers = usable(selectLayers(), effects), bank = selectBank(), repeats = Number(option('repeats', 1)), profile = profileForJudge(engine), models = modelsFor();
  const reply = (system, probe) => googleStructured(system + '\n只把对青枔说的话作为回复，不输出分析。', null, {...(probe.history?.length ? {前面的对话: probe.history} : {}), 青枔的消息: probe.text}, config, {feature: 'probe-reply', maxOutputTokens: 4000, temperature: 0.7, signal: AbortSignal.timeout(90000)});
  const judges = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, input => model(judgePrompt, judgeSchema, input, {feature: 'probe-judge', maxOutputTokens: 800})]));
  let done = 0; const total = bank.length * layers.length * repeats;
  const rows = await runProbes({bank, layers, parts, profile, reply, judges, repeats, onRow: row => { done++; if (done % 10 === 0 || done === total) console.log(done + '/' + total + (row.error ? ' 最近一条出错：' + row.error : '')); }});
  const at = new Date().toISOString().replace(/[:.]/g, '-'), file = path.join(runsDir(realHome), 'run-' + at + '.json'), summary = summarizeRun(rows);
  console.log('盲选对比…'); const pairs = await comparePairs({rows, profile, models}), stats = pairStats(pairs), agreement = judgeAgreement(rows, pairs);
  const save = extra => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify({at: Date.now(), model: config.semanticModel, layers, rows, summary, pairs, stats, agreement, ...extra})); };
  save({}); const verdict = await modelVerdict({rows, pairs, summary, models}); save({verdict});
  console.log('已保存', file); printSummary(summary); printVerdict(verdict);
});
else if (command === 'verdict') { const models = modelsFor(); printVerdict(await verdictReport({home: realHome, generate: models.gemini, review: models.terra})); }
else if (command === 'report') { const file = argv[1] && !argv[1].startsWith('--') ? argv[1] : latestRun(); if (!file) throw Error('还没有运行记录'); const run = loadRun(file); console.log(file, run.model); printSummary(run.summary); console.table(run.summary.categories); }
else if (command === 'rate') {
  const file = latestRun(); if (!file) throw Error('还没有运行记录，先跑 run');
  const sample = blindSample(loadRun(file).rows, readRatings(realHome), Number(option('n', 20)));
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  const ask = async label => { for (;;) { const a = (await rl.question(label + '（1-5，回车跳过这条，q 退出）：')).trim(); if (a === 'q' || a === '') return a; if (/^[1-5]$/.test(a)) return Number(a); } };
  for (const row of sample) {
    console.log('\n青枔：' + row.question + '\n岑舒：' + row.reply);
    const knowledge = await ask('说的事对不对'); if (knowledge === 'q') break; if (knowledge === '') continue;
    const style = await ask('语气像不像她'); if (style === 'q') break; if (style === '') continue;
    const inCharacter = await ask('有没有出戏（5 是完全没有）'); if (inCharacter === 'q') break; if (inCharacter === '') continue;
    appendRating(realHome, {at: Date.now(), key: row.key, category: row.category, layer: row.layer, knowledge, style, inCharacter, judgments: row.judgments});
  }
  rl.close(); console.log(calibration(readRatings(realHome)));
}
else if (command === 'calibration') console.log(JSON.stringify(calibration(readRatings(realHome)), null, 2));
else throw Error('未知命令：' + command);
