import assert from 'node:assert/strict';
import {googleSituation} from '../lib/situation.js';
const config={semanticModel:'gemini-3.8-flash',semanticProxyUrl:process.argv[2]||''};
const cases=[['我很喜欢你','confession',true],['我好喜欢你','confession',true],['我不是很喜欢你','confession',false],['我很喜欢你写的字','confession',false],['这句台词是“我好喜欢你”，帮我翻译','confession',false],['今天太累了，感觉整个人散架了','needsCare',true],['朋友说他太累了','needsCare',false],['我已经好多了，不难受了','careResolved',true],['我已经不难受了','needsCare',false],['我喜欢你推荐的那本书','confession',false],['我朋友今天好累','needsCare',false]];
for(const [text,key,expected]of cases){const result=await googleSituation(text,config,{signal:AbortSignal.timeout(20000)});console.log(JSON.stringify({text,result}));assert.equal(result[key],expected,text);}
