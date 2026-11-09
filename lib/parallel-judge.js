// 2026-11-07：整体的“要不要分头处理”判断（Terra：gpt-6.1-terra，密钥用本机环境变量 OPENAI_API_KEY）。
// 她手上同时有几件事时，判断哪些可以交给子代理并行做、哪些她自己按顺序做。
// 只给建议，开不开子代理仍由她决定；判断失败时返回 null，调用方退回“由她自己判断”的提示。
import {terraReview} from './terra-review.js';

export const MAX_TASKS=20,MAX_GROUPS=4;

export const PARALLEL_SYSTEM='你替岑舒判断：她眼下手上的这些事，要不要分给子代理并行处理。子代理会带着她此刻的全部状态（只读），按她的身份去做，结果交回她。'+
 '只有当几件事互不依赖、各自能独立做完、并且同时做明显更及时（比如好几个人都在等回复）时才分；'+
 '同一个人的多条消息、前后相关的事、需要她统一口径或亲自拿主意的事（感情、承诺、冲突、隐私）放在一起或留给她自己；只有一两件轻松的事也不用分。'+
 '最多分 '+MAX_GROUPS+' 组，每组交给一个子代理，写一句交代（brief）说明这组要做什么、注意什么。keepSelf 是留给她自己做的事的编号。编号从 0 开始，对应输入 tasks 的下标。reason 用一句中文说明理由。';

export const PARALLEL_SCHEMA={type:'object',additionalProperties:false,required:['parallel','reason','groups','keepSelf'],properties:{
 parallel:{type:'boolean'},reason:{type:'string'},
 groups:{type:'array',items:{type:'object',additionalProperties:false,required:['label','tasks','brief'],properties:{label:{type:'string'},tasks:{type:'array',items:{type:'integer'}},brief:{type:'string'}}}},
 keepSelf:{type:'array',items:{type:'integer'}}}};

/** 核对模型输出：编号在范围内、不重复，组数有上限；没被分组也没留给她的，归到她自己。 */
// 2026-11-07：任务可以带上“是谁的事”（who）和“要用什么”（resource：page 抖音专用页面 / chat 私信服务 / none）。
// 同一个人的事必须放在一起；要用专用页面的事同一时间只能有一个子代理（页面租用会让其他的排队）。
export const RESOURCES=['page','chat','none'];
export function normalizeTasks(tasks){
 if(!Array.isArray(tasks))throw Error('tasks 需要是列表');
 const list=tasks.slice(0,MAX_TASKS).map(t=>typeof t==='string'?{text:t}:{text:String(t?.text||''),who:t?.who?String(t.who).slice(0,60):'',resource:RESOURCES.includes(t?.resource)?t.resource:''});
 if(list.some(t=>!t.text.trim()))throw Error('tasks 需要是非空的话');
 return list.map(t=>({...t,text:t.text.trim().slice(0,600)}));
}

/** 不用模型就能定的情况：只有一件；都是同一个人的；每组都要用同一个专用页面（同时开也只能排队）。 */
export function prefilter(list){
 const self=reason=>({parallel:false,reason,groups:[],keepSelf:list.map((_,i)=>i),model:null,rule:true});
 if(list.length<2)return self('只有一件事，自己做就好');
 const byWho=new Map();list.forEach((t,i)=>{const k=t.who?'who:'+t.who:'task:'+i;byWho.set(k,[...(byWho.get(k)||[]),i]);});
 const groups=[...byWho.values()];
 if(groups.length<2)return self('都是同一个人的事，放在一起自己按顺序做');
 if(groups.every(g=>g.some(i=>list[i].resource==='page')))return self('这些都要用同一个抖音页面，开子代理也只能排队，按顺序自己做更快');
 return null;
}

/** 核对模型输出：编号在范围内、不重复，组数有上限；同一个人的事并到同一组；用页面的组最多一个；没被分组也没留给她的，归到她自己。 */
export function normalizeDecision(raw,count,list=[]){
 if(!raw||typeof raw!=='object'||typeof raw.parallel!=='boolean')throw Error('分头判断格式无效');
 const used=new Set();let groups=[];
 for(const g of Array.isArray(raw.groups)?raw.groups:[]){
  const tasks=[...new Set((Array.isArray(g?.tasks)?g.tasks:[]).filter(i=>Number.isInteger(i)&&i>=0&&i<count&&!used.has(i)))];
  if(!tasks.length||groups.length>=MAX_GROUPS)continue;
  tasks.forEach(i=>used.add(i));
  groups.push({label:String(g.label||'第 '+(groups.length+1)+' 组').slice(0,40),tasks,brief:String(g.brief||'').slice(0,300)});
 }
 if(list.length===count){
  // 同一个人的事被拆到不同组时并回第一组；她自己留的那件也一起交出去或一起留下。
  for(let i=0;i<count;i++){const who=list[i].who;if(!who)continue;const same=[...Array(count).keys()].filter(j=>list[j].who===who);
   const home=groups.find(g=>g.tasks.some(j=>same.includes(j)));if(!home)continue;
   for(const g of groups)if(g!==home)g.tasks=g.tasks.filter(j=>!same.includes(j));
   for(const j of same)if(!home.tasks.includes(j)){home.tasks.push(j);used.add(j);}}
  // 用专用页面的组只留一个，其他用页面的任务留给她自己按顺序做。
  let pageGroup=null;for(const g of groups){if(!g.tasks.some(i=>list[i].resource==='page'))continue;if(!pageGroup){pageGroup=g;continue;}const moved=g.tasks.filter(i=>list[i].resource==='page');g.tasks=g.tasks.filter(i=>list[i].resource!=='page');moved.forEach(i=>used.delete(i));}
  groups=groups.filter(g=>g.tasks.length);
 }
 const parallel=raw.parallel===true&&groups.length>=1&&(groups.length>=2||used.size<count);
 const keepSelf=[...Array(count).keys()].filter(i=>!parallel||!used.has(i));
 return {parallel,reason:String(raw.reason||'').slice(0,200),groups:parallel?groups:[],keepSelf,model:'gpt-6.1-terra'};
}

/** tasks：每件事一句话，或 {text, who, resource}。state：她此刻的状态摘要（字符串，可空）。 */
export async function judgeParallel({tasks,state='',context='',config={},review=terraReview,signal}={}){
 const list=normalizeTasks(tasks);
 const ruled=prefilter(list);if(ruled)return ruled;
 const raw=await review(PARALLEL_SYSTEM,PARALLEL_SCHEMA,{tasks:list.map(t=>t.text),who:list.map(t=>t.who||''),resources:list.map(t=>t.resource||'none'),
  rules:'同一个 who 的事必须在同一组或都留给她；resource=page 的事同一时间只能有一个子代理做（专用页面只有一个）；chat 的事可以并行（私信服务自己排队发送）。',
  context:String(context||'').slice(0,1500),herState:String(state||'').slice(0,6000),now:new Date().toISOString()},config,{feature:'parallel-judge',signal:signal||AbortSignal.timeout(45000),maxOutputTokens:4000});
 return normalizeDecision(raw,list.length,list);
}

/** 把判断写成给她看的一段话。 */
export function decisionText(decision,labels=[]){
 if(!decision)return '';
 const name=i=>labels[i]?'「'+String(labels[i]).slice(0,40)+'」':'第 '+(i+1)+' 件';
 if(!decision.parallel)return '【分头判断（Terra）】不建议开子代理：'+decision.reason+'。按顺序自己处理就好。';
 return ['【分头判断（Terra）】建议分头处理：'+decision.reason,
  ...decision.groups.map((g,n)=>'  · 子代理 '+(n+1)+'（'+g.label+'）：'+g.tasks.map(name).join('、')+(g.brief?'——'+g.brief:'')),
  ...(decision.keepSelf.length?['  · 你自己：'+decision.keepSelf.map(name).join('、')]:[]),
  '这只是建议，开不开、怎么分由你决定；开的话用 subagent，每组一个，把上面的交代写进去。'].join('\n');
}
