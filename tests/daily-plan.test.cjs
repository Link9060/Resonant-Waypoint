const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const api={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/daily-plan.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:api,Date});
const task=(id,extra={})=>({id,title:id,due_on:'2026-10-12',completed:false,position:0,estimated_minutes:30,scheduled_on:null,scheduled_start:null,...extra});
const event=(extra={})=>({id:'shift',title:'Work shift',event_date:'2026-10-12',start_time:'18:00',end_time:'19:00',is_all_day:false,...extra});
const at=time=>new Date(`2026-10-12T${time}:00`);
test('overdue work remains visible even when scheduled tomorrow',()=>{
 assert.equal(api.belongsToToday(task('old',{due_on:'2026-10-10',scheduled_on:'2026-10-13'}),'2026-10-12'),true);
 assert.equal(api.belongsToToday(task('done',{due_on:'2026-10-10',completed:true}),'2026-10-12'),false);
});
test('next move fits available time and excludes unresolved prerequisites',()=>{
 const tasks=[task('blocked',{depends_on:['missing'],priority:'high'}),task('large',{estimated_minutes:60}),task('small',{estimated_minutes:20})];
 const plan=api.buildDailyPlan(tasks,[event()],[],at('17:30'));
 assert.equal(plan.next.id,'small');assert.equal(plan.available,30);assert.equal(plan.blockedCount,1);assert.match(plan.reason,/20 minutes fits/);
});
test('calendar in progress and all-day events reserve time',()=>{
 for(const e of [event(),event({is_all_day:true})]) {const plan=api.buildDailyPlan([task('small')],[e],[],at('18:15'));assert.equal(plan.next,null);assert.equal(plan.available,0);assert.equal(plan.activeEvent.id,'shift');}
});
test('no late-night task recommendation and no false all-clear for future work',()=>{
 const plan=api.buildDailyPlan([task('tomorrow',{due_on:'2026-10-13'})],[],[],at('23:30'));
 assert.equal(plan.next,null);assert.equal(plan.openCount,1);assert.match(plan.reason,/No time remains/);
 const early=api.buildDailyPlan([task('tomorrow',{due_on:'2026-10-13'})],[],[],at('12:00'));assert.match(early.reason,/unfinished task.*Plans/);
});
test('future scheduled tasks are visible but not recommended early',()=>{
 const plan=api.buildDailyPlan([task('later',{due_on:'2026-10-10',scheduled_on:'2026-10-13',scheduled_start:'09:00'})],[],[],at('12:00'));
 assert.equal(plan.next,null);assert.match(plan.reason,/scheduled for later/);
});
test('ambiguous prerequisites remain blocked; stable IDs unlock after completion',()=>{
 const tasks=[task('a',{title:'prep',completed:true}),task('b',{title:'prep',completed:true})];
 assert.match(api.prerequisiteReason(task('c',{depends_on:['prep']}),tasks,[]),/Waiting/);
 assert.equal(api.prerequisiteReason(task('c',{depends_on:['a']}),tasks,[]),null);
});
test('proposal destinations and schedule windows reject incompatible choices',()=>{
 assert.deepEqual(Array.from(api.allowedPlacements('event')),['calendar']);assert.deepEqual(Array.from(api.allowedPlacements('note')),['notes']);
 assert.equal(api.validWindow('20:00','08:00'),false);assert.equal(api.validWindow('08:00','08:00'),false);assert.equal(api.validWindow('25:00','26:00'),false);assert.equal(api.validWindow('08:00','20:00'),true);
});
