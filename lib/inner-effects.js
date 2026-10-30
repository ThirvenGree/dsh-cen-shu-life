import {createHash} from 'node:crypto';

const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Each consumer owns its own durable receipt; a failed consumer cannot block the others.
export function deliverInnerEffects(engine,request,deliver){
 const {id,sessionId,expiresAt}=request;
 if(!Number.isFinite(expiresAt))throw Error('独处联动缺少有效期');
 const file='inner-effect-receipts.json',ledger=engine.read(file,{entries:{}});
 const payload={sessionId,expiresAt,memory:request.memory,mood:request.mood,intentionChanges:request.intentionChanges};
 const key=fingerprint(payload);
 let row=ledger.entries[id];
 if(row&&row.key!==key)throw Error('独处联动编号已用于不同内容');
 if(!row){
  // Do not evict incomplete deliveries. Completed receipts outlive the source diary (200 rows).
  const completed=Object.entries(ledger.entries).filter(([,v])=>v.complete).sort((a,b)=>b[1].at-a[1].at);
  for(const [old] of completed.slice(500))delete ledger.entries[old];
  if(Object.keys(ledger.entries).length>=1000)throw Error('独处联动队列已满，请先处理失败项');
  row=ledger.entries[id]={key,at:engine.now(),channels:{}};
  engine.write(file,ledger);
 }
 const result={memory:'none',mood:'none',effectsProtocol:1,channels:row.channels};
 for(const [channel,field] of [['memory','memory'],['mood','mood'],['intentions','intentionChanges']]){
  if(!request[field]||(Array.isArray(request[field])&&!request[field].length))continue;
  let receipt=row.channels[channel];
  if(!receipt?.done){
   try{
    if(channel!=='memory'&&engine.now()>=expiresAt){
     receipt={done:true,state:'expired',result:channel==='intentions'?{accepted:[],rejected:[{reason:'独处打算已过期，不再补发'}]}:'expired',at:engine.now()};
    }else{
     const response=deliver({id,sessionId,[field]:request[field]});
     receipt={done:true,state:'completed',result:response[channel],at:engine.now()};
    }
   }catch(error){receipt={done:false,state:'retry',error:String(error.message).slice(0,200),attempts:(receipt?.attempts||0)+1,at:engine.now()};}
   row.channels[channel]=receipt;
   engine.write(file,ledger);
  }
  result[channel]=receipt.done?receipt.result:channel==='intentions'?{accepted:[],rejected:[]}: 'retry';
 }
 row.complete=Object.values(row.channels).every(x=>x.done);
 engine.write(file,ledger);
 return {...result,complete:row.complete};
}
