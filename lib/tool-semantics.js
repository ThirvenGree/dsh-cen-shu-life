// One classification shared by action deduplication and turn recovery. This is
// an execution-effect classification, not permission to run a tool or a
// replacement for that tool's argument/schema validation.
const readTools=new Set([
 'read','read_file','read_image','list_directory','grep','glob','web_search',
 'censhu_agency_context_page','censhu_agency_find_event','censhu_agency_event_history',
 'censhu_context_recall','censhu_question_recall','censhu_life_context','censhu_read_memory',
 'censhu_tool_catalog','censhu_tool_result_read'
]);
const readActions=new Map([
 ['censhu_agency_method',new Set(['recall'])],
 ['censhu_agency_note',new Set(['read'])],
 ['censhu_private_archive',new Set(['read','list','search','compare'])]
]);

/** Missing arguments are allowed for argument-free reads. Explicit malformed
 * JSON/non-object arguments and unknown tools/actions fail closed. */
export function isReadOnlyTool(exec){
 if(!exec||typeof exec!=='object'||Array.isArray(exec)||typeof exec.name!=='string')return false;
 let args=exec.arguments;
 if(typeof args==='string'){
  try{args=JSON.parse(args);}catch{return false;}
 }
 if(args!==undefined&&(!args||typeof args!=='object'||Array.isArray(args)))return false;
 if(readTools.has(exec.name))return true;
 return readActions.get(exec.name)?.has(args?.action)===true;
}
