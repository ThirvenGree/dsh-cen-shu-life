export const expressionCatalog=[['great','欢喜'],['good','开心'],['ok','平常'],['worry','担心'],['sad','难过'],['annoyed','烦'],['sleepy','困倦'],['shy','难为情'],['affectionate','甜蜜'],['caring','心软'],['flustered','慌'],['jealous','吃醋']].map(([id,label])=>({id,label,image:'/dsh-feiyu-mood/face-v2-'+id+'.png',version:2}));
export function selectMoodExpression(state={},behavior={}){
 const mode=behavior.lifeMode||behavior.state||behavior.id||'normal',dims=Array.isArray(state.dims)?Object.fromEntries(state.dims.map(d=>[d.key,d.value])):state.dims||{};
 const mapped={annoyed:'annoyed',hurt:'annoyed',tired:'sleepy',low:'sad',embarrassed:'shy',panicked:'flustered',soft:'caring',jealous:'jealous',jealousSilent:'jealous',joyful:'great',pleased:'good'};
 let id=mapped[mode];
 if(!id){const m=Number.isFinite(Number(state.mood))?Number(state.mood):70;id=m<25?'sad':m<42?'worry':Number(dims.jealous)>=10?'jealous':Number(dims.heartache)>=10?'caring':Number(dims.worry)>=10?'worry':Number(dims.sweet)>=10?'affectionate':m>=80?'great':m>=62?'good':'ok';}
 return {...expressionCatalog.find(e=>e.id===id),mode};
}
