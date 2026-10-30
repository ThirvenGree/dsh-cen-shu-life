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
 return items.map(item=>{const ids=[],unresolvedNames=[];for(const name of item.templateNames){const matches=templates.filter(t=>t.name===name);if(matches.length===1)ids.push(matches[0].id);else unresolvedNames.push(name);}return {...windowOf(item,generatedAt,batchEnd,timezone),templateIds:[...new Set(ids)],unresolvedNames,generatedAt};});
}
export function intentionView(engine,now=engine.now()){
 if(!engine.config.enabled||!engine.config.contentEvolutionEnabled||!engine.config.lifePlanningEnabled)return [];
 const events=[...engine.state.active,...engine.history.events];
 const stored=engine.activeContent()?.intentions;return (Array.isArray(stored)?stored:[]).filter(x=>x&&safe(x.text)&&Array.isArray(x.templateIds)&&Number.isFinite(x.priority)&&x.priority>=0&&x.priority<=2&&Number.isFinite(x.validFrom)&&Number.isFinite(x.expiresAt)&&x.validFrom<x.expiresAt&&x.expiresAt>now).map(item=>{const linked=events.filter(e=>e.startedAt>=item.generatedAt&&e.intentionIds?.includes(item.id));return {...item,status:linked.length?'linked':item.validFrom>now?'upcoming':'available',linkedEvents:linked.map(e=>({id:e.id,name:e.name,status:e.status}))};});
}
export function intentionChoice(engine,templateId,now=engine.now()){
 const items=intentionView(engine,now).filter(x=>x.status==='available'&&x.templateIds.includes(templateId));
 return {priority:items.length?Math.min(...items.map(x=>x.priority)):1,ids:items.map(x=>x.id),reasons:items.map(x=>x.text)};
}
export function intentionsContext(engine,now){const items=intentionView(engine,now).filter(x=>x.status==='available');return items.length?'\n【当前生活意向，尚未发生】'+JSON.stringify(items.map(x=>({text:x.text,expiresAt:x.expiresAt})))+'。这是可调整、可放弃的打算；不能当作已完成、不能写成经历或据此给心情加分；只有实际生活事件记录或工具结果才表示行动发生。':'';}
