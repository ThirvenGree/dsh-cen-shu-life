import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escapeXml=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const renderEntries=entries=>entries.map(entry=>'- `'+escapeXml(entry.name)+'`: '+escapeXml(entry.description)).join('\n');
const open='<available_skills>',close='</available_skills>';
const fail=(reason,message)=>({available:false,reason,message});

// Only project DSH's structured, exactly reproducible skill catalog. A user or
// tool quoting the same markup is not a catalog. Unknown future formats and
// extra content stay untouched rather than silently discarding instructions.
function parse(message,index){
 const source=message?.source;
 if(source?.kind!=='skill-catalog'||source.form!=='catalog'||!Array.isArray(source.entries))return null;
 if(!Array.isArray(message.content)||message.content.length!==1||message.content[0]?.type!=='text'||typeof message.content[0].text!=='string')return null;
 const entries=source.entries;
 if(entries.some(entry=>!entry||typeof entry.name!=='string'||!entry.name||typeof entry.description!=='string')||new Set(entries.map(entry=>entry.name)).size!==entries.length)return null;
 const text=message.content[0].text,start=text.indexOf(open),end=text.indexOf(close,start+open.length);
 if(start<0||end<0||text.indexOf(open,start+open.length)!==-1||text.indexOf(close,end+close.length)!==-1)return null;
 const body=text.slice(start+open.length,end),expected='\n'+renderEntries(entries)+(entries.length?'\n':'');
 if(body!==expected&&!(entries.length===0&&body==='\n\n'))return null;
 return {index,message,entries:entries.map(({name,description})=>({name,description})),prefix:text.slice(0,start+open.length)+'\n',suffix:'\n'+text.slice(end),fingerprint:hash(message)};
}

/** No lifecycle or model calls here: the owning request projector keeps this
 * snapshot per session, invalidates it on release, and supplies model choices. */
export function inspectSkillCatalog(messages){
 const sourceRows=Array.isArray(messages)?messages.flatMap((message,index)=>message?.source?.kind==='skill-catalog'?[{message,index}]:[]):[];
 const latest=sourceRows.at(-1),current=latest&&parse(latest.message,latest.index);
 // A replacement is authoritative even when this version cannot parse it.
 // Never infer current availability from an older, understood catalog.
 if(latest&&!current)return {signature:hash(sourceRows),entries:[],catalogs:[],currentIndex:null,reason:'unsupported_current_catalog'};
 const catalogs=sourceRows.flatMap(({message,index})=>{const row=parse(message,index);return row?[row]:[];});
 const entries=current?.entries||[];
 return {signature:hash(catalogs.map(({index,fingerprint})=>({index,fingerprint}))),entries,catalogs,currentIndex:current?.index??null};
}

export function applySkillCatalog(messages,snapshot,keepSkills){
 const unchanged=reason=>({messages,offered:snapshot?.entries?.length||0,selected:snapshot?.entries?.length||0,changed:false,reason});
 if(!Array.isArray(messages)||!snapshot?.catalogs?.length)return unchanged('no_supported_catalog');
 const names=new Set(snapshot.entries.map(entry=>entry.name));
 if(!Array.isArray(keepSkills)||new Set(keepSkills).size!==keepSkills.length||keepSkills.some(name=>typeof name!=='string'||!names.has(name)))throw Error('技能选择包含无效名称');
 if(snapshot.catalogs.some(row=>!messages[row.index]||hash(messages[row.index])!==row.fingerprint))return unchanged('stale_catalog');
 const chosen=new Set(keepSkills);
 let next=messages;
 for(const row of snapshot.catalogs){
  const historical=row.index!==snapshot.currentIndex,selected=historical?[]:row.entries.filter(entry=>chosen.has(entry.name));
  if(!historical&&selected.length===row.entries.length)continue;
  const discover=historical?'\n\nThis earlier skill catalog is superseded. It does not describe current availability. Consult the latest task catalog or censhu_tool_catalog with {"action":"catalog","target":"skills"}; only the current session registry determines which skill names remain available.':'\n\nThis list contains the skills selected for this task. All current session skills remain available: call censhu_tool_catalog with {"action":"catalog","target":"skills"} (optional query, offset, limit) to discover the full current catalog, then call the original skill tool with the exact name to load its full instructions. Catalog selection does not change permissions or disable skills.';
  // DSH update frames say "only names in this replacement catalog". Adjust
  // that availability wording to include discovery, without changing loading,
  // invocation, permission, or already-loaded instruction rules.
  let prefix=row.prefix,suffix=row.suffix;
  prefix=prefix.replace('A skill is a reusable set of task-specific instructions. The following skills are available in this session:',historical?'Earlier skill catalog (superseded; not current availability):':'A skill is a reusable set of task-specific instructions. The following skills are selected for this task:');
  prefix=prefix.replace('The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:',historical?'Earlier replacement skill catalog (now superseded; not current availability):':'The available skill catalog changed. This task-selected view of the current catalog replaces earlier available-skills lists; other current skills remain discoverable:');
  suffix=suffix.replace('Use only names in this replacement catalog.','Use only names from the current session catalog, including names returned by censhu_tool_catalog with target="skills".');
  if(historical)suffix=suffix.replace('No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.','This historical catalog does not determine current availability; consult the latest session catalog.');
  const text=prefix+renderEntries(selected)+suffix.replace('</available_skills>','</available_skills>'+discover);
  if(next===messages)next=[...messages];
  next[row.index]={...row.message,source:{...row.message.source,entries:selected},content:[{...row.message.content[0],text}]};
 }
 return {messages:next,offered:names.size,selected:chosen.size,changed:next!==messages,reason:next===messages?'all_selected':'model_selection'};
}

/** Read-only discovery of the original catalog, not a skill executor and not a
 * second filesystem registry. The caller must use its own session snapshot. */
export function querySkillCatalog(snapshot,args={}){
 if(!snapshot?.catalogs?.length)return fail('no_skill_catalog','本会话尚未提供可识别的技能目录。');
 const {query='',offset=0,limit=20}=args;
 if(typeof query!=='string'||query.length>600||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40)return fail('invalid_arguments','技能目录页码或查询无效。');
 const terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const matches=snapshot.entries.filter(entry=>terms.every(term=>(entry.name+'\n'+entry.description).toLocaleLowerCase().includes(term)));
 if(offset>matches.length)return fail('invalid_offset','技能目录偏移超出范围。');
 const entries=matches.slice(offset,offset+limit).map(entry=>({...entry,load:{tool:'skill',arguments:{name:entry.name}}}));
 return {available:true,target:'skills',version:snapshot.signature,total:matches.length,offset,entries,nextOffset:offset+entries.length<matches.length?offset+entries.length:null,note:'所有条目来自当前会话原始技能目录。仍通过原 skill 工具加载全文，原权限和执行规则保持不变。'};
}
