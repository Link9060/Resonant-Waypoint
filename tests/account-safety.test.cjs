const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const key='sb-cnorozrjugxpanpfmssa-auth-token';
function fixture(fetch,session={access_token:'expired',refresh_token:'refresh',expires_at:1,user:{id:'owner'}}) {
  const values=new Map([[key,JSON.stringify(session)]]);const exports={};
  const localStorage={getItem:name=>values.get(name)??null,setItem:(name,value)=>values.set(name,value)};
  const location={hostname:'link9060.github.io',pathname:'/Resonant-Relay/arrow/waypoint/'};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ravin.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,localStorage,location,window:{location,setTimeout,clearTimeout,dispatchEvent(){}},fetch,AbortController,AbortSignal,Headers,DOMException,CustomEvent:class{},crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,URL,Intl});
  return {api:exports,values};
}
test('parallel planning loads share one token refresh',async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return {ok:true,json:async()=>({access_token:'fresh',refresh_token:'rotated'})};});
  const tokens=await Promise.all(Array.from({length:6},()=>f.api.getAccessToken()));
  assert.deepEqual(tokens,Array(6).fill('fresh'));assert.equal(calls,1);
});
test('a late token refresh cannot restore a signed-out account',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture(async()=>{await pending;return {ok:true,json:async()=>({access_token:'fresh',refresh_token:'rotated'})};});
  const request=f.api.getAccessToken();f.values.delete(key);release();
  await assert.rejects(request,/account changed/);assert.equal(f.values.has(key),false);
});
test('reapplying a capture preserves existing task, calendar, note, and item edits',async()=>{
  const writes=[];const f=fixture(async(url,options)=>{writes.push(options);return {ok:true,status:201,text:async()=> '[]'};},{access_token:'fresh',expires_at:Date.now()/1000+3600,user:{id:'owner'}});
  await f.api.createSharedTodo('task','2026-10-07','capture-task');
  await f.api.createSharedCalendarEvent('event','2026-10-07','','capture-event');
  await f.api.createSharedArrowNote('note','body','capture-note');
  await f.api.upsertSharedWaypointItems([{id:'plan',title:'plan',type:'project'}]);
  assert.equal(writes.length,4);
  for(const write of writes) assert.match(write.headers.get('Prefer'),/resolution=ignore-duplicates/);
});

test('a zero-row task update cannot report completion success',async()=>{
  const f=fixture(async()=>({ok:true,status:200,text:async()=> '[]'}),{access_token:'fresh',expires_at:Date.now()/1000+3600,user:{id:'owner'}});
  await assert.rejects(f.api.setSharedTodoCompleted('missing',true),/no longer exists/);
});

test('approved Capture sends one atomic request and preserves null deadlines and duration',async()=>{
 const writes=[];const f=fixture(async(url,options)=>{writes.push({url,body:JSON.parse(options.body)});return {ok:true,status:200,text:async()=>'{"applied":true}'};},{access_token:'fresh',expires_at:Date.now()/1000+3600,user:{id:'owner'}});
 await f.api.applySharedCapture('capture-id',[{id:'future',title:'Future',type:'task',placement:'plans',date:null},{id:'event',title:'Shift',type:'event',date:'2026-10-12',time:'16:00',duration_minutes:120}]);
 assert.equal(writes.length,1);assert.match(writes[0].url,/rpc\/arrow_apply_capture/);assert.equal(writes[0].body.p_items[0].date,null);assert.equal(writes[0].body.p_items[1].duration_minutes,120);
});
test('fallback does not auto-approve, invent a today date from negation, or repeat completed work',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/brain-dump.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
 const items=exports.interpretBrainDump('Already completed this task. Bike project someday, not today. Tomorrow I have a work shift.');
 assert.equal(items.length,2);assert.equal(items[0].when,undefined);assert.equal(items[1].type,'event');assert.equal(items.every(item=>item.accepted===false),true);
});
