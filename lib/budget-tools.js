// 2026-11-08：预算规划（Gemini）可以调用的只读工具：看候选资料全文、看这个回合刚做了什么、看她此刻的全部状态。
// 全部只读：不调用模型、不写记录、不发送任何东西。返回内容都经过 safeExcerpt，隐去密钥形式的文字。
export const safeExcerpt = (value, max) => String(value ?? '').slice(0, max).replace(/(?:sk-[\w-]{12,}|AIza[\w-]{15,}|Bearer\s+\S+|(?:token|password|api[_-]?key|令牌|密码)\s*[:=：]\s*\S+)/gi, '[隐去]');

const textOf = message => typeof message?.content === 'string' ? message.content : (Array.isArray(message?.content) ? message.content : []).filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
const callsOf = message => [...(Array.isArray(message?.content) ? message.content.filter(part => part?.type === 'tool-call') : []), ...(Array.isArray(message?.toolCalls) ? message.toolCalls : [])];
const callName = call => call?.name || call?.function?.name || '';
const callId = call => call?.id || call?.callId;
// 这些是注入的资料和提醒，不是这个回合实际发生的事。
const NOT_ACTIVITY = new Set(['runtime-context', 'skill-catalog', 'time-context', 'tool-registry', 'system-reminder', 'repeat-tool-reminder', 'plugin:dsh-engram', 'dsh-mnemon', 'plugin:openviking-memory']);

export function recentActivity(messages, limit = 8) {
  const names = new Map(), rows = [], list = Array.isArray(messages) ? messages : [];
  for (const message of list) for (const call of callsOf(message)) names.set(callId(call), callName(call));
  for (let index = list.length - 1; index >= 0 && rows.length < limit; index--) {
    const message = list[index];
    if (!message || message.role === 'system' || message.role === 'developer' || NOT_ACTIVITY.has(message.source?.kind)) continue;
    if (message.role === 'assistant') rows.unshift({ role: 'assistant', text: safeExcerpt(textOf(message), 300), calls: callsOf(message).map(callName).filter(Boolean) });
    else if (message.role === 'tool') rows.unshift({ role: 'tool', name: message.name || names.get(message.toolCallId) || '', isError: message.isError === true, text: safeExcerpt(textOf(message), 400), media: Array.isArray(message.content) ? message.content.filter(part => part?.type && part.type !== 'text').length : 0 });
    else if (message.role === 'user') rows.unshift({ role: 'user', source: message.source?.kind || 'user', text: safeExcerpt(textOf(message), 400) });
  }
  return rows;
}

const PAGE = 4000;
export function budgetReadTools({ rows = [], messages = [], readState = () => null } = {}) {
  return [
    {
      name: 'read_candidate',
      description: '读取一条候选资料的正文。candidates 里只有前 100 字，光看摘录判断不了要不要放时再读。',
      parameters: { type: 'object', properties: { id: { type: 'integer', description: 'candidates 里的 id' }, offset: { type: 'integer', description: '从第几个字开始，默认 0' } }, required: ['id'] },
      run({ id, offset = 0 } = {}) {
        const row = rows.find(item => item.id === id);
        if (!row) return { error: '没有这个编号' };
        const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0, text = String(row.text || '');
        return { id, source: row.owner, origin: row.source, kind: row.kind, totalChars: text.length, offset: start, text: safeExcerpt(text.slice(start, start + PAGE), PAGE), nextOffset: start + PAGE < text.length ? start + PAGE : null };
      }
    },
    {
      name: 'recent_activity',
      description: '查看这个会话最近发生的事：她刚说了什么、调用了哪些工具、结果的开头。想知道任务走到哪一步时用。',
      parameters: { type: 'object', properties: { limit: { type: 'integer', description: '看最近多少条，默认 8，最多 20' } } },
      run({ limit = 8 } = {}) { return { items: recentActivity(messages, Math.min(20, Math.max(1, Number.isSafeInteger(limit) ? limit : 8))) }; }
    },
    {
      name: 'current_state',
      description: '查看她此刻的全部状态：心情、正在做的事、进行中和刚结束的事件、打算、内在状态、想法、兴趣、后台有没有暂停。',
      parameters: { type: 'object', properties: {} },
      run() { let state = null; try { state = readState(); } catch {} return state ? { state: safeExcerpt(state, 6000) } : { error: '暂时读不到状态' }; }
    }
  ];
}
