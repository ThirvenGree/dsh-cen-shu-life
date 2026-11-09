// 只读适配层：把各记忆库与生活资料读成统一的“来源引用”。只读，不写任何原库。
// 每个适配器独立 try/catch：一个库读不了，只记录状态，不影响其他库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sha, sid, toMs, readJson} from './common.js';

const MAX_PER_STORE = 300;
// 2026-11-09: partial = this read stopped at its limit; rolling = the row comes from a log that drops old entries.
// In both cases a record that is no longer listed has not been deleted.
const partial = (rows, cut) => { rows.partial = cut; return rows; };
const clip = (s, n = 600) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// 2026-11-09: reviewed writebacks end with a source tag holding their times. Prefer when the message arrived, then when it was reviewed.
const ISO = '(\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z)', ARRIVED = new RegExp('来信于' + ISO), REVIEWED = new RegExp('Gemini审核；' + ISO);
// 2026-11-09: the mood line written with a memory is kept beside the text, so a passing mood does not steer matching.
const FEELING = /\s*\[当时的感受（只是她当时的心情，不是事实）：([^\]]*)\]?\s*$/;
export function splitFeeling(text) { const raw = String(text || ''), m = FEELING.exec(raw); return m ? {text: raw.slice(0, m.index).trim(), feeling: m[1].trim()} : {text: raw, feeling: ''}; }
const refTime = text => { const m = ARRIVED.exec(text) || REVIEWED.exec(text); return m ? toMs(m[1]) : null; };

function originOf(sessionId, ids) {
  const s = sid(sessionId);
  if (!s) return 'unknown';
  if (ids.has(s)) return 'her-session';
  if (/^dsh-automation/.test(s)) return 'automation';
  return 'other-session';
}

function walk(root, test, out = [], depth = 0) {
  if (depth > 8 || !fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, {withFileTypes: true})) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walk(p, test, out, depth + 1); else if (test(p, e.name)) out.push(p);
  }
  return out;
}

async function sqliteRows(file, sql) {
  const {DatabaseSync} = await import('node:sqlite');
  const db = new DatabaseSync(file, {readOnly: true});
  try { return db.prepare(sql).all(); } finally { try { db.close(); } catch {} }
}

export function adapters({home, homedir = os.homedir(), sessionIds = [], openvikingRoot} = {}) {
  const ids = new Set(sessionIds.map(sid));
  return {
    // engram：共享用户空间里仍有效的条目（项目空间按工作区分库，与岑舒无固定对应，不纳入）
    async engram() {
      const file = path.join(home, 'engram', 'user.db');
      if (!fs.existsSync(file)) return [];
      const rows = await sqliteRows(file, "select id,kind,content,created_at,source_session_id from nodes where scope='user' and status='active' order by created_at desc limit " + MAX_PER_STORE);
      return partial(rows.map(r => ({store: 'engram', recordId: r.id, scope: 'user', text: clip(r.content), sessionId: r.source_session_id || null, origin: originOf(r.source_session_id, ids), reviewed: /\[来源：.*Gemini审核/.test(r.content), visibility: 'shared', eventAt: refTime(r.content) || toMs(r.created_at), learnedAt: toMs(r.created_at), meta: {kind: r.kind}})), rows.length >= MAX_PER_STORE);
    },
    // 灵枢：认知图 md 节点（跳过受保护历史、回收站、被拒绝的）
    async lingshu() {
      const root = path.join(home, '.dsh-memory', 'data', 'mdcg');
      const files = walk(root, (p, n) => n.endsWith('.md') && !/[\\/](_protected_history|trash|rejected)[\\/]/.test(p)).slice(0, MAX_PER_STORE * 2);
      const out = [];
      for (const f of files) {
        const raw = fs.readFileSync(f, 'utf8'), m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw.replace(/\r\n/g, '\n'));
        const front = m ? m[1] : '', body = clip(m ? m[2] : raw);
        if (!body) continue;
        const id = /^id:\s*"?([^"\n]+)"?/m.exec(front)?.[1] || path.basename(f, '.md');
        const created = /^created_at:\s*([\d.]+)/m.exec(front)?.[1];
        out.push({store: 'lingshu', recordId: id, scope: path.relative(root, path.dirname(f)) || '.', text: body, sessionId: null, origin: 'unknown', reviewed: /verified-user-memory|censhu/.test(raw), visibility: 'shared', eventAt: refTime(raw) || toMs(created), learnedAt: toMs(created)});
      }
      return partial(out.slice(0, MAX_PER_STORE), out.length > MAX_PER_STORE || files.length >= MAX_PER_STORE * 2);
    },
    // mnemon：长期洞见与运行时记忆
    async mnemon() {
      const root = path.join(homedir, '.mnemon'), out = [];
      const db = path.join(root, 'data', 'default', 'mnemon.db');
      if (fs.existsSync(db)) for (const r of await sqliteRows(db, 'select id,content,created_at,source from insights order by created_at desc limit ' + MAX_PER_STORE)) out.push({store: 'mnemon', recordId: String(r.id), scope: 'insight', text: clip(r.content), sessionId: null, origin: 'unknown', reviewed: /Gemini审核/.test(r.content || ''), visibility: 'shared', eventAt: refTime(r.content) || toMs(r.created_at), learnedAt: toMs(r.created_at)});
      const cut = out.length >= MAX_PER_STORE;
      for (const e of readJson(path.join(root, 'runtime', 'memories.json'), {entries: []}).entries || []) {
        const text = typeof e === 'string' ? e : e?.content || e?.text;
        if (text) out.push({store: 'mnemon', recordId: 'runtime:' + sha(text).slice(0, 16), scope: 'runtime', text: clip(text), sessionId: null, origin: 'unknown', reviewed: /Gemini审核/.test(text), visibility: 'shared', eventAt: refTime(text) || toMs(e?.at), learnedAt: toMs(e?.at)});
      }
      return partial(out, cut);
    },
    // OpenViking：服务端保存的记忆文件（只读文件，不调服务）
    async openviking() {
      const root = openvikingRoot;
      if (!root || !fs.existsSync(root)) return [];
      const files = walk(root, (p, n) => n.endsWith('.md') && /[\\/]memories[\\/]/.test(p)).slice(0, MAX_PER_STORE);
      return partial(files.map(f => {
        const raw = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        return {store: 'openviking', recordId: path.relative(root, f).replace(/\\/g, '/'), scope: 'memories', text: clip(raw), sessionId: null, origin: 'unknown', reviewed: false, visibility: 'shared', eventAt: refTime(raw), learnedAt: fs.statSync(f).mtimeMs};
      }).filter(x => x.text), files.length >= MAX_PER_STORE);
    },
    // memory-evolve：长期记忆与各项目关键记忆（按条目拆开；不读每日日志，那是自动化工作记录）
    async memoryEvolve() {
      const root = path.join(home, 'memories'), files = [path.join(root, 'MEMORY.md'), path.join(root, 'USER.md'), ...walk(path.join(root, 'projects'), (p, n) => n === 'MEMORY.md' || n === 'KEY.md')];
      const out = [];
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, 'utf8');
        const parts = text.split(/\s*§\s*|\n(?=\[\d{4}-\d{2}-\d{2})/).map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
          const at = /^\[(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\]/.exec(p);
          out.push({store: 'memory-evolve', recordId: path.relative(root, f).replace(/\\/g, '/') + '#' + sha(p).slice(0, 16), scope: path.relative(root, path.dirname(f)).replace(/\\/g, '/') || '.', text: clip(p), sessionId: null, origin: 'unknown', reviewed: /Gemini审核/.test(p), visibility: 'shared', eventAt: refTime(p) || (at ? Date.parse(at[1] + 'T' + (at[2] || '00:00') + ':00+08:00') : null), learnedAt: at ? Date.parse(at[1] + 'T' + (at[2] || '00:00') + ':00+08:00') : null});
        }
      }
      return partial(out.slice(-MAX_PER_STORE), out.length > MAX_PER_STORE);
    },
    // 生活：审核后写回的事实、生活事件、观看感受、自主行动经历、青枔来信、生活打算
    async life() {
      const dirLife = path.join(home, 'cen-shu-life'), out = [];
      for (const f of readJson(path.join(dirLife, 'memory-writeback.json'), {facts: []}).facts || []) out.push({store: 'life', recordId: 'fact:' + f.id, scope: 'writeback', text: clip(f.text), sessionId: f.sessionId, origin: f.origin === 'character-life' ? 'her-life' : originOf(f.sessionId, ids), reviewed: true, visibility: 'shared', eventAt: f.messageAt || f.at, learnedAt: f.at, rolling: true, ...(f.feeling ? {feeling: f.feeling} : {}), ...(f.stance ? {stance: f.stance} : {})});
      const changes = readJson(path.join(dirLife, 'life-changes.json'), {items: []}).items || [];
      for (const x of changes.slice(-MAX_PER_STORE * 2)) {
        const d = x.data || {};
        if (x.kind === 'conversation') {
          const text = clip(d.text, 400);
          if (text.replace(/\[(图片|表情|语音)[^\]]*\]/g, '').trim().length < 4) continue;
          out.push({store: 'life', recordId: x.id, scope: 'conversation', text: '青枔来信：' + text, sessionId: d.sessionId, origin: originOf(d.sessionId, ids), reviewed: false, visibility: 'shared', eventAt: x.at, learnedAt: x.at, rolling: true});
        } else if (x.kind === 'event-start' || x.kind === 'event-end') {
          out.push({store: 'life', recordId: x.id, scope: 'life-event', text: '岑舒的生活' + (x.kind === 'event-end' ? '（已结束）' : '') + '：' + clip((d.name ? d.name + '——' : '') + (d.stageText || d.reason || ''), 400), sessionId: null, origin: 'her-life', reviewed: false, visibility: 'shared', eventAt: x.at, learnedAt: x.at, rolling: true});
        } else if (x.kind === 'bili-watch' || x.kind === 'douyin-watch') {
          out.push({store: 'life', recordId: x.id, scope: x.kind, text: '岑舒' + (x.kind === 'bili-watch' ? '看B站' : '刷抖音') + '后的感受：' + clip(d.reflection, 400), sessionId: null, origin: 'her-life', reviewed: false, visibility: 'shared', eventAt: x.at, learnedAt: x.at, rolling: true});
        } else if (x.kind === 'social-interaction') {
          let s = {}; try { s = JSON.parse(d.stageText || '{}'); } catch {}
          // 2026-11-09: the record itself says whether it is private; third-party messages must not become shared knowledge.
          const priv = d.private === true || /自己的|私人|不公开/.test(String(s.privacy || ''));
          out.push({store: 'life', recordId: x.id, scope: 'social', text: clip((s.summary || d.name || '') + (s.reflection ? ' 感受：' + s.reflection : ''), 500), sessionId: null, origin: 'her-life', reviewed: false, visibility: priv ? 'private' : 'shared', eventAt: toMs(s.observedAt) || x.at, learnedAt: x.at, rolling: true});
        }
      }
      const plan = readJson(path.join(dirLife, 'rhythm.json'), {}).plan || {};
      for (const i of plan.lifeIntentions || []) if (i?.text) out.push({store: 'life', recordId: 'intention:' + (i.id || sha(i.text).slice(0, 16)), scope: 'intention', text: '岑舒的打算：' + clip(i.text, 300), sessionId: null, origin: 'her-life', reviewed: false, visibility: 'shared', eventAt: toMs(i.at), learnedAt: toMs(i.at) || toMs(plan.at)});
      return out;
    },
    // 私人生活：日记与想法（私人，只在私人生活会话里可见，不进入 QQ / 桌面聊天）
    async innerLife() {
      const root = path.join(home, 'censhu-inner-life'), out = [];
      for (const t of readJson(path.join(root, 'thoughts.json'), {items: []}).items || []) out.push({store: 'inner-life', recordId: 'thought:' + t.id, scope: 'thought', text: clip((t.subject ? t.subject + '：' : '') + (t.summary || '')), sessionId: null, origin: 'her-life', reviewed: true, visibility: 'private', eventAt: null, learnedAt: t.updatedAt});
      for (const e of (readJson(path.join(root, 'state.json'), {entries: []}).entries || []).filter(e => !e.rejected && !e.supersededAt).slice(-MAX_PER_STORE)) out.push({store: 'inner-life', recordId: 'diary:' + e.id, scope: 'diary', text: clip('日记：' + (e.feeling || '') + (e.reflection ? ' 想法：' + e.reflection : '') + (e.intention ? ' 打算：' + e.intention : ''), 700), sessionId: null, origin: 'her-life', reviewed: Boolean(e.reviewedAt), visibility: 'private', eventAt: e.at, learnedAt: e.at, rolling: true});
      return out;
    },
    // 主动进行：她在独处里自己选择的活动与念头、每次主动回合的处境与结果、还挂念的打算。
    // 生活插件本来就把当前活动与念头放进她的会话上下文，所以按共享处理；工具调用、报错、等待、恢复这类运行记录不读。
    async agency() {
      const root = path.join(home, 'censhu-agency'), out = [];
      const st = readJson(path.join(root, 'state.json'), {history: [], notes: []});
      const NOISE = /^(调用工具|工具返回|工具报错|想发 · 工具报错|发送已调用|下次考虑|上次行动记录|按生活节奏)|^(生活有变化|心情、兴趣或打算发生变化)$/;
      for (const h of (st.history || []).slice(-MAX_PER_STORE * 2)) {
        if (!['本次处境与结果', '岑舒的选择或总结', '自主活动'].includes(h.type)) continue;
        const detail = String(h.detail || '');
        if (/尚未形成选择/.test(detail)) continue;
        const text = detail.split('\n').map(s => s.trim()).filter(s => s && !NOISE.test(s)).join('；');
        if (text.replace(/[；\s]/g, '').length < 6) continue;
        out.push({store: 'agency', recordId: 'timeline:' + (h.timelineId || sha(h.type + h.at + detail).slice(0, 16)), scope: h.type === '本次处境与结果' ? 'outcome' : 'choice', text: clip('岑舒独处时' + (h.type === '本次处境与结果' ? '的处境与结果：' : '的选择：') + text, 500), sessionId: h.sessionId || null, origin: 'her-life', reviewed: false, visibility: 'shared', eventAt: toMs(h.at), learnedAt: toMs(h.at), rolling: true});
      }
      const cur = readJson(path.join(root, 'current.json'), null);
      if (cur?.activity) out.push({store: 'agency', recordId: 'current:' + (cur.run || sha(cur.activity).slice(0, 16)), scope: 'current', text: clip('岑舒自己选择的活动：' + cur.activity + (cur.judgment ? '；当时的判断：' + cur.judgment : '') + (cur.thought ? '；念头：' + cur.thought : ''), 500), sessionId: cur.sessionId || null, origin: 'her-life', reviewed: false, visibility: 'shared', eventAt: toMs(cur.at), learnedAt: toMs(cur.at)});
      for (const n of st.notes || []) if (n?.text) out.push({store: 'agency', recordId: 'note:' + (n.id || sha(n.text).slice(0, 16)), scope: 'note', text: clip('岑舒还挂念的打算：' + n.text + (n.cancelWhen ? '（可能放下的条件：' + n.cancelWhen + '）' : ''), 400), sessionId: n.sessionId || null, origin: 'her-life', reviewed: false, visibility: 'shared', eventAt: toMs(n.at || n.createdAt), learnedAt: toMs(n.at || n.createdAt)});
      return out;
    },
    // 心情慢层：Gemini 判断的长期累积感受
    async mood() {
      const s = readJson(path.join(home, 'feiyu-mood', 'state.json'), {moods: {}}).moods?.censhu;
      return (s?.undertone?.accumulation || []).map(a => ({store: 'mood', recordId: 'accumulation:' + a.id, scope: 'accumulation', text: clip(a.name + '（对' + a.toward + '）：' + a.summary), sessionId: null, origin: 'her-life', reviewed: true, visibility: 'shared', eventAt: a.since || null, learnedAt: a.since}));
    },
  };
}

/** Read every store. Returns {sources, status}; a store that fails is reported, never fatal. */
export async function collectSources(options) {
  const list = adapters(options), sources = [], status = {};
  for (const [name, read] of Object.entries(list)) {
    if (options?.stores && options.stores[name] === false) { status[name] = {ok: false, disabled: true, count: 0}; continue; } // 设置里关掉的库：不读取，也不把它的旧来源标成消失
    const started = Date.now();
    try {
      const rows = await read();
      for (const r of rows) {
        const split = splitFeeling(r.text);
        if (!split.text) continue;
        const key = r.store + ':' + r.recordId;
        sources.push({...r, text: split.text, ...(split.feeling && !r.feeling ? {feeling: split.feeling} : {}), key, hash: sha(split.text)});
      }
      status[name] = {ok: true, count: rows.length, ms: Date.now() - started, partial: rows.partial === true};
    } catch (e) { status[name] = {ok: false, error: String(e?.message || e).slice(0, 200), ms: Date.now() - started}; }
  }
  return {sources, status};
}
