import test from 'node:test';
import assert from 'node:assert/strict';
import {LifeChangeFeed} from '../lib/change-feed.js';
test('pages contain only requested life stages, with exclusive cursors and detached data',()=>{
 const feed=new LifeChangeFeed({read:()=>({version:1,generation:'g',sequence:0,items:[]}),write(){},now:()=>1});
 for(let n=0;n<12;n++)feed.append('event-stage',{eventId:'a',stage:n,stageText:String(n)});
 feed.append('event-stage',{eventId:'b',stage:0});feed.append('private-note',{eventId:'a'});
 const page=feed.eventPage('a'),older=feed.eventPage('a',page.olderBefore);
 assert.deepEqual([...older.rows,...page.rows].map(r=>r.stage),Array.from({length:12},(_,i)=>i));
 assert.equal(older.olderBefore,null);assert.equal(feed.eventPage('missing').rows.length,0);assert.throws(()=>feed.eventPage('a',-1));
});

test('failed persistence can retry without a phantom receipt or skipped sequence',()=>{
 let disk={version:1,sequence:0,generation:'gen',items:[]},fail=true;
 const engine={read:()=>structuredClone(disk),now:()=>100,write:(_k,v)=>{if(fail)throw Error('disk');disk=structuredClone(v);}};
 const feed=new LifeChangeFeed(engine),ticket={eventId:'book',stage:0,name:'旧书',stageText:'发现一张票根'};
 assert.throws(()=>feed.append('event-start',ticket),/disk/);assert.equal(feed.record.sequence,0);
 fail=false;feed.append('event-start',ticket);feed.append('event-start',ticket);
 const restarted=new LifeChangeFeed(engine);assert.equal(restarted.record.sequence,1);
 const found=restarted.searchEvents({query:'照片 票根',from:95,to:105});
 assert.equal(found.candidates[0].eventId,'book');assert.equal(found.coverage.earliest,100);
 assert.equal(restarted.eventPage('book').rows[0].id,found.candidates[0].observationId);
 assert.equal(restarted.searchEvents({query:'票根',from:101}).total,0);assert.throws(()=>restarted.searchEvents({}));
});
