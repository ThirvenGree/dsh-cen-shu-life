// 2026-11-06：长期知识协调与质量治理 —— 三个模块共用的数据结构与工具。
// 设计参考：Zep/Graphiti 的双时间轴与“失效不删除”；Mem0 的“由模型判断新增/更新/删除/无变化”；
// A-MEM 的“先相似度取候选，再由模型决定关联”；MemoryOS 的热度（只用于活跃度）；Letta 的后台整理；
// LongMemEval 的五类能力（提取、跨会话、时间、知识更新、拒答）。
// 原则：原始记忆仍在各插件里；这里只读它们、只写自己的索引与评估文件；任何模块失败都不影响聊天、不删记忆。
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const KINDS = ['interest', 'plan', 'experience', 'result', 'fact', 'preference', 'agreement', 'method', 'state', 'relationship'];
export const KIND_TEXT = {interest: '兴趣意向', plan: '打算', experience: '经历', result: '结果', fact: '事实', preference: '偏好', agreement: '约定', method: '方法', state: '当前状态', relationship: '关系'};
export const STAGES = ['intended', 'in-progress', 'done', 'abandoned', 'ongoing', 'n/a'];
export const STAGE_TEXT = {intended: '想做', 'in-progress': '在做', done: '已做完', abandoned: '放弃了', ongoing: '持续中', 'n/a': ''};
export const CHANGES = ['formed', 'changed', 'coexisting', 'uncertain', 'withdrawn']; // 沿用 inner-life 的变化模型
export const RELATIONS = ['new', 'duplicate', 'progress', 'contradiction', 'irrelevant'];
export const LEVELS = ['low', 'medium', 'high', 'core'];
export const CLASSES = ['stable', 'experience', 'situational', 'method'];
export const CLASS_TEXT = {stable: '稳定事实与约定', experience: '普通经历与临时兴趣', situational: '当前活动、待办与情境', method: '验证过的方法'};

export const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const shortId = p => p + ':' + randomUUID().slice(0, 12);
export const sid = x => String(x || '').replace(/^session-/, '');

const WEEK = {Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日'};
export function bjText(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'}).formatToParts(new Date(Number(ms))).map(x => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ' ' + (WEEK[p.weekday] || p.weekday) + '（北京时间）';
}
/** When a source's content happened; 0 when no time is known. Decides which of two statements is the later one. */
export const timeOf = s => Number(s?.eventAt) || Number(s?.learnedAt) || 0;
export const toMs = v => { const n = Number(v); if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : n; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

export function dir(home) { return path.join(home, 'cen-shu-life', 'knowledge'); }
export function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = file + '.' + process.pid + '.' + randomUUID().slice(0, 6) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file);
}
export const secret = s => /AIza[\w-]{10}|sk-[\w-]{12}|gh[pous]_[\w]{10}|密码\s*[:：]|令牌\s*[:：]|API.?key\s*[:：]/i.test(String(s));
export const safeText = (s, n) => typeof s === 'string' && s.trim().length > 0 && s.length <= n && !secret(s) && !/<script/i.test(s);

// 中文友好的粗略相似度（字二元组的重叠系数，去掉每条都会出现的常见词），只用来挑候选，最终判断交给 Gemini。
// 用重叠系数而不是 Jaccard：同一件事换种说法时，往往只共享一两个关键词（例如“摄影”），Jaccard 会被长句稀释。
const STOP = new Set(['岑舒', '青枔', '枔来', '来信', '信：', '舒的', '舒在', '舒说', '一个', '有点', '觉得', '这个', '那个', '还是', '已经', '今天', '时候', '自己', '没有', '什么', '一下', '可以', '因为', '所以', '但是', '就是', '的时', '了一', '着，', '。岑', '，岑']);
function grams(text) { const t = String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) { const x = t.slice(i, i + 2); if (!STOP.has(x)) g.add(x); } if (t.length === 1) g.add(t); return g; }
export function similarity(a, b) { const A = grams(a), B = grams(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.min(A.size, B.size); }

// 统一错误退避：暂停（未发请求）按暂停到期；计费/鉴权 30 分钟；其他从 1 分钟起翻倍到 30 分钟。
export function backoff(error, failures, now = Date.now()) {
  if (error?.paused) return Math.max(now + 60000, Number(error.retryAt) || now + 60000);
  if ([401, 402, 403].includes(Number(error?.httpStatus))) return now + 30 * 60000;
  return now + Math.min(30, 2 ** Math.max(0, (failures || 1) - 1)) * 60000;
}
export const cleanError = e => String(e?.message || e).replace(/AIza[\w-]+|sk-[\w-]+/g, '[隐藏]').slice(0, 240);
