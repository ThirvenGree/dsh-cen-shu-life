// 2026-11-09：censhu_help：遇到错误或不知道怎么做时查的只读说明书。工具、技能、MCP、子代理、DSH 使用说明和最近的报错都在这里。
// 只读：不调用模型、不写记录、不执行别的工具。load 只是让下一次请求带上这些工具的定义，和 censhu_tool_catalog 的 load 相同。
import {safeExcerpt} from './budget-tools.js';

const PAGE = 6000;
// 每类操作对应哪些说明和工具。说明只有这个会话真的有才会列出来。
export const OPERATIONS = Object.freeze({
  定时任务: {guides: ['manual:automation', 'manual:schedule', 'host:tool:schedule'], tools: /^(?:automation_|schedule_)/},
  目标: {guides: ['host:tool:goal'], tools: /^(?:create_goal|get_goal|update_goal)$/},
  workflow: {guides: ['manual:workflow', 'host:tool:ralph'], tools: /^(?:workflow|ralph)/},
  文件读写: {guides: ['host:tool:read', 'host:tool:write', 'host:tool:edit', 'host:tool:apply_patch', 'manual:file-references'], tools: /^(?:read|read_file|read_image|write|edit|apply_patch|list_directory)$/},
  搜索: {guides: ['host:tool:glob', 'host:tool:grep', 'host:tool:web_search', 'host:tool:web_fetch', 'host:tool:session-query'], tools: /^(?:glob|grep|web_search|web_fetch|search_context)$/},
  命令行: {guides: ['host:tool:pwsh', 'host:tool:bash', 'host:tool:pty'], tools: /^(?:pwsh|bash|terminal_)/},
  后台任务: {guides: ['host:tool:jobs'], tools: /^job_/},
  子代理: {guides: ['host:tool:subagent', 'host:tool:subagent_fork'], tools: /^(?:subagent|subagent_fork|censhu_parallel_decide)$/},
  MCP: {guides: ['host:mcp-resource-servers'], tools: /^(?:list_mcp_|read_mcp_|mcp__)/},
  输出和发送文件: {guides: ['manual:output-format'], tools: /^present$/},
});
const textOf = message => typeof message?.content === 'string' ? message.content : (Array.isArray(message?.content) ? message.content : []).filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
const callsOf = message => [...(Array.isArray(message?.content) ? message.content.filter(part => part?.type === 'tool-call') : []), ...(Array.isArray(message?.toolCalls) ? message.toolCalls : [])];
const page = (text, offset = 0) => { const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0; return {totalChars: text.length, offset: start, text: safeExcerpt(text.slice(start, start + PAGE), PAGE), nextOffset: start + PAGE < text.length ? start + PAGE : null}; };

export function recentFailures(messages, limit = 8) {
  const names = new Map(), rows = [];
  for (const message of Array.isArray(messages) ? messages : []) for (const call of callsOf(message)) names.set(call.id || call.callId, call.name || call.function?.name || '');
  for (const message of Array.isArray(messages) ? messages : []) if (message?.role === 'tool' && (message.isError === true || message.error)) rows.push({tool: message.name || names.get(message.toolCallId) || '', error: safeExcerpt(textOf(message) || String(message.error || ''), 500)});
  return rows.slice(-limit);
}

const LANE_NAMES = Object.freeze({'douyin-censhu-x': '抖音·刷视频', 'douyin-dm-x': '抖音·社交', 'douyin-revisit-x': '抖音·重看', 'bili-watch-x': 'B站·刷视频', 'bili-social-x': 'B站·社交', 'bili-revisit-x': 'B站·重看', 'browser-browse-x': '浏览器'});

export function createHelpTool({catalog, schemasFor = () => [], guidesFor = () => new Map(), subagentPolicy = '', platformGuides = () => [], docs = () => []} = {}) {
  /** 各工作会话的做法和平台命令表：[{name, text}]。读不到的跳过。 */
  const platforms = () => { let rows = []; try { rows = [...(platformGuides() || []).map(row => ({name: LANE_NAMES[row.lane] || row.lane, text: row.text})), ...(docs() || [])]; } catch {} return rows.filter(row => row && row.text); };
  const definition = (exec, name) => { let all = []; try { all = schemasFor(exec?.agent) || []; } catch {} const tool = all.find(item => item?.name === name); return tool ? {name: tool.name, description: safeExcerpt(tool.description || '', PAGE), parameters: tool.parameters} : null; };
  const allNames = exec => { try { return (schemasFor(exec?.agent) || []).map(item => item?.name).filter(Boolean); } catch { return []; } };
  const sessionOf = exec => exec?.agent?.session?.id || exec?.agent?.id;
  const guides = exec => guidesFor(sessionOf(exec)) || new Map();
  const callCatalog = (args, exec) => { if (!catalog) return {available: false, message: '工具目录暂时不可用。'}; const out = catalog.execute(args, exec); return typeof out === 'string' ? JSON.parse(out) : out; };
  const guideOf = (exec, key) => guides(exec).get(key) || null;
  const shortLine = text => String(text || '').replace(/\s+/g, ' ').slice(0, 200);
  function allSkills(exec) {
    const rows = [];
    for (let offset = 0, round = 0; offset !== null && round < 12; round++) {
      let out; try { out = callCatalog({action: 'catalog', target: 'skills', query: '', offset, limit: 40}, exec); } catch { break; }
      rows.push(...(Array.isArray(out?.entries) ? out.entries : [])); offset = Number.isSafeInteger(out?.nextOffset) ? out.nextOffset : null;
    }
    return rows;
  }
  /** 总的完整说明：所有操作的用法、工具、MCP、子代理、技能写在一份里，太长时用 offset 接着读。 */
  function fullManual(args, exec) {
    const list = guides(exec), names = allNames(exec), usedGuides = new Set(), usedTools = new Set(), lines = ['# 操作总说明', '', '遇到错误时先用 topic=errors 看最近失败的调用，再对照这里。这次请求没带的工具，用 topic=tools、names=[...]、load=true 载入，下一步就能调用；某个工具的完整参数用 topic=tools、name=工具名 查。'];
    for (const [operation, row] of Object.entries(OPERATIONS)) {
      lines.push('', '## ' + operation);
      for (const key of row.guides) if (list.has(key)) { usedGuides.add(key); lines.push(list.get(key)); }
      const tools = names.filter(tool => row.tools.test(tool)); tools.forEach(tool => usedTools.add(tool));
      const shown = operation === 'MCP' ? tools.filter(tool => !tool.startsWith('mcp__')) : tools;
      if (shown.length) lines.push('相关工具：', ...shown.map(tool => '- ' + tool + '：' + shortLine(definition(exec, tool)?.description)));
      if (!shown.length && !row.guides.some(key => list.has(key))) lines.push('这个会话目前没有这类操作的说明或工具。');
    }
    const platformRows = platforms();
    if (platformRows.length) { lines.push('', '## 抖音、B站、浏览器'); for (const row of platformRows) lines.push('### ' + row.name, row.text); }
    const others = [...list].filter(([key]) => !usedGuides.has(key));
    if (others.length) { lines.push('', '## 其他使用说明'); for (const [key, text] of others) lines.push('### ' + key.replace(/^(?:host|manual):/, ''), text); }
    const servers = {}; for (const tool of names) { const match = /^mcp__(.+?)__/.exec(tool); if (match) servers[match[1]] = (servers[match[1]] || 0) + 1; }
    if (Object.keys(servers).length) lines.push('', '## MCP 服务', ...Object.entries(servers).map(([server, count]) => '- ' + server + '：' + count + ' 个工具（mcp__' + server + '__工具名）'));
    if (subagentPolicy) lines.push('', '## 什么时候开子代理', subagentPolicy);
    const skills = allSkills(exec);
    if (skills.length) lines.push('', '## 技能（用 skill 工具加上名字加载全文）', ...skills.map(skill => '- ' + skill.name + '：' + shortLine(skill.description)));
    const rest = names.filter(tool => !usedTools.has(tool) && !tool.startsWith('mcp__'));
    if (rest.length) lines.push('', '## 其他工具（用 topic=tools、name=工具名 查用法）', rest.join('、'));
    return {topic: 'manual', ...page(lines.join('\n'), args.offset)};
  }
  const handlers = {
    manual: fullManual,
    overview: (_args, exec) => ({topics: {platforms: '抖音、B站、浏览器各个工作会话的做法，以及 B站 node bili.mjs 的全部命令。', operations: '按操作查：定时任务、目标、workflow、文件读写、搜索、命令行、后台任务、子代理、MCP、输出和发送文件。带 name 给出这类操作的全部说明和相关工具的参数。', tools: '查工具：按 query 搜索，或用 name 看某个工具的完整说明和参数。names + load:true 让下一次请求带上它们。', skills: '查技能目录，按 query 搜索；要全文用 skill(名字) 加载。', mcp: '查 MCP 服务和它们的工具。', subagents: '查怎么开子代理、什么时候开。', guide: '看 DSH 的使用说明（文件、命令行、后台任务、定时任务等），不带 name 列目录。', errors: '看这个会话最近失败的工具调用；带 name 同时给出那个工具的说明和参数。'}, note: '工具报错时先用 errors 或 tools(name=工具名) 对照参数，再决定重试、换做法还是停下。', tools: allNames(exec).length, guides: [...guides(exec).keys()]}),
    tools(args, exec) {
      if (args.load === true) return callCatalog({action: 'load', names: args.names}, exec);
      if (args.name) { const found = definition(exec, args.name); return found ? {...found, guide: guideOf(exec, 'host:tool:' + args.name), note: '这次请求没带这个工具时，用 names:["' + args.name + '"], load:true 载入，下一步就能调用。'} : {available: false, message: '没有这个工具：' + args.name}; }
      return callCatalog({action: 'catalog', query: args.query || '', offset: args.offset || 0, limit: args.limit || 20}, exec);
    },
    skills: (args, exec) => ({...callCatalog({action: 'catalog', target: 'skills', query: args.query || '', offset: args.offset || 0, limit: args.limit || 20}, exec), note: '要看某个技能的全文，用 skill 工具加上技能名字。'}),
    mcp(args, exec) {
      const servers = {}; for (const name of allNames(exec)) { const match = /^mcp__(.+?)__(.+)$/.exec(name); if (match) (servers[match[1]] ??= []).push(match[2]); }
      const list = guides(exec), instructions = Object.fromEntries([...list].filter(([key]) => key === 'host:mcp-resource-servers' || key.startsWith('host:mcp:')).map(([key, text]) => [key.replace(/^host:/, ''), safeExcerpt(text, 1500)]));
      return {servers: Object.fromEntries(Object.entries(servers).map(([server, tools]) => [server, {tools: tools.length, examples: tools.slice(0, 12)}])), instructions, note: '工具名是 mcp__服务名__工具名。用 tools(query=服务名) 搜索，再用 load 载入；读资源用 list_mcp_resources、read_mcp_resource。'};
    },
    subagents: (_args, exec) => ({policy: subagentPolicy, guide: guideOf(exec, 'host:tool:subagent'), tools: ['subagent', 'subagent_fork', 'censhu_parallel_decide'].map(name => definition(exec, name)).filter(Boolean), note: '这次请求没带 subagent 时，先用 tools(names=["subagent"], load=true) 载入。'}),
    operations(args, exec) {
      const list = guides(exec), names = allNames(exec);
      if (!args.name) return {items: Object.entries(OPERATIONS).map(([name, row]) => ({name, guides: row.guides.filter(key => list.has(key)).length, tools: names.filter(tool => row.tools.test(tool)).length})), note: '带 name 看这类操作怎么用。'};
      const row = OPERATIONS[args.name];
      if (!row) return {available: false, message: '没有这类操作：' + args.name + '。可选：' + Object.keys(OPERATIONS).join('、')};
      const matched = names.filter(tool => row.tools.test(tool)), start = Number.isSafeInteger(args.offset) && args.offset > 0 ? args.offset : 0, limit = args.limit || 20;
      return {operation: args.name, guides: Object.fromEntries(row.guides.filter(key => list.has(key)).map(key => [key, safeExcerpt(list.get(key), PAGE)])), tools: matched.slice(start, start + limit).map(tool => definition(exec, tool)), totalTools: matched.length, nextOffset: start + limit < matched.length ? start + limit : null, note: '这次请求没带的工具，用 tools(names=[...], load=true) 载入，下一步就能调用。'};
    },
    platforms(args) {
      const rows = platforms();
      if (!args.name) return {items: rows.map(row => ({name: row.name, chars: row.text.length})), note: '带 name 读全文。'};
      const row = rows.find(item => item.name === args.name) || rows.find(item => item.name.includes(args.name));
      return row ? {name: row.name, ...page(row.text, args.offset)} : {available: false, message: '没有这一项：' + args.name + '。可选：' + rows.map(item => item.name).join('、')};
    },
    guide(args, exec) {
      const list = guides(exec);
      if (!args.name) return {items: [...list].map(([key, text]) => ({name: key, chars: text.length})), note: '带 name 读全文。'};
      const text = list.get(args.name) ?? list.get('host:' + args.name) ?? list.get('manual:' + args.name);
      return typeof text === 'string' ? {name: args.name, ...page(text, args.offset)} : {available: false, message: '没有这份说明：' + args.name};
    },
    errors(args, exec) {
      let messages = []; try { messages = exec?.agent?.session?.deriveMessages?.() || []; } catch {}
      const failures = recentFailures(messages, Math.min(20, Math.max(1, Number.isSafeInteger(args.limit) ? args.limit : 8)));
      return {failures, tool: args.name ? definition(exec, args.name) : null, note: failures.length ? '对照错误和参数说明改一下再试；同样的错误连续出现时换做法或停下说明。' : '这个会话最近没有失败的工具调用。'};
    }
  };
  return {
    name: 'censhu_help',
    description: '遇到错误、不知道某件事怎么做、或想知道有哪些工具、技能、MCP、子代理可用时先查这里。定时任务、目标（goal）、workflow、文件读写、搜索、命令行、后台任务这些操作，以及抖音、B站、浏览器的做法都查得到。不带 topic 时给出总的完整说明，太长时用 offset 接着读。topic：manual 总的完整说明；overview 目录；operations 按操作查说明和工具参数；platforms 抖音、B站、浏览器的做法和 B站命令；tools 查工具和参数，也能载入这次没带的工具；skills 查技能；mcp 查 MCP 服务；subagents 查子代理；guide 看 DSH 使用说明；errors 看最近失败的调用。只读，不调用模型，不执行其他工具。',
    parameters: {type: 'object', additionalProperties: false, properties: {topic: {type: 'string', enum: Object.keys(handlers)}, query: {type: 'string', maxLength: 600, description: '搜索词，tools 和 skills 用'}, name: {type: 'string', maxLength: 200, description: '工具名或说明名'}, names: {type: 'array', maxItems: 32, items: {type: 'string'}, description: '要载入的工具名，配合 load:true'}, load: {type: 'boolean'}, offset: {type: 'integer', minimum: 0}, limit: {type: 'integer', minimum: 1, maximum: 40}}},
    output: {schema: {type: 'string'}, render: (_args, value) => [{type: 'text', text: value}]},
    execute(args, exec) {
      const handler = handlers[args?.topic || 'manual'];
      if (!handler) throw Error('topic 只能是：' + Object.keys(handlers).join('、'));
      return JSON.stringify(handler(args, exec));
    }
  };
}
