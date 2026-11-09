// 2026-11-08：哪些上下文固定，哪些交给 Gemini。一律按段落的名字（key）认，不看优先级数字或文字开头。
// 固定：工作会话里的时间日程、心情、进行中和刚结束的事、打算、她自己选的活动；工具联动在所有会话固定（生活插件里本来就是必留）；
//       工作做法在抖音、B站、浏览器的工作会话固定；QQ 表达规则只在 QQ 聊天会话固定。
// 其余（内在状态、想法、兴趣、性格发展、其他会话里的做法和 QQ 表达规则等）作为候选，由 Gemini 按当前情况判断要不要、谁优先。
const PINNED = new Set(['life:current', 'mood:current', 'life:ended', 'life:intentions', 'agency:current']);
const isPinned = part => PINNED.has(part.key) || String(part.key || '').startsWith('life:event:');
export function shapeWorkParts(parts) { return (Array.isArray(parts) ? parts : []).map(part => isPinned(part) ? { ...part, required: true } : part); }
export function pinQqStyle(parts, isQq) { return (Array.isArray(parts) ? parts : []).map(part => isQq && part.key === 'life:style' ? { ...part, required: true } : part); }
// 2026-11-08：人设提示里这些段落只说 QQ 上怎么做。工作会话的系统提示里不再固定，改成候选，由 Gemini 判断；其他段落一律不动。
const QQ_ONLY_HEADERS = ['【QQ 空间发布联动】', '【QQ 自主表达与发送】'];
const NEXT_BLOCK = /\n(?=#{1,3} |<[a-z_-]+[ >]|【)/g;
export function splitQqOnlyBlocks(assembly) {
  const removed = [];
  if (!Array.isArray(assembly?.sections)) return { assembly, removed };
  const sections = assembly.sections.map(section => {
    if (typeof section?.text !== 'string') return section;
    let text = section.text;
    for (const header of QQ_ONLY_HEADERS) {
      const at = text.startsWith(header) ? 0 : text.indexOf('\n' + header) + 1;
      if (at === 0 && !text.startsWith(header)) continue;
      NEXT_BLOCK.lastIndex = at + header.length;
      const next = NEXT_BLOCK.exec(text), end = next ? next.index + 1 : text.length;
      removed.push({ key: 'qq:' + header.slice(1, -1), owner: 'life', priority: 20, text: text.slice(at, end).trim() });
      text = text.slice(0, at) + text.slice(end);
    }
    return text === section.text ? section : { ...section, text };
  });
  return removed.length ? { assembly: { ...assembly, sections }, removed } : { assembly, removed };
}
// 2026-11-09：她的会话里，DSH 自带的说明分三种处理（只改这一次拼接的结果，不改 DSH 和人设文件）：
//  1. 和人设冲突的直接不要：编程助手和 AI 代理的身份句、Agent Teams、DSH 开发说明，以及把青枔叫作“用户”的 DSH 说明。
//  2. 其余 DSH 使用说明（文件、命令行、后台任务、MCP 等）移出系统提示，变成候选，由 Gemini 按当前任务判断；放在请求末尾，选不选都不影响前面的缓存。
//  3. 网页内容不可信的提醒留在原处。
const DROP_SECTIONS = new Set(['harness:identity', 'team:policy', 'harness:source', 'app:web-surface']);
const DROP_CONTEXTS = new Set(['team:identity', 'harness:source', 'app:web-surface']);
const DROP_PARAGRAPHS = [/^You are an AI agent powered by/, /^You are a coding agent powered by/, /^Agent Teams is available/, /^The Team Lead and all teammates/, /^Prefer read\/edit\/write for file changes/, /^Use the target returned by spawn_teammate/, /^The runtime context names the DeepSeek/, /^You are interacting with the user through/];
// 这些是操作说明，只是把青枔叫作“用户”，所以不放进上下文；改掉称呼后留在 censhu_help 里查得到。
const MANUAL_PARAGRAPHS = [[/^当用户要创建定时任务/, 'automation'], [/^Tokens prefixed with @/, 'file-references'], [/^Only create or modify scheduled tasks/, 'schedule'], [/^Use the workflow tool ONLY/, 'workflow'], [/^Prefer showing the primary results/, 'output-format']];
const movable = name => /^(?:tool:|mcp:|mcp-resource-servers$|ui:|context:file-reference$|plan:policy$|deployment:browser-model-routing$)/.test(name) && !/^tool:web_(?:search|fetch)$/.test(name) && !/structured/i.test(name);
const OWN_CONTEXTS = new Set(['censhu-memory-policy', 'censhu-subagent-policy']);
// 只换指青枔的称呼；路径里的 Users、记录里的 [user] 不动。
// 2026-11-09：“用户”只有出现在句首或这些词后面时才算指青枔；“评论区用户”“普通用户”“用户名”这类说的是别人或别的东西，保持原样。
const READER_USER = /(?<=^|[^\p{Script=Han}A-Za-z0-9_]|当|向|让|给|若|由|被|请|帮|和|与|对|等|是|把|跟|为|替|供|仅|在|了|使|经|及|或|并|而|但|如果|除非|告诉|询问|提醒|要求|需要|只有|请求|征求|等待|提示|通知|确保|允许|当前)用户(?!名|协议|画像|数据|体验|界面|量|群|[iI][dD])/gu;
export const callHerName = text => String(text).replace(/\bthe user's\b/gi, '青枔的').replace(/\bthe user\b/gi, '青枔').replace(/(?<![\w\\/\[.-])user(?![\w\\/\].-])/g, '青枔').replace(READER_USER, '青枔');
/** 长期记忆、人物变化、独处内容和生活事件是记录原文，不改。 */
export const nameParts = parts => (Array.isArray(parts) ? parts : []).map(part => typeof part?.text === 'string' && !/^(?:fact:|knowledge:|memory:|diary:|inner:|life:event:|agency:)/.test(part.key || '') && !['inner', 'agency'].includes(part.owner) ? { ...part, text: callHerName(part.text) } : part);
function dropParagraphs(text, manual) {
  return text.split(/\n\n+/).filter(paragraph => {
    const clean = paragraph.trim(), found = MANUAL_PARAGRAPHS.find(([pattern]) => pattern.test(clean));
    if (found) { manual.push({ key: 'manual:' + found[1], text: callHerName(clean) }); return false; }
    return !DROP_PARAGRAPHS.some(pattern => pattern.test(clean));
  }).join('\n\n');
}
export function shapeHostPrompt(assembly, { keepBrowserRouting = false } = {}) {
  if (!assembly || typeof assembly !== 'object') return { assembly, parts: [], manual: [] };
  const parts = [], sections = [], manual = [];
  for (const section of Array.isArray(assembly.sections) ? assembly.sections : []) {
    if (DROP_SECTIONS.has(section?.name)) continue;
    if (typeof section?.text !== 'string') { sections.push(section); continue; }
    const text = callHerName(dropParagraphs(section.text, manual)).trim();
    if (!text) { if (section.text.trim()) continue; sections.push(section); continue; }
    const keep = keepBrowserRouting && section.name === 'deployment:browser-model-routing';
    if (movable(section.name) && !keep && !text.includes('{{')) { parts.push({ owner: 'work', source: 'host:' + section.name, key: 'host:' + section.name, priority: 30, text }); continue; }
    // 留在系统提示里的 DSH 说明，说明书里也放一份。
    if (/^tool:web_(?:search|fetch)$/.test(section.name) || keep) manual.push({ key: 'host:' + section.name, text });
    sections.push(text === section.text ? section : { ...section, text });
  }
  const contexts = (Array.isArray(assembly.contexts) ? assembly.contexts : []).filter(entry => !DROP_CONTEXTS.has(entry?.name)).map(entry => OWN_CONTEXTS.has(entry?.name) && typeof entry.text === 'string' ? { ...entry, text: callHerName(entry.text) } : entry);
  const same = (a, b) => !Array.isArray(a) ? b.length === 0 : a.length === b.length && a.every((entry, index) => entry === b[index]);
  const sameSections = same(assembly.sections, sections), sameContexts = same(assembly.contexts, contexts);
  if (sameSections && sameContexts) return { assembly, parts, manual };
  return { assembly: { ...assembly, ...(sameSections ? {} : { sections }), ...(sameContexts ? {} : { contexts }) }, parts, manual };
}
/** 后台暂停时说清楚，免得她把冻结的状态当成此刻。 */
export function backgroundPausedNote(recovery, formatTime = t => new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })) {
  if (!recovery?.pending) return '';
  const at = recovery.manualPause?.at || recovery.interruption?.pausedAt;
  return '【后台状态】后台运行暂停中' + (at ? '（自 ' + formatTime(at) + ' 起）' : '') + '：心情、进行中的事、内在状态和想法不会自动更新，下面这些可能是旧的，不要当成此刻的确切情况；工具和实际看到的内容不受影响。';
}
