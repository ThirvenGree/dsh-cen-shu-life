// Tool bindings for the request projector (2026-11-05).
//
// Dynamic selection narrows ~470 offered tools to the few a task needs. These
// bindings are the deterministic floor under that model choice:
//  - ALWAYS_TOOLS are declared on every narrowed request whenever the host
//    offers them (small, session-wide capabilities that must never be lost);
//  - TOOL_COMPANIONS declare the tools a chosen tool cannot work without
//    (a preview before a send, a result poll after a submit, the id lookup
//    before an update). Bindings never add a tool the host does not offer.
// MCP tools are matched by their name after the `mcp__<server>__` prefix, and
// companions resolve inside the same server first.

/** Declared on every narrowed request when offered. */
export const ALWAYS_TOOLS = Object.freeze([
 // Context management: compressing, restoring and searching history.
 'compress', 'decompress', 'acp_retrieve', 'search_context', 'list_context_sessions',
 // Her current state; the description says it may be read every turn.
 'censhu_life_context',
 // 2026-11-06: the injected context itself tells her to call these (omitted-material pointer,
 // life-context hint, long-term knowledge lines), but the tool selector never sees that context.
 'censhu_context_recall', 'censhu_question_recall', 'censhu_knowledge_recall',
 // 2026-11-08: the full read-only view of her current state.
 'censhu_current_state',
 // 2026-11-09: what to read when something fails or she does not know how to proceed.
 'censhu_help'
]);

// 2026-11-08: B站 work sessions do almost everything through `node bili.mjs …`, and the lane guide that
// says so is injected context the selector never sees, so the shell is always declared there.
// Session ids: bili-watch-* / bili-social-* / bili-revisit-* and the older bili-whale (see memory-writeback.js).
// 2026-11-08: the browser work session (browser-browse-*) exists to browse; its lane guide is injected context too.
export const WORK_SESSION_TOOLS = Object.freeze({
 bili: Object.freeze(['pwsh', 'bash']),
 // 2026-11-08: without the dedicated browser no DM or comment arrives, and the plugin never opens it by itself.
 douyinSocial: Object.freeze(['douyin_browser_open']),
 browser: Object.freeze(['browser_interest', 'browser_handoff', 'browser_progress', 'browser_task', 'browser_steer', 'browser_direct_session', 'browser_direct_page', 'browser_direct_inspect', 'browser_direct_interact', 'browser_direct_tabs'])
});
const workKind = id => { const s = String(id || '').replace(/^session-/, ''); return /^bili-(?:whale|watch|social|revisit)(?:-|$)/.test(s) ? 'bili' : /^browser-browse-/.test(s) ? 'browser' : /^douyin-dm(?:-|$)/.test(s) ? 'douyinSocial' : null; };

const group = names => names.map(name => [name, names.filter(other => other !== name)]);

/** [trigger, companions]; a trigger is an exact base name or a RegExp over base names. */
export const TOOL_COMPANIONS = Object.freeze([
 // Browser: interest is read before any browser work; delegated work is followed and steered.
 [/^browser_(task|handoff|progress|steer)/, ['browser_interest']],
 ['browser_task', ['browser_progress', 'browser_steer']],
 ['browser_handoff', ['browser_progress']],
 // Context: find compressible ranges before compressing.
 ['compress', ['acp_status']],
 // QQ: preview-before-send pairs both ways, read-before-mark, lookups before edits.
 ['qq_send_sticker', ['qq_get_sticker_image', 'qq_list_stickers']],
 ['qq_get_sticker_image', ['qq_send_sticker']],
 ['qq_sticker_note', ['qq_get_sticker_image']],
 ['qq_generate_image', ['qq_send_generated_image']],
 ['qq_send_generated_image', ['qq_generate_image']],
 ['qq_capture_browser', ['qq_send_browser_capture']],
 ['qq_send_browser_capture', ['qq_capture_browser']],
 ['qq_preview_file', ['qq_send_preview_image']],
 ['qq_send_preview_image', ['qq_preview_file']],
 ['qq_send_file', ['qq_preview_file']],
 ['qq_get_unread_messages', ['qq_mark_read']],
 // 2026-11-06: quote-replies need a message id; forwarded chat records appear inside fetched messages.
 ['qq_reply', ['qq_get_recent_messages']],
 [/^qq_get_(unread|recent)_messages$|^qq_get_message_detail$/, ['qq_get_forward_msg']],
 ['qq_collect_sticker', ['qq_get_message_images']],
 [/^qq_memory_(remove|clear)$/, ['qq_memory_query']],
 ['qq_slang_submit', ['qq_slang_query']],
 // Voice production: plan, check against the guide, render.
 ...group(['elevenlabs_plan_speech', 'elevenlabs_performance_guide', 'elevenlabs_render_track']),
 // Memory: ids come from search/recall; engram answers pass its evidence gate.
 ['engram_search', ['engram_examine', 'engram_assess']],
 [/^engram_(neighbors|episode_timeline|timeline)$/, ['engram_examine']],
 ['engram_review_queue', ['engram_review', 'engram_report']],
 [/^mdcg_(get|verify)$/, ['mdcg_search']],
 [/^lingshu_mdcg_(get|verify)$/, ['lingshu_mdcg_search']],
 [/^mnemon_memory_body_(create|update|merge)$/, ['mnemon_memory_bodies']],
 [/^mnemon_document_(create|manage)$/, ['mnemon_document_search']],
 ['memory_review_status', ['memory_suggest']],
 // OpenViking: irreversible delete and downloads take a viking:// URI found first.
 [/^(forget|download)$/, ['find']],
 [/^engram_(update|forget|report|review)$/, ['engram_search']],
 [/^mnemon_(related|forget|link)$/, ['mnemon_recall']],
 ['censhu_correct_memory', ['censhu_read_memory']],
 ['edit', ['read']],
 // Douyin: act on what was just observed; anything started can be checked and stopped.
 ['douyin_search', ['douyin_open_video']],
 [/^douyin_(like|collect|forward_video|read_comments|video_zoom)$/, ['douyin_observe']],
 // 2026-11-06: a watch round is started, then watched, felt, judged and ended with these.
 ['douyin_watch_start', ['douyin_watch_status', 'douyin_watch_stop', 'douyin_open', 'douyin_observe', 'douyin_next', 'douyin_watch_react', 'douyin_watch_note', 'douyin_watch_decide', 'douyin_watch_end']],
 ...group(['douyin_watch_react', 'douyin_watch_note']),
 ['douyin_comment', ['douyin_read_comments']],
 ['douyin_chat_start', ['douyin_chat_status', 'douyin_chat_stop']],
 ['douyin_spark_stop', ['douyin_spark_status']],
 ['douyin_diagnostics_repair', ['douyin_diagnostics']],
 // 2026-11-06: her own replies to Douyin DMs and comment notices.
 ['douyin_chat_reply', ['douyin_chat_offers', 'douyin_chat_read']],
 ['douyin_notice_reply', ['douyin_notice_list', 'douyin_read_comments']],
 ['douyin_notice_list', ['douyin_notice_reply']],
 ['douyin_chat_offers', ['douyin_chat_reply', 'douyin_chat_read']],
 // 2026-11-08: named together in the lane guides.
 ['douyin_browser_open', ['douyin_browser_close']],
 ['douyin_media_browse', ['douyin_media_save', 'douyin_media_remove']],
 ['bili_media_browse', ['bili_media_save', 'bili_media_remove']],
 // 2026-11-08: ids and pictures come from elsewhere; notes and resuming are part of the same work.
 ['douyin_chat_send', ['douyin_chat_contacts']],
 ['douyin_chat_read', ['douyin_chat_contacts']],
 [/^douyin_(chat_reply|chat_send|comment)$/, ['douyin_media_browse']],
 [/^douyin_(chat_reply|notice_reply)$/, ['douyin_social_note']],
 ['douyin_revisit_start', ['douyin_saved_videos']],
 ['douyin_watch_react', ['douyin_observe']],
 // 2026-11-09: the answer gives time points; watching one of them needs observe.
 ['douyin_video_ask', ['douyin_observe']],
 ['douyin_chat_stop', ['douyin_chat_start']],
 // B站: saving a sticker needs the message key that only bili_dm_view shows.
 ['bili_media_save', ['bili_dm_view']],
 // 2026-11-08: the ids a saved picture needs, and tools the descriptions name as the next step.
 ['douyin_media_save', ['douyin_notice_view', 'douyin_chat_read']],
 ['douyin_notice_list', ['douyin_notice_view']],
 ['douyin_chat_reply', ['douyin_chat_send']],
 ['browser_interest', ['browser_task', 'browser_handoff']],
 ...group(['browser_task', 'browser_handoff']),
 [/^browser_(task|handoff)$/, ['browser_executor_advice']],
 ['censhu_parallel_decide', ['subagent']],
 // Life events: event ids come from the finder.
 ['censhu_agency_event_history', ['censhu_agency_find_event']],
 // Managed objects: list or read before changing.
 [/^schedule_(update|delete)$/, ['schedule_list']],
 [/^automation_(update|delete|run_now|runs)$/, ['automation_list']],
 ['team_task_update', ['team_task_get']],
 [/^job_(output|kill)$/, ['job_list']],
 [/^terminal_/, ['terminal_open', 'terminal_list', 'terminal_read', 'terminal_send', 'terminal_signal', 'terminal_close']],
 ['update_goal', ['get_goal']],
 ['meme_update', ['meme_list']],
 [/^cosplay_(switch|remove|upsert)$/, ['cosplay_list']],
 ['cordis_inspect_query', ['cordis_inspect_list']],
 ['read_mcp_resource', ['list_mcp_resources']]
]);

const MCP_PREFIX = /^(mcp__.+?__)(.+)$/;
const split = name => { const m = MCP_PREFIX.exec(name); return m ? [m[1], m[2]] : ['', name]; };
const matches = (trigger, base) => typeof trigger === 'string' ? trigger === base : trigger.test(base);

/** Asynchronous submit tools whose results are fetched by a sibling `_result` tool. */
const resultTool = base => [base + '_result', base.endsWith('_generate') ? base.slice(0, -'_generate'.length) + '_result' : null].filter(Boolean);

/**
 * Add always-bound tools and companions of the chosen tools, repeating until
 * nothing changes. `offered` answers has(name). Returns the names it added.
 */
export function applyToolBindings(chosen, offered, { sessionId } = {}) {
 const added = [];
 const add = name => { if (offered.has(name) && !chosen.has(name)) { chosen.add(name); added.push(name); return true; } return false; };
 for (const name of ALWAYS_TOOLS) add(name);
 for (const name of WORK_SESSION_TOOLS[workKind(sessionId)] || []) add(name);
 let changed = true;
 while (changed) {
  changed = false;
  for (const name of [...chosen]) {
   const [prefix, base] = split(name);
   const resolve = companion => (prefix && add(prefix + companion)) || add(companion);
   for (const [trigger, companions] of TOOL_COMPANIONS) if (matches(trigger, base)) for (const companion of companions) if (resolve(companion)) changed = true;
   for (const companion of resultTool(base)) if (resolve(companion)) changed = true;
  }
 }
 return added;
}
