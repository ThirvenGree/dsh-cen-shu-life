import fs from 'node:fs';
import path from 'node:path';
import {clock} from './engine.js';
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}};
const sid=x=>String(x||'').replace(/^session-/,'');
export function qqDayActivity(home,sessionIds,now,timezone){
  const today=clock(now,timezone).date,rows=[];
  for(const id of sessionIds){
    const cached=read(path.join(home,'storages/session_projcache/sessions','session-'+sid(id)+'.json'));
    const cwd=cached.record?.identity?.cwd;if(!cwd)continue;
    const bindings=read(path.join(cwd,'state/sessions.json')).sessions||{};
    const key=Object.keys(bindings).find(k=>k.startsWith('private:')&&sid(bindings[k])===sid(id));if(!key)continue;
    const messages=read(path.join(cwd,'state/social-v2.json')).conversations?.[key]?.recentMessages;
    for(const m of Array.isArray(messages)?messages:[]){const at=Number(m.time||m.at);
      if(typeof m.isSelf!=='boolean'||m.messageId==null||String(m.messageId)===''||m.failed||m.error||!Number.isFinite(at)||at>now||clock(at,timezone).date!==today)continue;
      rows.push({at,messageId:String(m.messageId),direction:m.isSelf?'sent':'received',sessionId:id,text:String(m.text||'').slice(0,500)});
    }
  }
  return rows.sort((a,b)=>a.at-b.at);
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
