/* dsh-plugin-links-page-v1 */
;(()=>{let __dshLinksReact;const __dshLinksLoader=window.__ModuleLoader__,__dshLinksLoad=__dshLinksLoader.load;const __dshLinksPanel=function createPanel(React,id){
 const h=React.createElement;
 return function IntegrationPanel(){
  const [state,setState]=React.useState(null),[error,setError]=React.useState('');
  const refreshRef=React.useRef(null);
  const [busy,setBusy]=React.useState(false);
  React.useEffect(()=>{
   let live=true,controller,timer;
   async function refresh(force=false){
    if(!live||document.hidden||controller)return;
    clearTimeout(timer);controller=new AbortController();setBusy(true);
    try{
     const r=await fetch('/dsh-plugin-links/state',{cache:'no-store',headers:force?{'x-links-refresh':'1'}:{},signal:controller.signal});
     if(!r.ok)throw Error('HTTP '+r.status);
     const data=await r.json();
     if(live){setState(data);setError('');}
    }catch(e){if(live)setError('暂时无法刷新联动状态，可点击重试。');}
    finally{controller=null;if(live){setBusy(false);timer=setTimeout(refresh,10000);}}
   }
   const resume=()=>{if(!document.hidden)refresh(true);};
   refreshRef.current=()=>refresh(true);
   window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);refresh();
   return()=>{live=false;clearTimeout(timer);controller?.abort();window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[]);
  const row=state?.rows?.find(x=>x.id===id);
  const list=(items,incoming)=>items?.length?h('ul',{style:{margin:'6px 0',paddingLeft:20}},...items.map((e,i)=>h('li',{key:i,style:{marginBottom:6}},h('strong',null,incoming?e.fromLabel:e.toLabel),' · '+e.status,h('div',{style:{opacity:.75,fontSize:12}},e.detail)))):h('p',{style:{opacity:.7}},'尚未确认直接联动；不把共同使用模型当成直接影响。');
  return h('section',{'aria-label':'动态机制与插件联动',style:{border:'1px solid rgba(127,127,127,.22)',borderRadius:16,padding:18,margin:'0 0 20px',background:'linear-gradient(120deg,rgba(90,140,125,.10),rgba(110,130,180,.06))',color:'inherit',lineHeight:1.6}},h('div',{style:{display:'flex',justifyContent:'space-between',gap:12}},h('strong',null,'动态机制与插件联动'),h('small',null,row?.runtime||'读取运行状态…'),h('button',{type:'button',disabled:busy,onClick:()=>refreshRef.current?.()},busy?'刷新中…':'刷新状态')),error?h('p',{role:'status'},error):null,row?h(React.Fragment,null,h('p',{style:{margin:'10px 0 4px'}},h('strong',null,row.dynamic),' · '+row.description),row.watchClock?h('section',{'aria-label':'动态观看节奏',style:{padding:12,background:'rgba(100,150,130,.10)',borderRadius:10}},h('strong',null,'动态观看节奏 · Gemini'),h('p',null,row.watchClock.status),row.watchClock.decision?h('p',null,'最近决定 · '+({watch:'观看',defer:'稍后考虑',skip:'跳过窗口'}[row.watchClock.decision.action]||'待判断')+' · '+row.watchClock.decision.reason):null,row.watchClock.at?h('small',null,'安排时间 · '+new Date(row.watchClock.at).toLocaleString('zh-CN')):null,row.watchClock.error?h('p',{role:'status'},row.watchClock.error):null):null,row.guide?h('details',null,h('summary',{style:{cursor:'pointer',padding:'6px 0'}},'选片、观看、互动和记录如何生效'),...row.guide.map(([title,detail])=>h('p',{key:title},h('strong',null,title+' · '),detail))):null,row.timing?h('div',{'aria-label':'Gemini 动态节奏',style:{margin:'12px 0',padding:14,borderRadius:12,background:'rgba(100,150,130,.10)'}},h('strong',null,row.timing.status),h('p',null,row.timing.notice),row.timing.error?h('p',{role:'status'},row.timing.error):null,h('table',{style:{width:'100%',fontSize:13,textAlign:'left'}},h('thead',null,h('tr',null,h('th',null,'动态控制项'),h('th',null,'当前生效值'),h('th',null,'Gemini 判断理由'))),h('tbody',null,...row.timing.items.map(item=>h('tr',{key:item.key},h('td',null,item.label),h('td',null,item.value==null?'等待安排':String(item.value)+' '+item.unit),h('td',null,item.reason||'—'))))),h('p',null,'下次评估：'+(row.timing.nextAt?new Date(row.timing.nextAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'等待模型安排')),h('a',{href:'/dsh-plugin-links/gemini/settings',target:'_blank',rel:'noreferrer'},'查看完整调用记录与错误')):null,h('details',null,h('summary',{style:{cursor:'pointer',padding:'8px 0'}},'正在影响 '+row.outgoing.length+' 项 · 受到 '+row.incoming.length+' 项影响（展开查看）'),h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:20,maxHeight:320,overflow:'auto'}},h('div',null,h('strong',null,'正在影响'),list(row.outgoing,false)),h('div',null,h('strong',null,'受到的影响'),list(row.incoming,true)))),h('div',{style:{fontSize:12,marginTop:8}},...(row.evidence??[]).map(x=>h('p',{key:x.id},(x.ok?'已验证：':'待确认：')+x.message))),h('small',{style:{opacity:.65}},'更新于 '+new Date(state.at).toLocaleTimeString()+' · 页面可见时自动刷新')):null);
 };
};function __dshLinksRegister(service,options,Component,...rest){if(options?.name==='settings.section'&&typeof Component==='function'&&typeof __dshLinksReact?.createElement==='function'){const R=__dshLinksReact,Panel=__dshLinksPanel(R,"dsh-cen-shu-life"),Original=Component;Component=function(props){return R.createElement(R.Fragment,null,R.createElement(Panel),R.createElement(Original,props));};}return service.register(options,Component,...rest);}__dshLinksLoader.load=function(def,...args){const factory=def.factory;return __dshLinksLoad.call(this,{...def,factory:function(require,...args){__dshLinksReact=require('react');return factory.call(this,require,...args);}},...args);};try{
window.__ModuleLoader__.load({id:'dsh-cen-shu-life',factory:require=>{
  const React=require('react');
  return {inject:['slots'],apply(ctx){const slots=ctx.get('slots');if(!slots)return;slots.inject('settings.section',()=>__dshLinksRegister(slots,{name:'settings.section',id:'cen-shu-life',order:54,label:()=> '岑舒生活'},()=>React.createElement('iframe',{title:'岑舒生活',src:'/dsh-cen-shu-life/settings',style:{width:'100%',height:'calc(100vh - 140px)',minHeight:700,border:0,borderRadius:12}})));}};
}});

}finally{__dshLinksLoader.load=__dshLinksLoad;}})();
