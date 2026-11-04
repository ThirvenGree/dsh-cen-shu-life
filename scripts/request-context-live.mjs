/** Opt-in paid integration check. Default execution performs no model call.
 * Only synthetic fixtures leave this process; ordinary chat, memory and tools
 * are never read or executed. All diagnostics/originals live in a temporary home.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

if(!process.argv.includes('--live')){
 console.log('No network request made. Run node scripts/request-context-live.mjs --live to make one paid Gemini call using the configured model and local key reader.');
 process.exit(0);
}

const originalHome=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const stored=JSON.parse(fs.readFileSync(path.join(originalHome,'cen-shu-life','config.json'),'utf8'));
const config=Object.fromEntries(['semanticEnabled','semanticModel','semanticProxyUrl','semanticTimeoutMs'].map(key=>[key,stored[key]]));
if(config.semanticEnabled!==true)throw Error('Configured semantic model is disabled; no paid request made.');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'censhu-request-context-live-'));
const oldHome=process.env.DSH_HOME;
process.env.DSH_HOME=directory;
const {createRequestContext,requestPlanPrompt,requestPlanSchema}=await import('../lib/request-context.js');
const {googleStructured}=await import('../lib/situation.js');
const agent={session:{id:'synthetic-request-context-live'}};
const receipt='SEARCH RECEIPT: read-only query completed. Matching bookId="NL-042", branchId="B-NORTH", title="North Lantern". No reservation created and no message sent.';
const archive=Array.from({length:100},(_,index)=>`ARCHIVE ${String(index).padStart(3,'0')}: An unrelated fictional visitor borrowed a different book in a previous year. This record does not change the matching book identifier or current shelf status.`).join('\n');
const media={type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII='};
const definitions=[
 {name:'search_library',description:'Read-only search of the fictional library catalog by title; returns bookId and branchId for matching books.',parameters:{type:'object',required:['title'],properties:{title:{type:'string'}}}},
 {name:'get_book_details',description:'Read-only lookup of current availability and exact shelf location for one fictional library book. Both bookId and branchId from a prior search are required.',parameters:{type:'object',required:['bookId','branchId'],properties:{bookId:{type:'string'},branchId:{type:'string'}}}},
 {name:'send_message',description:'Sends a real message to the supplied channel. This is a write action and is unnecessary for a read-only library query.',parameters:{type:'object',required:['channel','text'],properties:{channel:{type:'string'},text:{type:'string'}}}}
];
let modelDecision,modelError,modelCalls=0,modelDurationMs=0;
const project=createRequestContext({storeDirectory:path.join(directory,'originals'),resolveAgent:()=>agent,minToolChars:1,minResultChars:1000,maxPlannerCalls:1,
 plan:async input=>{
  modelCalls++;const start=performance.now();
  try{return modelDecision=await googleStructured(requestPlanPrompt,requestPlanSchema,input,config,{feature:'diagnostic',signal:AbortSignal.timeout(45000),maxOutputTokens:3000});}
  catch(error){modelError={message:error.message,code:error.code||null,httpStatus:error.httpStatus||null};throw error;}
  finally{modelDurationMs=Math.round(performance.now()-start);}
 }
});
const helpers=project.tools();
const request={sessionId:agent.session.id,provider:'synthetic',model:'synthetic-primary',messages:[
 {role:'user',source:{kind:'user'},content:[{type:'text',text:'This is a fictional read-only library query. Search already found North Lantern. Use its bookId and branchId to look up current availability and shelf location next. The long unrelated archive is unnecessary for this lookup; preserve a retrieval pointer if any detail is omitted. Do not reserve books or send messages.'}]},
 {role:'assistant',content:[{type:'tool-call',id:'synthetic-search-call',name:'search_library',arguments:{title:'North Lantern'}}]},
 {role:'tool',source:{kind:'tool',callId:'synthetic-search-call'},toolCallId:'synthetic-search-call',isError:false,content:[{type:'text',text:receipt},{type:'text',text:archive},media]}
],tools:[...definitions,...helpers.map(({name,description,parameters})=>({name,description,parameters}))]};
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}
freeze(request);const before=JSON.stringify(request),started=performance.now();
try{
 const out=await project.transform(request),elapsedMs=Math.round(performance.now()-started);
 assert.equal(JSON.stringify(request),before);assert.equal(modelCalls,1);assert.strictEqual(out.messages[2].content[2],media);
 const projectedText=out.messages[2].content.filter(part=>part.type==='text').map(part=>part.text).join('\n');
 let pointers=0,exactReadMatches=true,readPages=0;
 for(const part of out.messages[2].content){
  if(part.type!=='text'||!part.text.includes('【工具结果原文】'))continue;
  const pointer=JSON.parse(part.text.split('【工具结果原文】').at(-1));let offset=0,text='';pointers++;
  do{
   const page=JSON.parse(helpers[1].execute({...pointer,offset,limit:8000},{agent}));readPages++;assert.equal(page.available,true);
   text+=page.text;offset=page.nextOffset;
  }while(offset!==null);
  exactReadMatches&&=text===request.messages[2].content[pointer.part].text;
 }
 assert.equal(exactReadMatches,true);
 const validation={originalUnchanged:true,mediaPreserved:true,requiredIdentifiersPresent:projectedText.includes('NL-042')&&projectedText.includes('B-NORTH'),receiptPreserved:projectedText.includes(receipt),readOnlyOutcomePreserved:projectedText.includes('No reservation created and no message sent.'),selectedLookup:out.tools.some(tool=>tool.name==='get_book_details'),historicalSearchPreserved:out.tools.some(tool=>tool.name==='search_library'),unrelatedWriteOmitted:!out.tools.some(tool=>tool.name==='send_message'),exactRecallPointers:pointers,exactRecallPages:readPages,exactRecallMatches:pointers>0?exactReadMatches:null};
 const stats=project.status()[0];
 const report={ok:!modelError&&stats?.mode==='model'&&validation.requiredIdentifiersPresent&&validation.readOnlyOutcomePreserved&&validation.selectedLookup&&validation.historicalSearchPreserved,fixture:'synthetic-library-only',model:config.semanticModel,localProxyConfigured:Boolean(config.semanticProxyUrl),modelCalls,modelDurationMs,totalDurationMs:elapsedMs,modelError,modelDecision,selectedDefinitions:out.tools.map(tool=>tool.name),validation,projection:{mode:stats?.mode,reason:stats?.reason,resultCharsBefore:stats?.resultCharsBefore,resultCharsAfter:stats?.resultCharsAfter,toolCharsBefore:stats?.toolCharsBefore,toolCharsAfter:stats?.toolCharsAfter}};
 console.log(JSON.stringify(report,null,2));
 if(!report.ok)process.exitCode=1;
}finally{
 project.dispose();if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;
 const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());
 if(path.dirname(resolved)!==temp||!path.basename(resolved).startsWith('censhu-request-context-live-'))throw Error('Temporary cleanup path failed confinement check.');
 fs.rmSync(resolved,{recursive:true,force:true});
}
