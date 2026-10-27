import {randomBytes,timingSafeEqual} from 'node:crypto';
const loopback=host=>['127.0.0.1','[::1]','localhost'].includes(host);
const reject=(message,status=403)=>{throw Object.assign(Error(message),{status});};
export function createRequestGuard({now=()=>Date.now()}={}){
  const token=randomBytes(32).toString('hex'),last=new Map();
  return {token,check(req,route){
    let host;try{host=new URL('http://'+req.headers?.host);if(host.host!==req.headers.host||!loopback(host.hostname)||host.username||host.password)reject('拒绝非本机 Host');}catch{reject('拒绝非本机 Host');}
    if(req.socket?.localPort&&Number(host.port||80)!==req.socket.localPort)reject('Host 端口不匹配');
    const remote=req.socket?.remoteAddress;if(remote&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))reject('仅允许本机请求');
    const origin=req.headers.origin;
    if(origin){let u;try{u=new URL(origin);}catch{reject('无效来源');}if(u.protocol!=='http:'||u.host!==host.host||!loopback(u.hostname))reject('拒绝跨来源请求');}
    if(req.headers['sec-fetch-site']==='cross-site'&&!(req.method==='GET'&&route==='/settings'&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document'))reject('拒绝跨站请求');
    if(['GET','HEAD'].includes(req.method))return;
    const supplied=req.headers['x-censhu-csrf'];if(typeof supplied!=='string'||supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))reject('缺少或无效的本机操作令牌');
    if(['/weather/update','/semantic/test','/content/update','/integrations/mood/repair','/simulate/judge'].includes(route)){
      if(last.has(route)&&now()-last.get(route)<10000)reject('操作过于频繁，请稍后重试',429);last.set(route,now());
    }
  }};
}
