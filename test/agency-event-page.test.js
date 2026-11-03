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
