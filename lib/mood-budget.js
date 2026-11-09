// 2026-11-07：每天的生活心情事件上限交给模型动态决定（原来固定 lifeMoodDailyLimit=8）。
// 今天已经有多少事件、都是什么、她此刻的心情和时间段——由 Gemini 判断今天还该让多少事情影响心情（4～24）。
// 每 3 小时最多调一次；快用满时（剩 1 个以内）提前再问一次。模型不可用时沿用今天上次的结论，再没有就用设置里的固定值。
import {googleStructured} from './situation.js';

export const BUDGET_BOUNDS=[4,24],TUNE_EVERY_MS=3*3600000,NEAR_FULL_MS=30*60000;
export const BUDGET_SYSTEM='你替岑舒的生活插件决定：今天还该让多少件事影响她的心情。生活里的事（刷视频、日常事件、独处后的感受等）每件都会让心情变一点；'+
 '太少会显得麻木，太多会让心情被琐事来回拉扯。看今天已经发生的事、她此刻的心情和时间段，给出今天的总上限（包含已经用掉的），并用一句中文说明理由。'+
 '平静、事情少的日子可以少一些；经历丰富、情绪起伏大、或者正处在需要被小事安慰的时候可以多一些。';
export const BUDGET_SCHEMA={type:'object',additionalProperties:false,required:['limit','reason'],properties:{limit:{type:'integer'},reason:{type:'string'}}};

export class MoodBudget{
 constructor(engine,{generate=googleStructured}={}){this.engine=engine;this.generate=generate;this.busy=null;}
 day(){try{return this.engine.moodDay();}catch{return new Date(this.engine.now()).toISOString().slice(0,10);}}
 record(){return this.engine.read('mood-budget.json',{});}
 /** 今天的上限：模型今天的结论，否则设置里的固定值。 */
 limit(day=this.day()){const r=this.record();const fixed=Number(this.engine.config.lifeMoodDailyLimit)||8;return r.day===day&&Number.isInteger(r.limit)?r.limit:fixed;}
 used(day=this.day()){try{return this.engine.moodUsed(day);}catch{return 0;}}
 status(){const r=this.record(),day=this.day();return {day,limit:this.limit(day),used:this.used(day),reason:r.day===day?r.reason||'':'今天还没有模型结论，使用设置里的固定值',at:r.day===day?r.at||null:null,source:r.day===day&&r.source?r.source:'config'};}
 maybeTune({signal,force=false}={}){
  if(this.busy)return this.busy;
  const e=this.engine;if(!e.config.enabled||!e.config.lifeMoodEnabled||!e.config.moodLinked||!e.config.semanticEnabled)return Promise.resolve(null);
  const r=this.record(),day=this.day(),used=this.used(day),limit=this.limit(day),age=e.now()-(r.day===day?r.at||0:0);
  const nearFull=used>=limit-1&&age>=NEAR_FULL_MS;
  if(!force&&r.day===day&&age<TUNE_EVERY_MS&&!nearFull)return Promise.resolve(null);
  this.busy=(async()=>{
   try{
    const today=(e.moodEvents?.events||[]).filter(x=>x.day===day).slice(-30).map(x=>({at:new Date(x.at).toISOString().slice(11,16),name:x.name,template:x.templateId,label:x.reaction?.label||''}));
    let mood=null;try{mood=e.state?.mode?{mode:e.state.mode.id}:null;}catch{}
    const raw=await this.generate(BUDGET_SYSTEM,BUDGET_SCHEMA,{day,now:new Date(e.now()).toISOString(),used,currentLimit:limit,fixedDefault:Number(e.config.lifeMoodDailyLimit)||8,bounds:BUDGET_BOUNDS,today,mood},e.config,{feature:'mood-budget',signal:signal||AbortSignal.timeout(20000)});
    const n=Math.round(Number(raw?.limit));if(!Number.isFinite(n))throw Error('心情上限格式无效');
    const next={day,limit:Math.min(BUDGET_BOUNDS[1],Math.max(BUDGET_BOUNDS[0],Math.max(n,used))),reason:String(raw?.reason||'').slice(0,200),at:e.now(),source:'model'};
    e.write('mood-budget.json',next);e.log('今天的心情事件上限按模型调为 '+next.limit+'（'+next.reason+'）');return next;
   }catch(error){e.write('mood-budget.json',{...(r.day===day?r:{day}),at:e.now(),lastError:String(error?.message||error).slice(0,160)});return null;}
   finally{this.busy=null;}
  })();
  return this.busy;
 }
}
