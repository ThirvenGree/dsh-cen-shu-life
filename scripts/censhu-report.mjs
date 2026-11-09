#!/usr/bin/env node
// 只读报告：跨天重复度、关系账本、主动联系结果、写回漏斗、心情和使用趋势。不改任何插件数据，结果只打印出来。
//   node scripts/censhu-report.mjs [all|repetition|relationship|contacts|writeback|trends|priorities] [--dry] [--json]
// --dry 只统计有多少资料，不调用模型。重复度每周一次调用，关系账本一次调用。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {googleStructured} from '../lib/situation.js';
import {repetitionReport} from '../lib/reports/repetition.js';
import {relationshipReport} from '../lib/reports/relationship.js';
import {writebackReport} from '../lib/reports/writeback.js';
import {trendsReport} from '../lib/reports/trends.js';
import {contactsReport} from '../lib/reports/contacts.js';
import {prioritiesReport} from '../lib/reports/priorities.js';
import {terraReview, independentReviewStatus} from '../lib/terra-review.js';

const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--'))), what = args.find(a => !a.startsWith('--')) || 'all';
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(home, file), 'utf8')); } catch { return fallback; } };
const config = readJson('cen-shu-life/config.json', {});
const generate = flags.has('--dry') ? null : (system, schema, input, {feature, ...options}) => googleStructured(system, schema, input, config, {feature, signal: AbortSignal.timeout(90000), ...options});
const out = {};
if (['all', 'repetition'].includes(what)) out.repetition = await repetitionReport({home, generate});
if (['all', 'relationship'].includes(what)) out.relationship = await relationshipReport({home, generate});
if (['all', 'contacts'].includes(what)) out.contacts = contactsReport(home);
if (what === 'priorities') out.priorities = await prioritiesReport({home, generate, review: generate && independentReviewStatus().configured ? (system, schema, input, options = {}) => terraReview(system, schema, input, config, options) : null});
if (['all', 'writeback'].includes(what)) out.writeback = await writebackReport({home, generate});
if (['all', 'trends'].includes(what)) out.trends = await trendsReport({home, generate});
if (flags.has('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
if (out.repetition) {
  console.log('\n## 跨天重复度（日记 ' + out.repetition.total + ' 篇）');
  for (const w of out.repetition.weeks) { console.log('\n' + w.week + ' 这周 · ' + w.diaries + ' 篇' + (w.skipped ? '（' + w.skipped + '）' : '') + (w.summary ? '\n  ' + w.summary : '')); for (const t of w.themes) console.log('  - ' + t.name + ' · ' + t.relationText + ' · ' + t.diaryIds.length + ' 篇：' + t.note); }
}
if (out.relationship) {
  const r = out.relationship, section = (name, rows) => { if (rows.length) { console.log('\n' + name); for (const x of rows) console.log('  - ' + (x.when ? x.when + ' ' : '') + x.text + '  [' + x.evidenceIds.join('、') + ']'); } };
  console.log('\n## 关系账本（记录 ' + r.records + ' 条：' + Object.entries(r.bySource).map(([k, v]) => k + ' ' + v).join('、') + '）' + (r.skipped ? '\n' + r.skipped : ''));
  if (r.ledger) { if (r.ledger.stage) console.log('\n现在：' + r.ledger.stage.summary + '  [' + r.ledger.stage.evidenceIds.join('、') + ']'); section('节点', r.ledger.milestones); section('还没解开的', r.ledger.openConflicts); section('还没兑现的', r.ledger.openPromises); if (r.ledger.unknowns.length) console.log('\n看不出来的：' + r.ledger.unknowns.join('；')); }
}
if (out.contacts) { const c = out.contacts; console.log('\n## 主动联系结果\n发出 ' + c.sent + ' 次，收到来信 ' + c.answered + ' 次' + (c.medianMinutes !== null ? '，回应用时中位 ' + c.medianMinutes + ' 分钟' : '') + '\n' + Object.entries(c.kinds).map(([k, v]) => '  - ' + k + '：' + v).join('\n') + '\n' + c.note); }
if (out.writeback) {
  const {funnel: f, audit, sampled, skipped} = out.writeback;
  console.log('\n## 写回漏斗\n来源 ' + f.sources.total + ' 条（' + Object.entries(f.sources.byState).map(([k, v]) => k + ' ' + v).join('、') + '）。已审核 ' + f.review.reviewed + ' 条，提出 ' + f.review.proposed + ' 项，通过 ' + f.review.accepted + ' 项，' + f.review.withNothingKept + ' 条什么也没记。事实 ' + f.facts.total + ' 项。' + f.sources.retainedNote);
  if (f.knowledge) console.log('知识层：来源 ' + f.knowledge.sources + ' 条，条目 ' + f.knowledge.items + ' 项，判定无关 ' + f.knowledge.ignored + ' 条。');
  if (audit) { console.log('抽查 ' + sampled + ' 条：' + audit.withMisses + ' 条有漏，明显该记 ' + audit.high + ' 项，可记可不记 ' + audit.medium + ' 项。\n' + audit.summary); for (const i of audit.items) for (const m of i.missed) console.log('  - [' + m.levelText + '] ' + m.point + '：' + m.why); } else if (skipped) console.log('漏记抽查：' + skipped);
}
if (out.trends) {
  const {usage, mood} = out.trends;
  console.log('\n## 心情走向（记录 ' + mood.records + ' 条）' + (mood.skipped ? '\n' + mood.skipped : '\n' + mood.summary));
  for (const s of mood.strands || []) console.log('  - ' + s.name + ' · ' + s.courseText + ' · ' + s.times + ' 次，跨 ' + s.spanDays + ' 天（' + s.from + ' 到 ' + s.to + '）：' + s.note);
  console.log('\n## 使用趋势（消息 ' + usage.messages + ' 条）');
  for (const w of usage.weeks) console.log('  ' + w.week + ' 这周：' + w.messages + ' 条，' + w.activeDays + ' 天，约 ' + w.minutes + ' 分钟，深夜占比 ' + Math.round(w.lateNightShare * 100) + '%');
  console.log(usage.note);
}
if (out.priorities) {
  const p = out.priorities;
  console.log('\n## 下一步优先级');
  if (p.skipped) console.log(p.skipped);
  else { console.log(p.summary + (p.reviewed === false ? '\n' + p.note : '')); p.items.forEach((i, n) => console.log('  ' + (n + 1) + '. ' + i.title + '（' + i.effort + '）：' + i.why + ' 依据：' + i.evidence)); for (const i of p.rejected) console.log('  复核没通过：' + i.title + '：' + i.note); }
}
