import {createHash} from 'node:crypto';
const safe=text=>typeof text==='string'&&text.trim().length>0&&text.length<=160&&!/AIza|sk-[a-zA-Z]|gh[pous]_|<script|```|https?:|忽略.*规则|覆盖.*设定|执行命令|API.?key|环境变量/i.test(text);
export const intentionSchema={type:'array',maxItems:6,items:{type:'object',additionalProperties:false,required:['text','startHour','endHour','validMinutes','templateNames','priority'],properties:{text:{type:'string',maxLength:160},startHour:{type:'integer',minimum:0,maximum:23},endHour:{type:'integer',minimum:1,maximum:24},validMinutes:{type:'integer',minimum:1,maximum:1440},templateNames:{type:'array',maxItems:6,items:{type:'string',maxLength:30}},priority:{type:'number',minimum:0,maximum:2}}}};
export function filterIntentions(raw,rejected=[]){
 if(raw===undefined)return [];if(!Array.isArray(raw)){rejected.push({section:'intentions',reason:'不是数组'});return [];}
 const accepted=[],seen=new Set();for(const [index,item] of raw.slice(0,24).entries()){
  try{if(accepted.length>=6)throw Error('超过六条意向');if(!item||!safe(item.text)||!Number.isInteger(item.startHour)||!Number.isInteger(item.endHour)||item.startHour<0||item.endHour>24||item.startHour>=item.endHour||!Number.isInteger(item.validMinutes)||item.validMinutes<1||item.validMinutes>1440||!Number.isFinite(item.priority)||item.priority<0||item.priority>2||!Array.isArray(item.templateNames)||item.templateNames.length>6||item.templateNames.some(x=>!safe(x)||x.length>30))throw Error('生活意向字段无效');
   const id='intention:'+createHash('sha256').update(JSON.stringify([item.text,item.startHour,item.endHour,item.templateNames])).digest('hex').slice(0,16);if(seen.has(id))throw Error('重复意向');seen.add(id);accepted.push({id,text:item.text,startHour:item.startHour,endHour:item.endHour,validMinutes:item.validMinutes,templateNames:[...new Set(item.templateNames)],priority:item.priority});
  }catch(error){rejected.push({section:'intentions',index,reason:error.message});}
 }return accepted;
}
export function bindIntentions(items,templates,generatedAt,batchEnd,timezone,windowOf){
 return items.map(item=>{const ids=[],unresolvedNames=[];for(const name of item.templateNames){const matches=templates.filter(t=>t.name===name);if(matches.length===1)ids.push(matches[0].id);else unresolvedNames.push(name);}return {...windowOf(item,generatedAt,batchEnd,timezone),id:'intention:'+createHash('sha256').update(item.id+'|'+generatedAt).digest('hex').slice(0,16),mentionKey:item.id,revision:0,templateIds:[...new Set(ids)],unresolvedNames,generatedAt};});
}
export function intentionView(engine,now=engine.now()){
 if(!engine.config.enabled||!engine.config.contentEvolutionEnabled||!engine.config.lifePlanningEnabled)return [];
 const events=[...engine.state.active,...engine.history.events];
 const stored=engine.activeContent()?.intentions;return (Array.isArray(stored)?stored:[]).filter(x=>x&&safe(x.text)&&Array.isArray(x.templateIds)&&Number.isFinite(x.priority)&&x.priority>=0&&x.priority<=2&&Number.isFinite(x.validFrom)&&Number.isFinite(x.expiresAt)&&x.validFrom<x.expiresAt&&x.expiresAt>now).map(item=>{const linked=events.filter(e=>e.startedAt>=item.generatedAt&&e.intentionIds?.includes(item.id));const key=item.mentionKey||item.id,lastMentionAt=Math.max(0,...engine.history.mentions.filter(m=>m.mentionKey===key||m.intentionId===item.id).map(m=>m.at));return {...item,lastMentionAt,mayMention:!lastMentionAt||now-lastMentionAt>=engine.config.mentionCooldownMinutes*60000,status:linked.length?'linked':item.cancelledAt?'cancelled':item.validFrom>now?'upcoming':'available',linkedEvents:linked.map(e=>({id:e.id,name:e.name,status:e.status}))};});
}
export function intentionChoice(engine,templateId,now=engine.now()){
 const items=intentionView(engine,now).filter(x=>(x.status==='available'||x.status==='cancelled'&&x.validFrom<=now)&&x.templateIds.includes(templateId));
 return {priority:items.length?Math.min(...items.map(x=>x.priority)):1,ids:items.map(x=>x.id),reasons:items.map(x=>x.text)};
}
export function intentionsContext(engine,now){const items=intentionView(engine,now).filter(x=>x.status==='available'||x.status==='cancelled'&&x.validFrom<=now);return items.length?'\n【当前生活意向，尚未发生】'+JSON.stringify(items.map(x=>({id:x.id,text:x.text,cancelled:x.status==='cancelled',priority:x.priority,mayMention:x.mayMention,expiresAt:x.expiresAt})))+'。这是可调整、可放弃的打算；cancelled=true表示已取消，不再当成当前愿望。mayMention=false表示近期已经提过，除非青枔主动追问，不主动再提。同一段独处打算涉及这个意向时也遵守此标记。意向不能当作已完成、不能写成经历或据此给心情加分；只有实际事件或工具结果才表示行动发生。':'';}
export function noteIntentionMentions(engine,text,now=engine.now()){
 if(typeof text!=='string'||!text.trim())return false;let changed=false;
 for(const item of intentionView(engine,now).filter(x=>x.status==='available'||x.status==='upcoming'||x.status==='cancelled')){
  const aliases=[item.text,...item.templateNames,...engine.allTemplates().filter(t=>item.templateIds.includes(t.id)).flatMap(t=>t.aliases||[])].filter(x=>typeof x==='string'&&x.trim().length>=2);
  if(aliases.some(alias=>text.includes(alias))&&now-item.lastMentionAt>60000){engine.history.mentions.push({intentionId:item.id,mentionKey:item.mentionKey||item.id,at:now});changed=true;}
 }return changed;
}
// Explicit inner-life edits outlive a daily refresh until their original expiry.
// New planning cannot silently reintroduce an overlapping, explicitly revised wish.
export function preserveAdjustedIntentions(previous,incoming,now){
 const retained=(previous||[]).filter(x=>x.adjustedAt&&x.expiresAt>now);
 return [...retained,...incoming.filter(x=>!retained.some(old=>old.validFrom<x.expiresAt&&x.validFrom<old.expiresAt&&(old.templateIds.some(id=>x.templateIds.includes(id))||old.mentionKey&&old.mentionKey===x.mentionKey)))];
}
export function applyIntentionChanges(engine,request){
 const changes=request.intentionChanges;if(!Array.isArray(changes)||changes.length>6)throw Error('意向调整须为最多6项的数组');
 const fingerprint=createHash('sha256').update(JSON.stringify(changes)).digest('hex'),ledger=engine.read('intention-change-receipts.json',{version:1,receipts:{}}),saved=ledger.receipts?.[request.id];
 if(ledger.version!==1||!ledger.receipts||Array.isArray(ledger.receipts)||typeof ledger.receipts!=='object')throw Error('意向调整回执协议不兼容');
 if(saved){if(saved.fingerprint!==fingerprint)throw Error('同一独处记录不能替换已提交的意向调整');return {...saved.result,replayed:true};}
 const result={accepted:[],rejected:[]},now=engine.now(),content=structuredClone(engine.content||{}),items=content.intentions||[],seen=new Set();
 for(const change of changes){try{
  if(!change||typeof change.id!=='string'||seen.has(change.id))throw Error('意向编号无效或重复');seen.add(change.id);
  if(!['lower','raise','cancel'].includes(change.action)||!Number.isFinite(change.priority)||change.priority<0||change.priority>2||!safe(change.reason))throw Error('只能调低、调高或取消，且须提供理由');
  const item=items.find(x=>x.id===change.id);if(!item)throw Error('意向已不存在或已被新安排替换');
  const previous=item.lastAdjustment;if(previous?.requestId===request.id&&previous.fingerprint===fingerprint){result.accepted.push({id:item.id,priority:item.priority,cancelled:!!item.cancelledAt,replayed:true});continue;}
  const live=intentionView(engine,now).find(x=>x.id===item.id);
  if(!engine.config.lifePlanningEnabled||!live||live.status==='linked')throw Error('意向已失效、关闭或已关联实际事件');
  if(change.generatedAt!==item.generatedAt||change.expectedRevision!==(item.revision||0))throw Error('意向版本已变化，需重新读取');
  if(change.action==='lower'&&change.priority>=item.priority||change.action==='raise'&&change.priority<=item.priority||change.action==='cancel'&&change.priority!==0)throw Error('调整方向不一致');
  item.priority=change.priority;item.revision=(item.revision||0)+1;item.adjustedAt=now;item.adjustmentReason=change.reason;item.adjustmentSource=request.id;item.cancelledAt=change.action==='cancel'?now:null;item.lastAdjustment={requestId:request.id,fingerprint};
  result.accepted.push({id:item.id,priority:item.priority,cancelled:!!item.cancelledAt});
 }catch(error){result.rejected.push({id:change?.id||null,reason:error.message});}}
 if(result.accepted.length){if(typeof engine.persistContent!=='function')throw Error('生活内容尚未挂载，意向调整稍后重试');engine.content=content;engine.persistContent();}
 ledger.receipts[request.id]={fingerprint,result,at:now};ledger.receipts=Object.fromEntries(Object.entries(ledger.receipts).slice(-300));engine.write('intention-change-receipts.json',ledger);return result;
}
