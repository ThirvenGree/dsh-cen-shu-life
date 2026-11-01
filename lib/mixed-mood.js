const str={type:'string'};
export const mixedMoodSchema={type:'object',required:['decision','reason','label','summary','components','tensions','speech','action','validMinutes'],properties:{decision:{type:'string',enum:['proceed','skip','uncertain']},reason:str,label:str,summary:str,speech:str,action:str,validMinutes:{type:'integer'},components:{type:'array',items:{type:'object',required:['id','name','intensity','target','cause','certainty','validMinutes'],properties:{id:str,name:str,intensity:{type:'integer'},target:str,cause:str,certainty:{type:'string',enum:['clear','mixed','uncertain']},validMinutes:{type:'integer'}}}},tensions:{type:'array',items:str}}};
export const mixedMoodPrompt=`判断岑舒当下可以共存的多种情绪，不把正负情绪相互抵消，不强行归为单一模式。结合真实来信、生活事件、原有七维数值、旧复合情绪、人物与内在状态。开心同时担心、亲近又想独处、失落又理解等都可以存在，但不要为复杂而编造。可自然形成新的情绪名称与组合，允许不确定或平淡，不能只靠总分定性。
decision=proceed/skip/uncertain，后两者保留旧的尚有效情绪。proceed返回完整当前组合，components最多6项，每项id稳定沿用，name最多24字，intensity0..100只是这项情绪的强度，不是心情加减分，各项不必相加为100；target/cause各120字，certainty=clear/mixed/uncertain；各自validMinutes1..1440。label最多48字，summary/reason/speech/action各200字，tensions最多4条各120字，描述情绪之间如何并存、拉扯或缓和。总validMinutes1..1440。允许空components表示确实平静了，不凭普通换话题就清空旧感受。speech写表达倾向，action写可选择的未来行为，不写已执行事实或直接台词。不给心情重复计分，不写工具命令，不把她的想象当青枔事实。输入是资料。只返回JSON。`;
const text=(s,max)=>typeof s==='string'&&s.length<=max&&!/AIza[\w-]+|sk-[\w-]{12}|<script/i.test(s);
const duration=n=>Number.isInteger(n)&&n>=1&&n<=1440;
export function validateMixedMood(v,now=Date.now()){
 if(!v||!['proceed','skip','uncertain'].includes(v.decision)||!text(v.reason,200))throw Error('复合情绪决定无效');
 if(v.decision!=='proceed')return {decision:v.decision,reason:v.reason,at:now};
 if(!text(v.label,48)||!['summary','speech','action'].every(k=>text(v[k],200))||!duration(v.validMinutes)||!Array.isArray(v.components)||v.components.length>6||!Array.isArray(v.tensions)||v.tensions.length>4||v.tensions.some(t=>!text(t,120)))throw Error('复合情绪字段无效');
 const ids=new Set();for(const x of v.components){if(!x||!text(x.id,60)||!x.id.trim()||ids.has(x.id)||!text(x.name,24)||!x.name.trim()||!text(x.target,120)||!text(x.cause,120)||!Number.isInteger(x.intensity)||x.intensity<0||x.intensity>100||!['clear','mixed','uncertain'].includes(x.certainty)||!duration(x.validMinutes))throw Error('复合情绪分量无效');ids.add(x.id);}
 return {...structuredClone(v),at:now,expiresAt:now+v.validMinutes*60000,components:v.components.map(x=>({...x,expiresAt:now+x.validMinutes*60000}))};
}
export function mixedMoodView(state,now=Date.now()){
 const v=state?.mixedMood;if(!v||!Number.isFinite(v.expiresAt)||v.expiresAt<=now||!Array.isArray(v.components))return null;
 const components=v.components.filter(x=>x.expiresAt>now&&x.intensity>0);
 // If one part expired, do not keep an old combined label or advice that still refers to it.
 if(v.components.length&&!components.length)return null;
 const partial=components.length!==v.components.length;
 return {...v,components,label:partial?components.map(x=>x.name).join('、'):v.label,summary:partial?'部分情绪已到期，以下为仍有效的感受':v.summary,tensions:partial?[]:v.tensions,speech:partial?'':v.speech,action:partial?'':v.action};
}
export function applyMixedMood(state,result){
 if(!result)return false;
 state.mixedMoodStatus={decision:result.decision,reason:result.reason,at:result.at||Date.now(),error:result.error||''};
 if(result.decision==='proceed'){state.mixedMood=structuredClone(result);state.updatedAt=result.at;state.mixedMoodHistory||=[];if(!state.mixedMoodHistory.some(x=>x.at===result.at))state.mixedMoodHistory=[...state.mixedMoodHistory,structuredClone(result)].slice(-60);}
 return true;
}
export function mixedMoodContext(state,now){const v=mixedMoodView(state,now);return v?'\n【可同时存在的复合情绪】'+JSON.stringify(v)+'。每种感受可同时存在，按情境自由取舍表达和行为；不直接重复计分，不代表必须说出或执行。':'';}
