export function patchTimedMood(source){
 if(source.includes('// cen-shu-life timed-native v1'))return source;
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
        const step=Math.round(delta.moodDelta/MOOD_STEP_DIVISOR),anyDim=DIMS.some(([k])=>delta.dims[k]!==0)
        if(step!==0||anyDim)applyDelta(s,delta,cfg.moodFloor,true)
        recordLifeMoodReceipts(s,delta);saveState(key,s)
        diag('Gemini定时生活事件已更新真实心情：'+delta.lifeAcceptedIds.length+'项')
      }).catch(e=>{timedRetryAt=Date.now()+60000;diag('定时生活心情保存失败：'+e.message)}).finally(()=>{timedQueued=false})
    }
    offs.push(ctx.interval(timedMoodTick,3000));timedMoodTick()

`;
 return source.slice(0,at)+patch+source.slice(at);
}
