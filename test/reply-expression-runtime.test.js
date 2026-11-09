import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {installReplyExpression} from '../lib/reply-expression.js';
test('installed Cordis waterfall and prepared desktop/Pet calls share the review before consumers',{skip:!process.env.DSH_RUNTIME_ROOT},async()=>{
 const load=name=>import(pathToFileURL(path.join(process.env.DSH_RUNTIME_ROOT,'node_modules/@deepseek-ai',name,'lib/index.js')));
 const [{Context},{LlmRuntime,LlmAdapter,BlockAssembler}]=await Promise.all([load('cordis'),load('dsh-llm')]);
 const ctx=new Context();new LlmRuntime(ctx);const writes=[];let invoked=0,downstream=0;
 class Adapter extends LlmAdapter{
  resolveModel(provider,id){return Promise.resolve({provider,id,name:id,context:{contextWindow:32768}});}
  async *stream(options){if(options.messages?.at(-1)?.source?.plugin==='dsh-cen-shu-life'){yield {type:'text-delta',index:0,text:JSON.stringify({reason:'自行表达',edits:[{index:0,quote:'急不来',replacement:'不用急'}]})};yield {type:'finish',reason:{kind:'stop'}};return;}yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'急不来'};yield {type:'block-end',index:0,block:{type:'text',text:'急不来'}};yield {type:'finish',reason:{kind:'stop'}};}
 }
 const offs=[ctx.llm.registerAdapter(['fixture'],new Adapter()),ctx.on('llm/stream',(_r,next)=>{downstream++;return next();})];
 // Delegate event registration to the real Cordis context, not a fake hook.
 const hookCtx={llm:ctx.llm,on:ctx.on.bind(ctx),agents:{list:()=>[{session:{id:'session-desktop'}}]}};
 offs.push(installReplyExpression(hookCtx,{config:{},read:()=>({items:[]}),write:(_n,v)=>writes.push(v)}, {judge:async()=>{invoked++;return {reason:'常见搭配',edits:[{index:0,quote:'急不来',replacement:'急不得'}]};}}));
 try{
  // 2026-11-07: desktop is reviewed; Pet (text, realtime voice, whispers) passes through unedited.
  for(const [sessionId,reviewed] of [['session-desktop',true],['dsh-pet',false]]){
   const before=invoked;
   const prepared=await ctx.llm.prepareCall({provider:'fixture',model:'fixture',maxTokens:100});
   const assembler=new BlockAssembler();let spoken='';
   for await(const c of prepared.stream({provider:'fixture',model:'fixture',sessionId,maxTokens:100,messages:[],signal:new AbortController().signal})){
    if(c.type==='text-delta'){assert.equal(invoked>before,reviewed);spoken+=c.text;}assembler.push(c);
   }
   assert.equal(spoken,reviewed?'不用急':'急不来');assert.equal(assembler.blocks()[0].text,spoken);
  }
  assert.equal(invoked,1);assert.equal(downstream,3);assert.equal(writes.length,1);
 }finally{offs.reverse().forEach(off=>off());}
});
