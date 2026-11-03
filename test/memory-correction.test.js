import test from 'node:test';
import assert from 'node:assert/strict';
import {correctionTool} from '../lib/memory-correction.js';
import {isAuditedWrite} from '../lib/reviewed-write.js';
function fixture({allow=true,mn=false,loseReply=false}={}){
 const old='青椒说喜欢这本书',updated='青枔说喜欢这本书',food='晚上吃了青椒。',rows=[old,food],db={},revoked=[];
 let writes=0,reviews=0;const messages=[{role:'user',id:'qq-1',text:'把说喜欢这本书的青椒改成青枔，晚饭那条别动'}];
 const engine={config:{enabled:true},bound:s=>s==='role',now:()=>123,read:(k,d)=>k.includes('integration')?{sessionId:'role',qqPrivateId:'peer'}:structuredClone(db[k]||d),write:(k,v)=>{db[k]=structuredClone(v);}};
 const tools={execute:async req=>{const a=req.arguments;if(a.action==='list'||req.name==='censhu_mnemon_entries'){const entries=rows.filter(x=>x.includes(a.filter||a.match));return {value:{ok:true,entries,total:entries.length}};}
 assert.ok(isAuditedWrite(req));writes++;const i=rows.indexOf(a.match||a.old_text);assert.notEqual(i,-1);
 if(a.action==='remove')rows.splice(i,1);else rows[i]=a.content;
 if(loseReply)throw Error('receipt lost');return {value:{ok:true}};}};
 const tool=correctionTool(engine,tools,{facts:()=>({messages,key:'private:peer'}),revoke:(_e,v)=>revoked.push(v),review:async(_p,_s,input)=>{reviews++;assert.equal(input.latestUserMessage,messages.at(-1).text);return {allow,reason:'核对用户原话'};}});
 const run=(args={})=>tool.execute({backend:mn?'mnemon':'de_memory',target:'user',action:'replace',original:old,replacement:updated,...args},{agent:{id:'role'}});
 return {run,rows,old,updated,food,messages,revoked,get writes(){return writes;},get reviews(){return reviews;}};
}
for(const mn of [true,false])test('verified correction changes exactly one entry and revokes its old evidence '+mn,async()=>{
 const f=fixture({mn});assert.equal(JSON.parse(await f.run()).status,'verified');assert.deepEqual(f.rows,[f.updated,f.food]);assert.deepEqual(f.revoked,[f.old]);assert.equal(JSON.parse(await f.run()).replayed,true);assert.equal(f.writes,1);
});
test('missing real message, ambiguous originals and negative audit never write',async()=>{
 const f=fixture({allow:false});assert.equal(JSON.parse(await f.run()).status,'not-approved');f.rows.push(f.old);await assert.rejects(f.run(),/不唯一/);f.messages.length=0;await assert.rejects(f.run(),/真实QQ/);assert.equal(f.writes,0);
});
test('forget verifies absence and reconciles lost receipt without repeating deletion',async()=>{
 const f=fixture({loseReply:true});f.messages[0].text='忘掉说喜欢这本书的那条记忆';const args={action:'remove',replacement:undefined};
 await assert.rejects(f.run(args),/receipt lost/);assert.deepEqual(f.revoked,[]);assert.equal(JSON.parse(await f.run(args)).status,'verified');assert.equal(f.writes,1);assert.deepEqual(f.rows,[f.food]);assert.deepEqual(f.revoked,[f.old]);
});
