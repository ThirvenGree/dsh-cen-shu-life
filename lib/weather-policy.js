import fs from 'node:fs';import path from 'node:path';import {weatherPolicyHealth} from './weather-policy-health.js';
import {weatherDay} from './weather.js';
export function weatherOpportunity(home,now=Date.now()){
 try{if(!weatherPolicyHealth(home).ready)return {pending:false,factor:1};const cfg=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life/config.json'),'utf8')),cache=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life/weather-cache.json'),'utf8')),fact=cache.fact;
 if(!cfg.enabled||!cfg.weatherAutoEnabled||!cfg.weatherProactiveEnabled||fact?.date!==weatherDay(now)||fact.checkedAt>now||fact.expiresAt<=now||!fact.sources?.length)return {pending:false,factor:1};
 let state={};try{state=JSON.parse(fs.readFileSync(path.join(home,'characters/censhu/initiative.json'),'utf8'));}catch{}
 const pending=!(state.weatherKeys||[]).includes(fact.key),claimedThisTurn=state.weatherClaim?.key===fact.key&&now>=state.weatherClaim.at&&now-state.weatherClaim.at<60000;return {pending,claimedThisTurn,factor:pending?1.2:1,key:fact.key,date:fact.date,topic:fact.topicHint};
 }catch{return {pending:false,factor:1};}
}
export function weatherInitiativeContext(home,now=Date.now()){
 const w=weatherOpportunity(home,now);return !w.key?'':'\n【天气主动话题候选】'+JSON.stringify({date:w.date,topic:w.topic,alreadyConsidered:!w.pending&&!w.claimedThisTurn,currentClaim:w.claimedThisTurn})+'。完整天气预报与来源由岑舒生活模块提供。天气可影响是否想聊几句；仍遵守作息、当前心情与两套机制共享冷却，不强制说天气，不假设青枔所在地。currentClaim=true 表示本轮刚取得天气机会，可自然选择该话题；alreadyConsidered=true 才表示此前已处理，不主动重复，用户问起可正常回应。';
}
