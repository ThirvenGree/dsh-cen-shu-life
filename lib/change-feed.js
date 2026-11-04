import {randomUUID} from 'node:crypto';
// Durable observations are written at transition time, independently of mood quotas.
export class LifeChangeFeed {
  constructor(engine){this.engine=engine;this.record=engine.read('life-changes.json',{version:1,sequence:0,items:[]});if(this.record.version!==1||!Number.isSafeInteger(this.record.sequence)||!Array.isArray(this.record.items))this.error='生活变化记录版本无效，请检查life-changes.json；其他生活功能继续运行';else if(!this.record.generation){this.record.generation=randomUUID();engine.write('life-changes.json',this.record);}}
  activity(sessionId,text,surface='dsh'){
    if(!text?.trim()||!this.engine.bound(sessionId))return;
    const previous=this.engine.read('recent-activity.json',{recent:[]}),at=this.engine.now();
    const recent=[...(previous.recent||[]).filter(x=>at-x.at<2*3600000),{sessionId,surface,at,text:text.slice(-600)}].slice(-8);
    this.engine.write('recent-activity.json',{sessionId,surface,at,recent});
  }
  append(kind,data,at=this.engine.now()){
    if(kind==='conversation'){this.activity(data.sessionId,data.text);return null;}
    if(this.error)return null;
    if(data.eventId){const existing=this.record.items.find(x=>x.kind===kind&&x.data.eventId===data.eventId&&x.data.stage===data.stage);if(existing)return existing;}
    const sequence=this.record.sequence+1;
    const item={sequence,id:'life:'+this.record.generation+':'+sequence,kind,at,data:structuredClone(data)};
    const next={...this.record,sequence,items:[...this.record.items,item].slice(-5000)};
    this.engine.write('life-changes.json',next);this.record=next;return item;
  }
  upsertWatch(data,updateOnly=false){
    const kind=data.origin==='bili'?'bili-watch':'douyin-watch';
    if(this.error)return null;
    const prior=this.record.items.find(x=>x.kind===kind&&x.data.eventId===data.eventId);
    if(!prior)return updateOnly?null:this.append(kind,data);
    data={...data,reflection:data.reflection?.trim()||prior.data.reflection,complete:prior.data.complete||data.complete};
    if(JSON.stringify(prior.data)===JSON.stringify(data))return prior;
    const row={...prior,sequence:this.record.sequence+1,at:this.engine.now(),data,revision:(prior.revision||1)+1};
    const next={...this.record,sequence:row.sequence,items:[...this.record.items.filter(x=>x.id!==row.id),row]};
    this.engine.write('life-changes.json',next);this.record=next;return row;
  }
  searchEvents({query='',from,to}){
    if(this.error)throw Error(this.error);
    if(typeof query!=='string'||query.length>250||[from,to].some(v=>v!==undefined&&!Number.isSafeInteger(v))||from>to)throw Error('搜索条件无效');
    const terms=query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
    if(!terms.length&&from===undefined&&to===undefined)throw Error('请提供时间范围或片段关键词');
    const matches=new Map();let earliest=null,latest=null;
    for(const {id,kind,at,data} of this.record.items){
      if(!data.eventId||!['event-start','event-stage','event-end'].includes(kind))continue;
      earliest=earliest===null?at:Math.min(earliest,at);latest=latest===null?at:Math.max(latest,at);
      if(at<from||at>to)continue;
      const snippet=[data.name,data.stageText,data.reason].filter(Boolean).join(' · ');
      const score=terms.filter(t=>snippet.toLowerCase().includes(t)).length;
      if(terms.length&&!score)continue;
      const prev=matches.get(data.eventId);
      if(!prev||score>prev.score||score===prev.score&&at>=prev.at)matches.set(data.eventId,{eventId:data.eventId,observationId:id,kind,at,snippet,score});
    }
    return {coverage:{earliest,latest,retainedChanges:this.record.items.length},total:matches.size,candidates:[...matches.values()].sort((a,b)=>b.score-a.score||b.at-a.at).slice(0,10)};
  }
  eventPage(eventId,before=Infinity){
    if(this.error)throw Error(this.error);
    if(typeof eventId!=='string'||!eventId.trim()||eventId.length>250||!(before===Infinity||Number.isSafeInteger(before)&&before>0))throw Error('事件编号或分页位置无效');
    const stages=this.record.items.filter(x=>x.data?.eventId===eventId&&['event-start','event-stage','event-end'].includes(x.kind)&&x.sequence<before);
    const rows=stages.slice(-8).map(({id,sequence,at,kind,data})=>({id,sequence,at,kind,name:data.name,stage:data.stage,detail:data.stageText,reason:data.reason}));
    return {eventId,rows,olderBefore:stages.length>rows.length?rows[0].sequence:null};
  }
  since(cursor=0){if(this.error)throw Error(this.error);const items=this.record.items.filter(x=>x.sequence>cursor);return {contract:'censhu.life-changes',version:1,generation:this.record.generation,cursor:this.record.sequence,gap:cursor>this.record.sequence||cursor>0&&items.length>0&&items[0].sequence>cursor+1,items:structuredClone(items)};}
}
