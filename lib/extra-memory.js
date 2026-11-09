import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rememberRecord} from './memory-source-tracking.js';
import {createHash} from 'node:crypto';

const sha=text=>createHash('sha256').update(text).digest('hex');
const categories={activeTopic:'activeTopics',pendingThought:'pendingThoughts',memberImpression:'memberImpressions'};
const fail=r=>{throw Error('记忆后端未确认：'+String(r?.error?.code||r?.status||'unavailable'));};
// Only retry an explicit lock rejection, which guarantees that no write ran.
async function whileBusy(attempt){
 for(const delay of [0,250,750,1500,3000]){
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  const result=await attempt();
  if(result.ok||result.status!==409||!/(?:resource is busy|resource is being processed|lock contention)/i.test(result.error?.message||''))return result;
 }
 throw Object.assign(Error('OpenViking 仍在处理其他操作，本次没有写入'),{notApplied:true});
}
export function extraMemory(engine,service,{root=process.env.QQ_BRIDGE_ROOT||path.join(os.homedir(),'OneDrive','文档','Playground','qq-bridge'),http=fetch}={}){
 async function ov(uri,{directory=false}={}){
  const client=service()?.client,call=client?.fetchJSON?.bind(client);if(!call)throw Error('OpenViking 未连接');
  const status=await call('/api/v1/system/status');
  if(!status.ok||typeof status.result?.user!=='string'||!status.result.user)fail(status);
  const base='viking://user/'+status.result.user+'/memories/';
  if(directory&&!uri)uri=base.slice(0,-1);
  const root=directory&&uri===base.slice(0,-1);
  if(!root&&(typeof uri!=='string'||!uri.startsWith(base)||(!directory&&!uri.endsWith('.md'))||!uri.slice(base.length).split('/').every(x=>/^[\p{L}\p{N}_-][\p{L}\p{N}_. -]*$/u.test(x))))throw Error('仅支持当前用户 memories 下的单份 Markdown 记忆');
  return {call,base,query:'?uri='+encodeURIComponent(uri)};
 }
 async function bridge(sid){
  const load=async f=>JSON.parse(await fs.readFile(path.join(root,f),'utf8'));
  const binding=engine.read('../characters/censhu/integration.json',{}),key='private:'+binding.qqPrivateId;
  if(!binding.qqPrivateId||binding.sessionId!==sid||(await load('state/sessions.json')).sessions?.[key]!==sid)throw Error('QQ 私聊绑定不匹配');
  const cfg=await load('config.json'),state=(await load('state/social-v2.json')).conversations?.[key];
  if(!state?.agentToken||cfg.socialV2?.tools?.memory!==true)throw Error('QQ 轻量记忆工具未启用');
  const base='http://127.0.0.1:'+(Number(cfg.consolePort)||3100)+'/api/socialV2/memory';
  const consoleToken=cfg.consoleToken?.trim()||(await fs.readFile(path.join(root,'state','console-token'),'utf8')).trim();
  if(!consoleToken)throw Error('QQ Bridge 本机认证不可用');
  const headers={'content-type':'application/json','x-agent-call':'1','x-console-token':consoleToken,'x-agent-token':state.agentToken};
  const request=async(url,opts)=>{
    const res=await http(url,{...opts,redirect:'error',signal:AbortSignal.timeout(15000),headers});
    const value=await res.json();if(!res.ok||value.ok!==true)throw Error('QQ 轻量记忆未确认：'+String(value.error||res.status));return value;
  };
  const snapshot=await request(base+'?key='+encodeURIComponent(key)+'&integrity=1',{method:'GET'});
  if(snapshot.key!==key||snapshot.integrity!==1||!snapshot.raw)throw Error('QQ Bridge 单条核对接口未就绪');
  return {state:snapshot.raw,persisted:state,call:(action,body)=>request(base+'-'+action,{method:'POST',body:JSON.stringify({key,...body})})};
 }
 function qqRows(state,a){
  if(!Object.hasOwn(categories,a.target))throw Error('QQ 记忆分类无效');
  const rows=state[categories[a.target]];
  if(a.target==='memberImpression'){
   if(!a.id||!rows||Array.isArray(rows)||typeof rows!=='object')throw Error('群友印象需要准确的对象编号');
   if(!Object.hasOwn(rows,a.id))return [];
   if(!Array.isArray(rows[a.id]?.traits))throw Error('印象格式无法核对');
   return [rows[a.id].traits.join('、')];
  }
  if(!Array.isArray(rows)||rows.some(x=>typeof x?.text!=='string'))throw Error('QQ 轻量记忆列表不可读');
  return rows.map(x=>x.text);
 }
 return {
  async read(a,sid){
   const offset=Number(a.offset??0);if(!Number.isSafeInteger(offset)||offset<0)throw Error('起始位置无效');
   if(a.backend==='qq'){
    const {state}=await bridge(sid);
    if(a.target==='memberImpression'&&!a.id)return {ids:Object.keys(state.memberImpressions||{}).slice(offset,offset+30)};
    const rows=qqRows(state,a);return {entries:rows.slice(offset,offset+30),total:rows.length};
   }
   if(a.backend!=='openviking')throw Error('未知记忆库');
   const directory=!a.id?.endsWith('.md'),{call,query}=await ov(a.id,{directory});
   const res=await call(directory?'/api/v1/fs/ls'+query+'&recursive=false&offset='+offset+'&limit=30':'/api/v1/content/read'+query);
   if(!res.ok)fail(res);
   if(directory){if(!Array.isArray(res.result))throw Error('目录格式无法核对');return {entries:res.result.map(row=>({uri:row.uri,name:row.name,directory:row.isDir??row.is_dir}))};}
   if(typeof res.result!=='string')throw Error('原文无法核对');
   return {id:a.id,text:res.result.slice(offset,offset+4000),total:res.result.length,truncated:offset>0||res.result.length>4000};
  },
  async createApproved(fact,content){
   const client=service()?.client;if(!client)throw Error('OpenViking 服务未加载');
   const status=await client.fetchJSON('/api/v1/system/status');if(!status.ok||!status.result?.user)fail(status);
   const folder=fact.kind==='preference'?'preferences':'events';
   const uri='viking://user/'+status.result.user+'/memories/'+folder+'/censhu-'+sha(fact.sessionId+'|'+fact.id).slice(0,32)+'.md';
   const {call,query}=await ov(uri),read=()=>call('/api/v1/content/read'+query);
   const prior=await read();if(prior.ok){if(prior.result===content)return uri;throw Error('已存在不同内容，未覆盖');}
   if(prior.status!==404||prior.error?.code!=='NOT_FOUND')fail(prior);
   const r=await whileBusy(()=>call('/api/v1/content/batch-write',{method:'POST',body:JSON.stringify({root_uri:uri.slice(0,uri.lastIndexOf('/')),operations:[{uri,mode:'create',content}],skip_conflicts:false,wait:false})}));
   if(!r.ok)fail(r);const after=await read();if(!after.ok||after.result!==content)throw Error('OpenViking 新记忆尚未回读确认');
   return uri;
  },
  async inspect(a,sid,text){
   if(a.backend==='openviking'){
    const {call,query}=await ov(a.id);const r=await call('/api/v1/content/versioned-read'+query);
    if(!r.ok){if(r.status===404&&r.error?.code==='NOT_FOUND')return {exact:false,absent:true};fail(r);}
    if(typeof r.result?.text!=='string'||!/^[a-f0-9]{64}$/.test(r.result.revision))throw Error('OpenViking 未返回完整原文');
    const equal=r.result.text===text;return {revision:r.result.revision,exact:equal,absent:a.action==='replace'&&!equal};
   }
   const {state,persisted}=await bridge(sid),sources=[qqRows(state,a),qqRows(persisted,a)];
   return {exact:sources.every(rows=>rows.filter(v=>v===text).length===1),absent:sources.every(rows=>!rows.includes(text)&&(a.action!=='remove'||a.target!=='memberImpression'||!rows.length))};
  },
  async apply(a,sid,authorize=()=>{},revision){
   if(a.backend==='openviking'){
    const {call,query}=await ov(a.id);
    if(!revision){const before=await this.inspect(a,sid,a.original);if(!before.exact)throw Error('OpenViking 原文已变化');revision=before.revision;}
    const res=await whileBusy(()=>{
     authorize();
     return a.action==='remove'?call('/api/v1/fs/if-version'+query+'&expected_sha256='+revision,{method:'DELETE'}):
      call('/api/v1/content/batch-write',{method:'POST',body:JSON.stringify({root_uri:a.id.slice(0,a.id.lastIndexOf('/')),operations:[{uri:a.id,mode:'replace',content:a.replacement,expected_sha256:revision}],skip_conflicts:false,wait:false})});
    });
    if(res.status===409||res.status===404)throw Object.assign(Error('OpenViking 版本冲突或服务不支持条件变更，请重新读取并审核'),{notApplied:true});
    if(!res.ok)fail(res);return res;
   }
   const {state,call}=await bridge(sid),rows=qqRows(state,a);
   if(rows.filter(v=>v===a.original).length!==1||rows.includes(a.replacement))throw Error('原记录不唯一或新内容已存在');
   authorize();
   return call(a.action==='remove'?'remove':'update',{category:a.target,content:a.original,oldContent:a.original,target:a.id,newContent:a.replacement,expectedOriginal:a.original});
  }
 };
}

export function extraReadTool(engine,extra){
 return {name:'censhu_read_memory',description:'查看 OpenViking 当前用户的记忆目录或单个 Markdown 文件，或绑定 QQ 私聊的轻量记忆。返回原文供单条核对。offset 为文件字符偏移或列表起点。',parameters:{type:'object',additionalProperties:false,required:['backend'],properties:{backend:{type:'string',enum:['openviking','qq']},target:{type:'string',enum:['activeTopic','pendingThought','memberImpression']},id:{type:'string'},offset:{type:'integer',minimum:0}}},output:{schema:{type:'string'},render:(_a,t)=>[{type:'text',text:t}]},
 async execute(a,exec){
  const caller=exec.agent?.session?.id||exec.agent?.id,life=engine.read('../censhu-inner-life/display-session.json',{}).sessionId;
  const sid=caller&&caller===life?engine.read('../characters/censhu/integration.json',{}).sessionId:caller;
  // 2026-11-07: test-workspace sessions read the formal role's memory without recording evidence.
  const mirror=Boolean(sid)&&!engine.bound(sid)&&engine.readonlyTestSession?.(exec.agent)===true;
  if(mirror){const role=engine.read('../characters/censhu/integration.json',{}).sessionId;if(!role||!engine.config.enabled||!engine.bound(role))throw Error('仅限已绑定会话');return JSON.stringify(await extra.read(a,role));}
  if(!sid||!engine.config.enabled||!engine.bound(sid))throw Error('仅限已绑定会话');
  const result=await extra.read(a,sid);
  if(a.backend==='openviking'&&!result.truncated&&typeof result.text==='string')rememberRecord(engine,sid,{backend:a.backend,target:'user',id:a.id},result.text);
  if(a.backend==='qq')for(const text of result.entries||[])rememberRecord(engine,sid,a,text);
  return JSON.stringify(result);
 }};
}
