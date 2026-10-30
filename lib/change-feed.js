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
    const item={sequence:++this.record.sequence,id:'life:'+this.record.generation+':'+this.record.sequence,kind,at,data:structuredClone(data)};
    this.record.items.push(item);this.record.items=this.record.items.slice(-5000);this.engine.write('life-changes.json',this.record);return item;
  }
  since(cursor=0){if(this.error)throw Error(this.error);const items=this.record.items.filter(x=>x.sequence>cursor);return {contract:'censhu.life-changes',version:1,generation:this.record.generation,cursor:this.record.sequence,gap:cursor>this.record.sequence||cursor>0&&items.length>0&&items[0].sequence>cursor+1,items:structuredClone(items)};}
}
