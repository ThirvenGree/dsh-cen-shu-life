import test from 'node:test';
import assert from 'node:assert/strict';
import {applyToolBindings,ALWAYS_TOOLS,TOOL_COMPANIONS} from '../lib/tool-bindings.js';
import {createRequestContext} from '../lib/request-context.js';

const bind=(chosen,offered)=>{const set=new Set(chosen);const added=applyToolBindings(set,new Set(offered));return {set,added};};

test('always-bound tools are added only when the host offers them',()=>{
 const {set,added}=bind(['web_search'],['web_search','compress','search_context','list_context_sessions']);
 assert.deepEqual(added.sort(),['compress','list_context_sessions','search_context']);
 assert.ok(!set.has('decompress'),'never adds a tool the host does not offer');
 assert.ok(ALWAYS_TOOLS.includes('censhu_life_context'));
});

test('companions follow their trigger, chain to a fixed point, and stay absent without it',()=>{
 const offered=['browser_task','browser_interest','browser_progress','browser_steer','compress','acp_status','read_report'];
 const {set}=bind(['browser_task'],offered);
 for(const name of ['browser_interest','browser_progress','browser_steer','acp_status'])assert.ok(set.has(name),name);
 const plain=bind(['read_report'],offered.filter(name=>name!=='compress')).set;
 assert.ok(!plain.has('browser_interest')&&!plain.has('acp_status'),'no trigger, no companion');
});

test('MCP tools bind inside their own server, including submit/result pairs',()=>{
 const offered=['mcp__snowluma__qq_send_sticker','mcp__snowluma__qq_get_sticker_image','mcp__snowluma__qq_list_stickers',
  'mcp__redfox__gpt_image_generate','mcp__redfox__gpt_image_result','mcp__redfox__ai_search_kimi','mcp__redfox__ai_search_kimi_result',
  'mcp__redfox__xiaohongshu_get_comments','mcp__redfox__xiaohongshu_get_comments_result'];
 const {set}=bind(['mcp__snowluma__qq_send_sticker','mcp__redfox__gpt_image_generate','mcp__redfox__ai_search_kimi','mcp__redfox__xiaohongshu_get_comments'],offered);
 for(const name of offered)assert.ok(set.has(name),name);
});

test('voice production tools always travel together',()=>{
 const names=['elevenlabs_plan_speech','elevenlabs_performance_guide','elevenlabs_render_track'];
 for(const start of names){const {set}=bind([start],names);for(const name of names)assert.ok(set.has(name),start+' -> '+name);}
});

test('every companion rule names a trigger and at least one companion',()=>{
 for(const [trigger,companions] of TOOL_COMPANIONS){
  assert.ok(typeof trigger==='string'||trigger instanceof RegExp);
  assert.ok(Array.isArray(companions)&&companions.length>0);
 }
});

test('the projector declares bindings even when the planner leaves them out, and records them',async()=>{
 const rows=[];
 const plain=name=>({name,description:'Fixture tool '+name,parameters:{type:'object',properties:{}}});
 const project=createRequestContext({minToolChars:1,resolveAgent:()=>({id:'session-binding-fixture'}),onRecord:row=>rows.push(row),
  plan:async()=>({keepTools:['mcp__snowluma__qq_generate_image'],keepSkills:[],results:[],reason:'fixture'})});
 try{
  const tools=['mcp__snowluma__qq_generate_image','mcp__snowluma__qq_send_generated_image','search_context','list_context_sessions','send_mail'].map(plain);
  const output=await project.transform({sessionId:'session-binding-fixture',provider:'fixture',model:'fixture',messages:[{role:'user',source:{kind:'user'},content:[{type:'text',text:'画一张图'}]}],tools});
  const declared=output.tools.map(tool=>tool.name);
  for(const name of ['mcp__snowluma__qq_generate_image','mcp__snowluma__qq_send_generated_image','search_context','list_context_sessions'])assert.ok(declared.includes(name),name);
  assert.ok(!declared.includes('send_mail'),'unrelated tools are still dropped');
  assert.deepEqual(rows.at(-1).boundTools.sort(),['list_context_sessions','mcp__snowluma__qq_send_generated_image','search_context']);
 }finally{project.dispose();}
});

test('2026-11-06: recall tools named by injected context are always bound',()=>{
 for(const name of ['censhu_context_recall','censhu_question_recall','censhu_knowledge_recall'])assert.ok(ALWAYS_TOOLS.includes(name),name);
 const {added}=bind(['web_search'],['web_search','censhu_context_recall','censhu_question_recall']);
 assert.ok(added.includes('censhu_context_recall')&&added.includes('censhu_question_recall'));
 assert.ok(!added.includes('censhu_knowledge_recall'),'still only when offered');
});

test('2026-11-06: a Douyin watch round brings its whole flow; comments and inbox replies bring their lookups',()=>{
 const flow=['douyin_watch_start','douyin_watch_status','douyin_watch_stop','douyin_open','douyin_observe','douyin_next','douyin_watch_react','douyin_watch_note','douyin_watch_decide','douyin_watch_end'];
 const {set}=bind(['douyin_watch_start'],[...flow,'douyin_like']);
 for(const name of flow)assert.ok(set.has(name),name);
 assert.ok(!set.has('douyin_like'),'unrelated actions stay out');
 assert.ok(bind(['douyin_watch_react'],flow).set.has('douyin_watch_note'));
 assert.ok(bind(['douyin_comment'],['douyin_comment','douyin_read_comments']).set.has('douyin_read_comments'));
 assert.ok(bind(['douyin_notice_list'],['douyin_notice_list','douyin_notice_reply']).set.has('douyin_notice_reply'));
 const chat=bind(['douyin_chat_offers'],['douyin_chat_offers','douyin_chat_reply','douyin_chat_read']).set;
 assert.ok(chat.has('douyin_chat_reply')&&chat.has('douyin_chat_read'));
});

test('2026-11-06: id lookups for QQ quote-replies, memory edits and OpenViking deletes resolve in the same server',()=>{
 const qq=bind(['mcp__snowluma__qq_reply'],['mcp__snowluma__qq_reply','mcp__snowluma__qq_get_recent_messages','mcp__snowluma__qq_get_forward_msg']).set;
 assert.ok(qq.has('mcp__snowluma__qq_get_recent_messages')&&qq.has('mcp__snowluma__qq_get_forward_msg'),'reply → recent → forward records');
 const ov=bind(['mcp__openviking__forget'],['mcp__openviking__forget','mcp__openviking__find']).set;
 assert.ok(ov.has('mcp__openviking__find'));
 assert.ok(bind(['mnemon_memory_body_merge'],['mnemon_memory_body_merge','mnemon_memory_bodies']).set.has('mnemon_memory_bodies'));
 assert.ok(bind(['lingshu_mdcg_verify'],['lingshu_mdcg_verify','lingshu_mdcg_search','mdcg_search']).set.has('lingshu_mdcg_search'));
 assert.ok(!bind(['lingshu_mdcg_verify'],['lingshu_mdcg_verify','lingshu_mdcg_search','mdcg_search']).set.has('mdcg_search'),'lingshu and mdcg stay separate');
 const review=bind(['engram_review_queue'],['engram_review_queue','engram_review','engram_report','engram_search']).set;
 assert.ok(review.has('engram_review')&&review.has('engram_report'));
});

test('2026-11-06: the removed browser_direct_* tools no longer appear in the rules',()=>{
 assert.ok(!TOOL_COMPANIONS.some(([trigger])=>String(trigger).includes('direct_')));
});
