import fs from 'node:fs';
import path from 'node:path';
// An observation, not a second source of truth. Never copy credentials or prompts.
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
export function recoverySnapshot(home,at=Date.now()){
 const sources=[],read=relative=>{try{const file=path.join(home,relative),stat=fs.statSync(file);
  const value=JSON.parse(fs.readFileSync(file,'utf8'));sources.push({path:relative,modifiedAt:stat.mtimeMs});return value;
 }catch(e){sources.push({path:relative,unavailable:e.code||'invalid-json'});return {};}};
 const life=read('cen-shu-life/state.json'),agency=read('censhu-agency/state.json'),current=read('censhu-agency/current.json'),inner=read('censhu-inner-life/state.json'),mood=read('feiyu-mood/state.json');
 return {at,sources,
  moods:Object.entries(mood.moods||{}).map(([key,value])=>({key,...pick(value,['mixedMood','mixedMoodStatus','moodNotice','backgroundStatus','lastReason','updatedAt'])})),
  activity:pick(current,['at','until','activity','thought','energy','judgment','focusEventId','attentionCue']),
  events:(life.active||[]).map(x=>pick(x,['id','name','stage','stageText','startedAt','endsAt','reaction'])),
  intentions:(agency.notes||[]).map(x=>pick(x,['id','text','intent','reason','why','due','when','eventId','sourceRefs','resume','triggerCue','cancelWhen','notBefore','expiresAt','revision','status'])),
  choice:pick(agency.choice,['thread','run','phase','at','retryAt','eventIds','actionStarted','needsVerification']),
  pending:pick(agency.pending,['run','phase','at']),
  inner:pick(inner,['status','nextAt','retryAt','error']),
  attempt:pick(inner.attempt,['id','phase','startedAt']),
  notice:'仅表示保存时的状态；停止期间没有执行回执的事不能视为已完成。完整原记录仍保留在对应插件。'};
}
