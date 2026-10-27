import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {sourceHash} from './adapter-health.js';
export const weatherPolicyProtocol=1;
export function verifyWeatherPolicySource(source){return ['// cen-shu-life weather-policy v1','// cen-shu-life weather-policy-protocol:1','export const cenShuWeatherPolicyProtocol = 1','weatherOpportunity(path.resolve(dir()',"weatherInitiativeContext(path.resolve(dir()",'weatherKeys:','weatherClaim:','weather.factor'].every(marker=>source.includes(marker));}
export function weatherPolicyHealth(home,{startedAt=Infinity}={}){
 try{
  const meta=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life/weather-policy-install.json'),'utf8'));if(!meta.moduleUrl)return {ready:false,code:'not_installed',message:'天气主动策略尚未接入，请重新接入'};
  const file=fileURLToPath(meta.moduleUrl),source=fs.readFileSync(file,'utf8');
  if(path.basename(file)!=='index.mjs'||JSON.parse(fs.readFileSync(path.join(path.dirname(file),'package.json'),'utf8')).name!=='dsh-censhu-policy')throw Error('策略目标不是 dsh-censhu-policy');
  if(!verifyWeatherPolicySource(source))return {ready:false,code:'adapter_missing',message:'检测到主动辅助层改动或重装，天气主动联动已暂停，请重新接入'};
  if(meta.protocol!==weatherPolicyProtocol||meta.sourceSha256!==sourceHash(source))return {ready:false,code:'source_changed',message:'天气主动策略协议或源码摘要已变化，请检查并重新接入'};
  const pluginRoot=fileURLToPath(new URL('..',import.meta.url));let link;try{link=fs.realpathSync(path.join(path.dirname(file),'node_modules/dsh-cen-shu-life'));}catch{return {ready:false,code:'dependency_missing',message:'天气主动策略的插件依赖丢失，请重新接入'};}
  if(link!==fs.realpathSync(pluginRoot))return {ready:false,code:'dependency_changed',message:'天气主动策略依赖指向其他位置，请核对后重新接入'};
  if(meta.installedAt>startedAt)return {ready:false,code:'restart_required',message:'天气主动策略已重新接入，请重启 DSH 和 bridge 以加载新代码'};
  return {ready:true,code:'ready',message:'天气主动策略接入正常',protocol:weatherPolicyProtocol,pluginVersion:meta.pluginVersion};
 }catch(e){return {ready:false,code:e.code==='ENOENT'?'not_installed':'invalid_adapter',message:'天气主动策略不可用：'+(e.code==='ENOENT'?'接入记录或辅助层文件不存在，请重新接入':e.message)};}
}
