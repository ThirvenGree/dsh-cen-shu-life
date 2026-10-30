import fs from 'node:fs';
import path from 'node:path';
import {clock} from './engine.js';
const sid=x=>String(x||'').replace(/^session-/,'');
export function qqDayActivity(home,sessionIds,now,timezone){
  const rows=[],file=path.join(home,'cen-shu-life/qq-activity-v1.json');
  const fail=(code,message)=>{rows.health={ready:false,code,message};return rows;};
  let source;try{source=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fail('unavailable','QQ bridge 生活数据接口缺失或无法读取，请更新并启动 bridge');}
  if(source.contract!=='qq-bridge/life-activity'||source.version!==1||!['ms','s'].includes(source.timeUnit)||!Array.isArray(source.bindings)||!Array.isArray(source.messages)||!source.firstByDay||typeof source.firstByDay!=='object'||Array.isArray(source.firstByDay))return fail('incompatible','QQ bridge 生活接口协议不兼容，需要重新适配');
  const updatedAt=source.timeUnit==='s'?source.updatedAt*1000:source.updatedAt;
  if(!Number.isFinite(updatedAt)||updatedAt>now+60000||now-updatedAt>180000)return fail('stale','QQ bridge 生活接口心跳异常或超过3分钟未更新');
  const bound=new Set(sessionIds.map(sid));if(!source.bindings.some(x=>x&&typeof x.sessionId==='string'&&bound.has(sid(x.sessionId))))return fail('unbound','QQ bridge 生活接口未绑定当前岑舒会话');
  const today=clock(now,timezone).date,seen=new Set();let skippedRows=0,validRows=0;
  for(const m of [...Object.values(source.firstByDay),...source.messages]){
    if(!m||typeof m.sessionId!=='string'||!m.sessionId||!['sent','received'].includes(m.direction)||(m.messageId==null&&!(m.direction==='sent'&&typeof m.receiptId==='string'&&m.receiptId.trim()))||!['string','number'].includes(typeof(m.messageId??m.receiptId))||!String(m.messageId??m.receiptId).trim()){skippedRows++;continue;}
    const raw=Number(m.at),at=source.timeUnit==='s'?raw*1000:raw;
    if(!['number','string'].includes(typeof m.at)||!Number.isSafeInteger(at)||at<946684800000||at>=4102444800000){skippedRows++;continue;}
    validRows++;
    if(!bound.has(sid(m.sessionId))||at>now||clock(at,timezone).date!==today)continue;
    const key=sid(m.sessionId)+':'+(m.messageId??m.receiptId)+':'+m.direction;if(seen.has(key))continue;seen.add(key);
    rows.push({at,messageId:m.messageId==null?null:String(m.messageId),...(m.receiptId?{receiptId:String(m.receiptId)}:{}),direction:m.direction,sessionId:m.sessionId,text:String(m.text||'').slice(0,500)});
  }
  rows.sort((a,b)=>a.at-b.at);
  // Every record rejected usually means a bridge-side publishing fault (e.g. wrong time unit), not a quiet day.
  if(skippedRows&&!validRows){rows.health={ready:true,warning:true,code:'all-invalid',message:'QQ bridge 生活接口 v1 可读取，但全部 '+skippedRows+' 条记录无效，请检查 bridge 发布的数据（如时间单位 '+source.timeUnit+'、消息 ID）',skippedRows,validRows,updatedAt};return rows;}
  rows.health={ready:true,code:skippedRows?'partial':'ready',message:'QQ bridge 生活接口 v1 正常 · 显式时间单位 '+source.timeUnit,skippedRows,validRows,updatedAt};return rows;
}
export function pickDrawingTime(now,startMinutes,endMinutes,random=Math.random,timezone='Asia/Shanghai'){
  if(!Number.isFinite(startMinutes)||!Number.isFinite(endMinutes)||startMinutes<60||endMinutes<startMinutes||endMinutes>1440)throw Error('画画时间窗口无效');
  const c=clock(now,timezone),midnight=now-(Number(c.hour)*60+Number(c.minute)%60)*60000-now%60000;
  const start=now+startMinutes*60000,end=now+endMinutes*60000,segments=[];
  for(let d=0;d<3;d++){const lo=Math.max(start,midnight+d*86400000+6*3600000),hi=Math.min(end,midnight+d*86400000+23*3600000-1);if(hi>=lo)segments.push([lo,hi]);}
  const unit=()=>Math.max(0,Math.min(.999999999,Number(random())||0));
  if(!segments.length){const after=clock(start,timezone),base=start-(Number(after.hour)*60+Number(after.minute)%60)*60000-start%60000;return base+(Number(after.hour)>=23?86400000:0)+6*3600000+Math.floor(unit()*120*60000);}
  const total=segments.reduce((n,[lo,hi])=>n+hi-lo+1,0);let draw=Math.floor(unit()*total);
  for(const[lo,hi]of segments){const length=hi-lo+1;if(draw<length)return lo+draw;draw-=length;}
  return segments.at(-1)[1];
}
export const drawingScheduleSchema={type:'object',additionalProperties:false,required:['startMinutes','endMinutes','skipToday','reason'],properties:{startMinutes:{type:'integer',minimum:60,maximum:1440},endMinutes:{type:'integer',minimum:60,maximum:1440},skipToday:{type:'boolean'},reason:{type:'string',maxLength:200}}};
export const drawingSchedulePrompt='只规划岑舒下次何时再考虑画画灵感，不生成灵感、不发消息。当天第一条真实QQ收发消息只是清醒互动的起点，不要求每天画画。结合输入当前对话、生活事件、心情、近期灵感和起点，动态给出距现在至少60分钟、至多1440分钟的窗口 startMinutes/endMinutes，结束须晚于开始至少15分钟；窗口宽度、间隔都可变化，不总选最短或整点。系统将在窗口内随机选一个具体时刻并保存。也可skipToday=true，表示当天不再自发考虑。理由限200字，只用已有记录，不把无回复当作睡着，不改作息、事件额度、冷却或人设。';
