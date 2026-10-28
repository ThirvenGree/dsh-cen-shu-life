// Publishing is an optional action of a real lifecycle record, never a mood event.
export class EventSharing {
  constructor(engine) {
    this.engine=engine;
    this.record=engine.read('event-sharing.json',{version:1,initialized:false,baseline:[],items:[]});
    if(this.record.version!==1||!Array.isArray(this.record.items)||!Array.isArray(this.record.baseline)||this.record.items.some(x=>!x?.eventId||!Array.isArray(x.phases))){engine.backup('event-sharing.json');this.record={version:1,initialized:false,baseline:[],items:[]};engine.log('事件空间联动记录无效，已备份后恢复');}
    engine.qzoneSharing=this;
  }
  save(){this.engine.write('event-sharing.json',this.record);}
  sync(){
    const e=this.engine,now=e.now();let dirty=false;
    if(!this.record.initialized){this.record.baseline=e.history.events.map(x=>x.id);this.record.initialized=true;dirty=true;}
    const candidates=[...e.state.active,...e.history.events.filter(x=>!this.record.baseline.includes(x.id))];
    for(const event of candidates){
      if(!event.id||(event.status==='ended'&&now-(event.endedAt||event.startedAt)>86400000))continue;
      const phase=event.status==='ended'?'end':event.stage>0?'stage':'start';
      let item=this.record.items.find(x=>x.eventId===event.id);
      if(!item){item={eventId:event.id,name:event.name,status:'pending',createdAt:now,expiresAt:now+86400000,phases:[]};this.record.items.push(item);dirty=true;}
      const signature=phase+':'+(event.stage||0);
      if(!item.phases.some(x=>x.signature===signature)){
        item.phases.push({signature,phase,stage:event.stage||0,text:event.stageText,at:phase==='end'?event.endedAt:now});
        if(item.status==='expired'){item.status='pending';item.expiresAt=now+86400000;}
        item.name=event.name;item.updatedAt=now;dirty=true;
      }
      if(item.expiresAt<=now&&['pending','deferred'].includes(item.status)){item.status='expired';dirty=true;}
    }
    for(const item of this.record.items)if(item.expiresAt<=now&&['pending','deferred'].includes(item.status)){item.status='expired';dirty=true;}
    if(this.record.items.length>300){this.record.items=this.record.items.slice(-300);dirty=true;}
    if(dirty)this.save();
  }
  view(){
    const now=this.engine.now();
    return {version:1,items:structuredClone(this.record.items.slice(-50).reverse()),eligible:structuredClone(this.record.items.filter(x=>['pending','deferred'].includes(x.status)&&x.expiresAt>now&&(!x.deferUntil||x.deferUntil<=now)).slice(-6))};
  }
  decide({eventId,decision,reason='',delayMinutes=30}){
    if(!this.engine.config.enabled)throw Error('生活插件已关闭');
    const item=this.record.items.find(x=>x.eventId===eventId),now=this.engine.now();
    if(!item||item.expiresAt<=now)throw Error('事件分享机会不存在或已过期');
    if(item.status==='published')throw Error('这件事已经发过空间');
    if(!['consider','defer','skip'].includes(decision)||typeof reason!=='string'||reason.length>200)throw Error('分享判断无效');
    if(decision==='defer'&&(!Number.isFinite(delayMinutes)||delayMinutes<1||delayMinutes>1440))throw Error('暂缓时间须为1至1440分钟');
    item.status=decision==='skip'?'skipped':decision==='defer'?'deferred':'pending';item.reason=reason;item.decidedAt=now;
    item.deferUntil=decision==='defer'?Math.min(item.expiresAt,now+delayMinutes*60000):null;this.save();return structuredClone(item);
  }
  receipt({eventIds,tid,url,at}){
    if(!Array.isArray(eventIds)||!eventIds.length||eventIds.length>6||typeof tid!=='string'||!tid||!Number.isFinite(at))throw Error('空间发布回执无效');
    const items=eventIds.map(id=>this.record.items.find(x=>x.eventId===id));
    if(items.some(x=>!x))throw Error('回执关联的生活事件不存在');
    if(items.some(x=>x.status==='published'&&x.publication?.tid!==tid))throw Error('生活事件已经关联其他说说');
    for(const item of items){item.status='published';item.publication={tid,url:String(url||''),at};item.deferUntil=null;}
    this.save();return this.view();
  }
  context(){
    if(!this.engine.config.enabled)return '';
    const v=this.view(),published=v.items.filter(x=>x.status==='published').slice(0,3);
    return '\n【生活事件的可选空间后续】'+JSON.stringify({eligible:v.eligible,published})+'。这些是已发生事件的分享机会，不要求发布。结合当前心情、有效天气、说过的话和近期空间记录，由你选择考虑、暂缓或跳过；用 qq_qzone(action="decision",eventId,decision="consider/defer/skip",reason,delayMinutes) 保存判断。想发时在 publish 的 eventIds 中携带对应 eventId；先查看 state 核对最新状态和冷却。已发布的同一件事不因阶段推进再次发布。沿用现有主动机会，不另外唤醒或催回，不把分享机会、暂缓或发布本身再计入心情。';
  }
}
