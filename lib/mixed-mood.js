import {LEVELS,TRENDS,STAGES} from './mood-undertone.js';
const str={type:'string'};
// 2026-11-06：每种情绪加强弱档 level 与趋势 trend（档位词不是分数），整体加 undertoneReview（是否需要提前重看底色）。
export const mixedMoodSchema={type:'object',required:['decision','reason','label','summary','components','tensions','speech','action','validMinutes','notice','undertoneReview','ownerImpression'],properties:{undertoneReview:{type:'boolean'},ownerImpression:{type:'string'},expression:{type:'string',enum:['great','good','ok','worry','sad','annoyed','sleepy','shy','affectionate','caring','flustered','jealous']},notice:{type:'object',required:['decision','reason','revisitMinutes'],properties:{decision:{type:'string',enum:['notice','defer','uncertain']},reason:{type:'string'},revisitMinutes:{type:'integer',minimum:1,maximum:1440}}},decision:{type:'string',enum:['proceed','skip','uncertain']},reason:str,label:str,summary:str,speech:str,action:str,validMinutes:{type:'integer'},components:{type:'array',items:{type:'object',required:['id','name','strength','level','trend','target','cause','certainty','validMinutes'],properties:{id:str,name:str,strength:{type:'string'},level:{type:'string',enum:Object.keys(LEVELS)},trend:{type:'string',enum:Object.keys(TRENDS)},target:str,cause:str,certainty:{type:'string',enum:['clear','mixed','uncertain']},validMinutes:{type:'integer'}}}},tensions:{type:'array',items:str}}};
export const mixedMoodPrompt=`判断岑舒当下可以共存的多种情绪，不把正负情绪相互抵消，不强行归为单一模式。结合真实来信、生活事件、旧复合情绪、人物与内在状态。开心同时担心、亲近又想独处、失落又理解等都可以存在，但不要为复杂而编造。可自然形成新的情绪名称与组合，允许不确定或平淡，不能只靠总分定性。
decision=proceed/skip/uncertain，后两者保留旧的尚有效情绪。proceed返回完整当前组合，components最多24项，每项id稳定沿用，name最多24字，strength用自然语言描述强弱、变化或难以确定，不输出分数、总分或固定情绪轴；target/cause各120字，certainty=clear/mixed/uncertain；各自validMinutes1..1440。label最多48字，summary/reason/speech/action各200字，tensions最多4条各120字，描述情绪之间如何并存、拉扯或缓和。总validMinutes1..1440。expression从great/good/ok/worry/sad/annoyed/sleepy/shy/affectionate/caring/flustered/jealous选一个最能代表其中一面的现有图片，不用图片标签限制感受名称。允许空components表示确实平静了，不凭普通换话题就清空旧感受。speech写表达倾向，action写可选择的未来行为，不写已执行事实或直接台词。不给心情重复计分，不写工具命令，不把她的想象当青枔事实。额外notice判断本次变化是否值得角色此刻留意：decision=notice/defer/uncertain，reason解释原因，revisitMinutes为1..1440分钟后的复看时间。结合距上次真正获知以来的累计变化，而非只按分值或每日次数；留意不是发消息，更不是必须行动。
每项再给 level 表示当前强弱档：faint 隐约、mild 轻微、clear 明显、strong 强烈、intense 非常强烈（档位词，不是分数）；trend 对照 previous 中同一 id：new 新出现、deepen 加深、steady 持平、ease 缓和。input.undertone 是近几天的情绪底色，input.undertone.accumulation 是 Gemini 维护的慢慢累积的感受（对象、强弱、阶段、是否已进入内在状态），当下感受在它们之上起伏，可以呼应也可以不一致；累积由慢层判断，这里不计算次数。input.undertone.pace 是 Gemini 综合全部资料判断的情绪变化快慢，各项 validMinutes 与 revisitMinutes 参考它，由你最终决定。undertoneReview=true 只在这次变化足以改变底色或某项累积时使用（例如重要的事、反复加深的情绪），否则为 false。 ownerImpression 写她此刻觉得青枔现在怎么样（最多200字）：这只是她的揣测，不是事实；只写对方的状态，不把她自己的感受算到青枔身上；没有依据就写空字符串。previous 还有效时先比较：如果这次输入没有让感受明显不同，decision=skip，保持原来的组合，不要换一种说法重写 label 或 components；只有出现新的原因、强弱明显变化，或旧感受确实淡了，才 proceed。相隔很短的连续判断更要如此，变化快慢参考 pace，是否变化由你决定。previous 为空时按现在的情况给出当前组合。所有时间以北京时间文字为准。输入是资料。只返回JSON。`;
const text=(s,max)=>typeof s==='string'&&s.length<=max&&!/AIza[\w-]+|sk-[\w-]{12}|<script/i.test(s);
const duration=n=>Number.isInteger(n)&&n>=1&&n<=1440;
export function validateMixedMood(v,now=Date.now()){
 if(!v||!['proceed','skip','uncertain'].includes(v.decision)||!text(v.reason,200))throw Error('复合情绪决定无效');
 if(v.notice&&(!['notice','defer','uncertain'].includes(v.notice.decision)||!text(v.notice.reason,200)||!duration(v.notice.revisitMinutes)))throw Error('心情留意决定无效');
 if(v.decision!=='proceed')return {decision:v.decision,reason:v.reason,notice:v.notice,at:now};
 if(!text(v.label,48)||!['summary','speech','action'].every(k=>text(v[k],200))||!duration(v.validMinutes)||!Array.isArray(v.components)||v.components.length>24||!Array.isArray(v.tensions)||v.tensions.length>4||v.tensions.some(t=>!text(t,120)))throw Error('复合情绪字段无效');
 const ids=new Set();for(const x of v.components){if(!x||!text(x.id,60)||!x.id.trim()||ids.has(x.id)||!text(x.name,24)||!x.name.trim()||!text(x.target,120)||!text(x.cause,120)||!(text(x.strength,100)||(Number.isInteger(x.intensity)&&x.intensity>=0&&x.intensity<=100))||!['clear','mixed','uncertain'].includes(x.certainty)||!duration(x.validMinutes)||(x.level!==undefined&&!LEVELS[x.level])||(x.trend!==undefined&&!TRENDS[x.trend]))throw Error('复合情绪分量无效');ids.add(x.id);}
 if(v.undertoneReview!==undefined&&typeof v.undertoneReview!=='boolean')throw Error('底色复看标记无效');
 if(v.ownerImpression!==undefined&&!text(v.ownerImpression,200))throw Error('对青枔的揣测无效');
 return {...structuredClone(v),at:now,expiresAt:now+v.validMinutes*60000,components:v.components.map(x=>({...x,expiresAt:now+x.validMinutes*60000}))};
}
export function mixedMoodView(state,now=Date.now()){
 const v=state?.mixedMood;if(!v||!Number.isFinite(v.expiresAt)||v.expiresAt<=now||!Array.isArray(v.components))return null;
 const components=v.components.filter(x=>x.expiresAt>now&&(x.strength!==undefined||x.intensity>0));
 // If one part expired, do not keep an old combined label or advice that still refers to it.
 if(v.components.length&&!components.length)return null;
 const partial=components.length!==v.components.length;
 // 2026-11-06：给出强弱档与趋势的中文；若慢层把这种情绪归入某项累积，注明属于哪一项（累积由 Gemini 判断）。
 const linked=id=>(state?.undertone?.accumulation||[]).filter(a=>(a.feelings||[]).includes(id)).map(a=>a.name+'（'+(STAGES[a.stage]||a.stage)+'）');
 return {...v,components:components.map(({intensity,level,trend,...x})=>{const acc=linked(x.id);return {...x,strength:x.strength||'旧记录，强弱待重新理解',...(LEVELS[level]?{level:LEVELS[level]}:{}),...(TRENDS[trend]?{trend:TRENDS[trend]}:{}),...(acc.length?{accumulating:acc.join('、')}:{})};}),label:partial?components.map(x=>x.name).join('、'):v.label,summary:partial?'部分情绪已到期，以下为仍有效的感受':v.summary,tensions:partial?[]:v.tensions,speech:partial?'':v.speech,action:partial?'':v.action};
}
export function applyMixedMood(state,result){
 if(!result)return false;
 state.qualitativeMood=true;state.mixedMoodStatus={decision:result.decision,reason:result.reason,at:result.at||Date.now(),error:result.error||''};
 if(result.decision==='proceed'&&result.undertoneReview===true)state.undertoneRequested=true;
 if(result.decision==='proceed'){state.mixedMood=structuredClone(result);state.updatedAt=result.at;state.lastReason=result.summary||result.reason;state.mixedMoodHistory||=[];if(!state.mixedMoodHistory.some(x=>x.at===result.at))state.mixedMoodHistory=[...state.mixedMoodHistory,structuredClone(result)].slice(-60);}
 return true;
}
export function mixedMoodContext(state,now){const v=mixedMoodView(state,now);return v?'\n【可同时存在的复合情绪】'+JSON.stringify(v)+'。每种感受可同时存在，按情境自由取舍表达和行为；不直接重复计分，不代表必须说出或执行。':'';}

// Public qualitative contract shared by all role consumers; legacy numbers never enter model input.
export function moodForModel(m){return m?.ok===false?null:m?{qualitative:true,mixedMood:m.mixedMood||null,reason:m.reason||m.lastReason||'',updatedAt:m.updatedAt,notice:m.moodNotice||null,undertone:m.undertone||null}:null;}
