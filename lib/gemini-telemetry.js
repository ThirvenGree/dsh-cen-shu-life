import {modelChoices} from './model-choices.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const features={'social-experience':'行动与交流经历 · Gemini 3.8 Flash 理解打算、结果、评论与私信','role-context-budget':'三插件 · 每轮上下文预算与资料排序','inner-method-propose':'独处 · 从经验证经历提炼方法','inner-method-review':'方法记忆 · Terra 独立审核','inner-method-recall':'主动进行 · 按当前目标选择方法候选','agency-situation':'主动进行 · 归拢处境（由主会话选择行动）','mood-numeric':'旧版数值判断（岑舒已停用）','mood-blend':'鱼的心情 · Gemini 3.8 Flash 多种感受、强弱描述、表情与复看安排','inner-question-recall':'带着问题检索日记、收藏与记忆','inner-thought-routing':'想法对象范围与情境选择','inner-interests':'兴趣形成、变化与淡去','inner-thoughts':'对人事物的动态多维想法','inner-state':'动态内在状态、复杂度与矛盾感','timing-rhythm':'跨插件时间、冷却与自然节奏安排','qq-grounding':'QQ发送与记忆事实、时间及表达核验',situation:'对话情境与表达',weather:'联网天气与天气提取','content-evolution':'每日生活内容','drawing-inspiration':'画画灵感与分享审核','life-director':'生活事件与行为决策','memory-review':'记忆审核压缩','memory-selection':'记忆重要性与相关性','memory-writeback':'重要记忆写回','persona-learning':'人物补充提炼与审核','semantic-mentions':'事件提及判断','timed-events':'定时生活事件','inner-core':'独处关注与日记审核','inner-deliberation':'独处表达与分享判断','inner-personal-growth':'生活积累生成与审核','inner-personality':'性格发展提炼','inner-personality-review':'性格发展独立审核 · Terra','inner-host':'独处诊断',shared:'其他插件共享判断',diagnostic:'连接诊断'};
features['request-context-selection']='上下文 · 动态工具、技能与结果选择';
features['reply-expression-desktop']='DSH 桌面 · Argon 单层语句审核';
features['reply-expression-pet']='Pet 双端文字与语音 · Argon 单层语句审核';
features['reply-expression-refine']='DSH 桌面与 Pet · 角色表达修订';
features['knowledge-replay-answer']='长期知识回放 · 作答模型';
features['knowledge-synthesis']='长期知识 · 跨经历归纳';
features['knowledge-synthesis-review']='长期知识 · 归纳独立审核 · Terra';
features['inner-personality-audit']='性格 · 按描述词定期核对';
features['knowledge-failure-attribution']='长期知识回放 · 失败定位';
features['agency-reply-outcome']='主动进行 · 判断来信的回应方式';
features['report-repetition']='只读报告 · 跨天重复判断';
features['report-relationship']='只读报告 · 关系账本整理';
features['probe-reply']='人设探针 · 生成回复';
features['probe-judge']='人设探针 · 评分';
features['report-writeback']='只读报告 · 写回漏记抽查';
features['knowledge-time-range']='长期知识 · 理解时间说法';
features['probe-compare']='人设探针 · 盲选对比';
features['probe-verdict']='人设探针 · 分层去留结论';
features['report-priorities']='只读报告 · 下一步优先级';
features['report-mood-trend']='只读报告 · 心情趋势';
export const telemetryFile=()=>path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'gemini-monitor','calls-'+process.pid+'.json');
let pending=Promise.resolve();
export function diagnosis(e){const code=Number(e?.httpStatus)||0;return code===402?'预付余额不足：检查当前 API key 所属项目是否已充值。':code===429?'额度或速率限制：检查 Google 项目配额、余额及限速。':code===401||code===403?'认证或权限错误：检查 API key、项目权限和地区限制。':code===404?'模型或接口不存在：检查模型 ID 和当前项目是否有访问权限。':code===400?'请求参数不兼容：检查模型支持的参数与 JSON schema。':code>=500?'Google 服务暂时异常，稍后重试。':e?.code==='MODEL_OUTPUT_FORMAT'?'模型未返回有效 JSON；检查输出约束，允许任务重试。':/timeout|abort/i.test(e?.name+' '+e?.message)?'请求超时或被取消，检查代理连接与超时设置。':netCode(e)?'网络连接中断（'+netCode(e)+'）：多为代理或网络瞬断，稍后会自动重试。':'连接或本地配置异常，检查 key 是否设置及本机代理是否运行。';}
// 2026-11-07: undici hides the network reason in e.cause.code ("fetch failed"); keep it, plus a short redacted detail.
export function netCode(e){const c=e?.cause?.code||e?.cause?.cause?.code||(typeof e?.code==='string'&&/^(E[A-Z]+|UND_ERR_\w+)$/.test(e.code)?e.code:'');return typeof c==='string'?c.slice(0,40):'';}
export function errorDetail(e){return String(e?.message||e||'').replace(/AIza[\w-]{10,}|(?:sk|xi)_[\w-]{8,}|Bearer\s+\S+/g,'[隐藏]').replace(/\b(?:wss?|https?):\/\/\S+/gi,'[地址]').replace(/\s+/g,' ').trim().slice(0,120);}
// 2026-11-09: tokens and a prompt fingerprint, so real cost can be read per feature; a trace id ties together the calls of one request or one agency turn.
const traces=new AsyncLocalStorage();
export const withTrace=(id,fn)=>traces.run(String(id),fn);
export const usageOf=value=>{if(!value||typeof value!=='object')return undefined;const out=Object.fromEntries(Object.entries(value).filter(([,n])=>typeof n==='number'));return Object.keys(out).length?out:undefined;};
export function addUsage(meta,value){const usage=usageOf(value);if(!meta||!usage)return;meta.usage||={};for(const [key,n] of Object.entries(usage))meta.usage[key]=(meta.usage[key]||0)+n;}
const OUTPUT_DIAGNOSIS={truncated:'模型输出被截断：思考和正文用完了输出上限。',empty:'模型没有返回内容，原因未说明，可以稍后重试。',blocked:'模型拒绝返回内容：被安全或版权规则拦下，看一下输入内容。'};
const metaRow=meta=>Object.fromEntries(Object.entries({usage:meta.usage,modelVersion:meta.modelVersion,finishReason:meta.finishReason,rounds:meta.rounds,promptHash:meta.promptHash,outputProblem:meta.outputProblem,truncatedRetry:meta.truncatedRetry}).filter(([,v])=>v!==undefined));
// 2026-11-09: per-day totals kept beside the rows, so a long-running process does not lose them to the 500-row limit.
const dayOf=at=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(at);
export function addRollup(rollup,row){const u=row.usage||{},day=dayOf(row.at),key=row.feature+'|'+row.model,cell=((rollup[day]||={})[key]||={calls:0,errors:0,paused:0,cutoff:0,input:0,cached:0,output:0}),input=u.promptTokenCount??u.input_tokens??u.prompt_tokens??0;cell.calls++;if(row.status==='error')cell.errors++;if(row.status==='paused')cell.paused++;if(row.outputProblem||row.truncatedRetry)cell.cutoff++;cell.input+=input;cell.cached+=Math.min(u.cachedContentTokenCount??u.cached_tokens??0,input);cell.output+=(u.candidatesTokenCount??u.output_tokens??u.completion_tokens??0)+(u.thoughtsTokenCount??0);for(const old of Object.keys(rollup).sort().slice(0,-60))delete rollup[old];return rollup;}
export function recordCall(entry){const trace=traces.getStore(),row=trace?{...entry,trace}:entry;pending=pending.catch(()=>{}).then(async()=>{const file=telemetryFile();let data={version:1,rows:[]};try{data=JSON.parse(await fs.promises.readFile(file,'utf8'));}catch{}data.rows=[...(Array.isArray(data.rows)?data.rows:[]),row].slice(-500);data.rollup=addRollup(data.rollup||{},row);await fs.promises.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';await fs.promises.writeFile(tmp,JSON.stringify(data));await fs.promises.rename(tmp,file);}).catch(()=>{});return pending;}
export async function observeGemini(feature,model,fn){const start=Date.now(),meta={};try{const result=await fn(meta);await recordCall({at:Date.now(),feature,model,status:'success',choices:modelChoices(result,feature),durationMs:Date.now()-start,...metaRow(meta)});return result;}catch(e){await recordCall({at:Date.now(),feature,model,status:'error',durationMs:Date.now()-start,...metaRow(meta),httpStatus:e.httpStatus||null,code:e.code||netCode(e)||null,detail:errorDetail(e)||null,diagnosis:OUTPUT_DIAGNOSIS[meta.outputProblem]||diagnosis(e)});throw e;}}
