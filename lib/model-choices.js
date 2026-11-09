// Record explicit model decisions, never infer intent from prose or from errors.
export function modelChoices(value,feature=''){
 const out=[],yes=new Set(['proceed','act','attend','offer','share','use','allow','consider']),no=new Set(['skip','private','record','wait','defer','later','block']),unknown=new Set(['uncertain','confused']);
 const walk=(v,where,depth)=>{if(!v||typeof v!=='object'||depth>4||out.length>=40)return;
  for(const field of ['choice','decision','initiativeDecision','shareDecision']){const d=v[field];if(typeof d!=='string')continue;const state=yes.has(d)?'proceed':no.has(d)?'skip':unknown.has(d)?'uncertain':null;if(!state)continue;out.push({category:['qq-grounding','memory-review','persona-learning','semantic-mentions','diagnostic','inner-host'].includes(feature)?'review':'initiative',path:where,field,raw:d,state,reason:String(v.reason||'').replace(/(?:AIza[\w-]+|sk-[\w-]+)/g,'[redacted]').slice(0,300),nextMinutes:v.revisitMinutes??v.nextMinutes??v.delayMinutes??null});}
  if(typeof v.wake==='boolean')out.push({category:'initiative',path:where,field:'wake',raw:v.wake,state:v.wake?'proceed':'skip',reason:String(v.reason||v.judgment||'').replace(/(?:AIza[\w-]+|sk-[\w-]+)/g,'[redacted]').slice(0,300),nextMinutes:null});
  if(Array.isArray(v))v.slice(0,40).forEach((x,i)=>walk(x,where+'['+i+']',depth+1));else for(const [k,x] of Object.entries(v))if(x&&typeof x==='object')walk(x,where+'.'+k,depth+1);
 };walk(value,'result',0);return out;
}
