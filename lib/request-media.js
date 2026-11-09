// 2026-11-08：抖音刷视频和重看会话里，已经判断完、翻过去的视频，它的分镜图片不再发给模型。
// 只改这一次请求的副本，会话记录里的图片不动；没有成功翻到下一条时不算翻过去。
const FRAME_TOOLS = new Set(['douyin_observe', 'douyin_video_zoom']);
const BOUNDARY_TOOLS = new Set(['douyin_next', 'douyin_open_video', 'douyin_open', 'douyin_watch_end', 'douyin_watch_stop']);
const WATCH_SESSION = /^douyin-(?:censhu|revisit)(?:-|$)/;
export const OMITTED_FRAMES_NOTE = '【这条视频已经看完翻过去了，当时的分镜图片不再附上；你当时的判断和记录都还在。】';
const callsOf = message => [...(Array.isArray(message?.content) ? message.content.filter(part => part?.type === 'tool-call') : []), ...(Array.isArray(message?.toolCalls) ? message.toolCalls : [])];
const isImage = part => part?.type === 'image' || part?.type === 'image_url';

export function dropJudgedFrames(messages, sessionId) {
  if (!Array.isArray(messages) || !WATCH_SESSION.test(String(sessionId || '').replace(/^session-/, ''))) return messages;
  const names = new Map(), failed = new Set(), done = new Set();
  messages.forEach(message => {
    for (const call of callsOf(message)) names.set(call.id || call.callId, call.name || call.function?.name);
    if (message?.role === 'tool') { done.add(message.toolCallId); if (message.isError === true || message.error) failed.add(message.toolCallId); }
  });
  let boundary = -1;
  messages.forEach((message, index) => { if (callsOf(message).some(call => { const id = call.id || call.callId; return BOUNDARY_TOOLS.has(call.name || call.function?.name) && done.has(id) && !failed.has(id); })) boundary = index; });
  if (boundary < 0) return messages;
  let result = messages;
  for (let index = 0; index < boundary; index++) {
    const message = messages[index];
    if (message?.role !== 'tool' || !FRAME_TOOLS.has(message.name || names.get(message.toolCallId)) || !Array.isArray(message.content) || !message.content.some(isImage)) continue;
    let noted = false;
    const content = message.content.flatMap(part => { if (!isImage(part)) return [part]; if (noted) return []; noted = true; return [{ type: 'text', text: OMITTED_FRAMES_NOTE }]; });
    if (result === messages) result = [...messages];
    result[index] = { ...message, content };
  }
  return result;
}
