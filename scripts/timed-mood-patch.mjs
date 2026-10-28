export function patchTimedMood(source){
 source=patchLifeStep(source).replace('offs.push(ctx.interval(ordinaryMoodTick,3000));ordinaryMoodTick()','offs.push(ctx.interval(ordinaryMoodTick,3000))');
 source=source.replace("recordLifeMoodReceipts(s,delta);saveState(key,s)\n        diag('生活事件独立判断","recordLifeMoodReceipts(s,delta);if(step===0&&!anyDim){s.lastReason=delta.reason;s.lastConfidence=delta.confidence;s.updatedAt=Date.now()}saveState(key,s)\n        diag('生活事件独立判断");
 if(source.includes('// cen-shu-life ordinary-native v1'))return source;
 if(source.includes('// cen-shu-life timed-native v1'))return patchOrdinaryMood(source);
 const anchor='    // 3) 把心情告诉她';
 if(!source.includes(anchor))throw Error('原心情定时适配位置不兼容');
 source=source.replace("readLifeFeedback } from 'dsh-cen-shu-life/mood-link'","readLifeFeedback, readTimedMoodDelta } from 'dsh-cen-shu-life/mood-link'");
 const at=source.indexOf(anchor);
 const patch=`    // cen-shu-life timed-native v1
    let timedQueued=false,timedRetryAt=0
    const timedMoodTick=()=>{
      if(timedQueued||Date.now()<timedRetryAt||!stillBound()||!censhuBound(sid))return
      const key=当前键(),version=judgeVersion,resetVersion=resetVersions.get(key)
      if(!readTimedMoodDelta(CFG_DIR,sid,key,loadState(key)))return
      timedQueued=true
      judgeChain=judgeChain.then(()=>{
        if(!stillBound()||version!==judgeVersion||resetVersion!==resetVersions.get(key))return
        const s=getState(key,cfg.moodBase,{persist:false,halfHours:cfg.decayHalfHours})
        const delta=readTimedMoodDelta(CFG_DIR,sid,key,s);if(!delta)return
        const step=lifeAwareMoodStep(delta),anyDim=DIMS.some(([k])=>delta.dims[k]!==0)
        if(step!==0||anyDim)applyDelta(s,delta,cfg.moodFloor,true)
        recordLifeMoodReceipts(s,delta);saveState(key,s)
        diag('Gemini定时生活事件已更新真实心情：'+delta.lifeAcceptedIds.length+'项')
      }).catch(e=>{timedRetryAt=Date.now()+60000;diag('定时生活心情保存失败：'+e.message)}).finally(()=>{timedQueued=false})
    }
    offs.push(ctx.interval(timedMoodTick,3000));timedMoodTick()

`;
 return patchOrdinaryMood(source.slice(0,at)+patch+source.slice(at));
}

function patchOrdinaryMood(source){
 const anchor='    // 3) 把心情告诉她';
 const patch=`    // cen-shu-life ordinary-native v1
    let lifeQueued=false,lifeRetryAt=0
    const ordinaryMoodTick=()=>{
      if(lifeQueued||Date.now()<lifeRetryAt||!stillBound()||!censhuBound(sid))return
      const key=当前键(),version=judgeVersion,resetVersion=resetVersions.get(key)
      if(!readLifeMoodInputs(CFG_DIR,sid,key,loadState(key)).length)return
      lifeQueued=true
      judgeChain=judgeChain.then(async()=>{
        const valid=()=>stillBound()&&version===judgeVersion&&resetVersion===resetVersions.get(key)&&censhuBound(sid)
        if(!valid())return
        const batch=readLifeMoodInputs(CFG_DIR,sid,key,loadState(key));if(!batch.length)return
        const judged=await judge(ctx,agent,'本次只判断已有的岑舒生活事件，没有新的青枔发言。','', '',{self:本人名(),owner:对方名(),aliases:cfg.selfAliases,judgeProvider:cfg.judgeProvider,judgeModel:cfg.judgeModel,censhu:true,lifeInputs:batch})
        if(!valid())return
        if(!judged||!judged.life||judged.life.confidence<70)throw Error('生活独立判断未返回可信结论')
        const s=getState(key,cfg.moodBase,{persist:false,halfHours:cfg.decayHalfHours})
        const ids=new Set(batch.map(e=>e.id)),pending=readLifeMoodInputs(CFG_DIR,sid,key,s).filter(e=>ids.has(e.id))
        if(!pending.length)return
        const delta=mergeLifeContribution({...judged,moodDelta:0,dims:Object.fromEntries(DIMS.map(([k])=>[k,0])),reason:''},pending,s)
        if(!delta.lifeAcceptedIds?.length)throw Error('生活独立判断未采纳当前候选')
        const step=lifeAwareMoodStep(delta),anyDim=DIMS.some(([k])=>delta.dims[k]!==0)
        if(step!==0||anyDim)applyDelta(s,delta,cfg.moodFloor,true)
        recordLifeMoodReceipts(s,delta);if(step===0&&!anyDim){s.lastReason=delta.reason;s.lastConfidence=delta.confidence;s.updatedAt=Date.now()}saveState(key,s)
        diag('生活事件独立判断已保存：'+delta.lifeAcceptedIds.length+'项')
      }).catch(e=>{lifeRetryAt=Date.now()+15*60000;diag('生活独立判断延后：'+e.message)}).finally(()=>{lifeQueued=false})
    }
    offs.push(ctx.interval(ordinaryMoodTick,3000))

`;
 if(!source.includes(anchor))throw Error('生活独立判断适配位置不兼容');
 return source.replace(anchor,patch+anchor);
}

function patchLifeStep(source){
 if(source.includes('function lifeAwareMoodStep'))return source;
 const needle='function applyDelta(s, delta, floor, minor) {';
 if(!source.includes(needle))throw Error('生活分值适配位置不兼容');
 source=source.replace(needle,`function lifeAwareMoodStep(delta) {
  const life=Number(delta.lifeContribution?.moodDelta)||0
  return Math.round((delta.moodDelta-life)/MOOD_STEP_DIVISOR)+life
}
`+needle);
 return source.replaceAll('Math.round(delta.moodDelta / MOOD_STEP_DIVISOR)','lifeAwareMoodStep(delta)').replaceAll('Math.round(delta.moodDelta/MOOD_STEP_DIVISOR)','lifeAwareMoodStep(delta)');
}
