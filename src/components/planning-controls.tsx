'use client';
import {useState} from 'react';
import {createSharedTodo,createSharedCalendarEvent,updateSharedTodo,updateSharedCalendarEvent,updateSharedPlan,generateAutoPlan,applyScheduleBlock,type ArrowTodo,type ArrowCalendarEvent,type AutoPlan} from '@/lib/ravin';
import type {CapturedItem} from '@/lib/types';
type Editing={kind:'task'|'event'|'plan';id:string};
export function PlanningControls({tasks,events,plans,onChanged}:{tasks:ArrowTodo[];events:ArrowCalendarEvent[];plans:CapturedItem[];onChanged:()=>Promise<void>}) {
 const [open,setOpen]=useState(false),[title,setTitle]=useState(''),[kind,setKind]=useState('task'),[date,setDate]=useState(localDate()),[time,setTime]=useState(''),[endTime,setEndTime]=useState(''),[minutes,setMinutes]=useState(30),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState<Editing|null>(null);
 const [planning,setPlanning]=useState(false),[start,setStart]=useState('08:00'),[end,setEnd]=useState('20:00'),[plan,setPlan]=useState<AutoPlan|null>(null),[selected,setSelected]=useState<Set<string>>(new Set()),[notice,setNotice]=useState('');
 function reset(){setEditing(null);setTitle('');setTime('');setEndTime('');setNotice('');}
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy)return;if(!title.trim()){setError('Add a title.');return;}if(kind==='event'&&time&&endTime&&endTime<=time){setError('End time must be after start time.');return;}
  setBusy(true);setError('');try{
   if(editing?.kind==='task')await updateSharedTodo(editing.id,{title:title.trim(),due_on:date,estimated_minutes:minutes});
   else if(editing?.kind==='event')await updateSharedCalendarEvent(editing.id,{title:title.trim(),event_date:date,start_time:time||null,end_time:time?endTime||null:null,is_all_day:!time});
   else if(editing?.kind==='plan')await updateSharedPlan(editing.id,{title:title.trim(),due_date:date||null,due_time:time||null,status:'active',duration_minutes:minutes});
   else if(kind==='event')await createSharedCalendarEvent(title,date,time,'',endTime);
   else await createSharedTodo(title,date,'',minutes);
   reset();setNotice('Saved to ARROW.');await onChanged();
  }catch(e){setError(e instanceof Error?e.message:'Could not save. Please retry.');}finally{setBusy(false);}
 }
 async function build(){setBusy(true);setError('');setNotice('');try{const result=await generateAutoPlan(start,end);setPlan(result);setSelected(new Set(result.blocks.map(b=>b.task_id)));}catch(e){setError(e instanceof Error?e.message:'Could not plan.');}finally{setBusy(false);}}
 async function apply(){if(!plan||busy)return;setBusy(true);setError('');let saved=0;try{
  for(const block of plan.blocks.filter(b=>selected.has(b.task_id))){await applyScheduleBlock(block);saved++;setSelected(current=>{const next=new Set(current);next.delete(block.task_id);return next;});}
  setNotice(`${saved} focus blocks added to your shared calendar.`);await onChanged();
 }catch(e){setError(`${saved} blocks saved. ${e instanceof Error?e.message:'Could not finish.'} Retry the remaining blocks.`);await onChanged();}finally{setBusy(false);}}
 return <section className="planning-controls">
  <div className="planning-control-bar"><button type="button" onClick={()=>{setOpen(!open);setPlanning(false);}}>{open?'Close editor':'Add or edit'}</button><button type="button" onClick={()=>{setPlanning(!planning);setOpen(false);}}>Plan your week</button></div>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {open&&<div className="planning-editor"><form onSubmit={save}>
   <label>Type<select value={kind} disabled={!!editing} onChange={e=>{setKind(e.target.value);reset();}}><option value="task">Task</option><option value="event">Calendar event</option>{editing?.kind==='plan'&&<option value="plan">Plan or goal</option>}</select></label>
   <label>Title<input required maxLength={240} value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs to happen?"/></label>
   <label>Date<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   {kind==='event'||kind==='plan'?<label>Start time<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label>:null}
   {kind==='event'?<label>End time<input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} disabled={!time}/></label>:<label>Minutes<input type="number" min={5} max={240} step={5} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>}
   <button type="submit" disabled={busy}>{busy?'Saving…':editing?'Save changes':'Add to ARROW'}</button>{editing&&<button type="button" disabled={busy} onClick={reset}>Cancel edit</button>}
  </form><div className="planning-task-editor-list">
   {tasks.filter(t=>!t.completed).map(task=><button key={task.id} type="button" disabled={busy} onClick={()=>{reset();setEditing({kind:'task',id:task.id});setKind('task');setTitle(task.title);setDate(task.due_on||localDate());setMinutes(task.estimated_minutes||30);}}><span>{task.title}</span><small>Task · {task.due_on||'No date'} · Edit</small></button>)}
   {events.filter(e=>e.event_date>=localDate()).map(event=><button key={event.id} type="button" disabled={busy} onClick={()=>{reset();setEditing({kind:'event',id:event.id});setKind('event');setTitle(event.title);setDate(event.event_date);setTime(event.start_time?.slice(0,5)||'');setEndTime(event.end_time?.slice(0,5)||'');}}><span>{event.title}</span><small>Event · {event.event_date} · Edit</small></button>)}
   {plans.map(item=><button key={item.id} type="button" disabled={busy} onClick={()=>{reset();setEditing({kind:'plan',id:item.id});setKind('plan');setTitle(item.title);setDate(item.date||localDate());setTime(item.time||'');setMinutes(item.duration_minutes||30);}}><span>{item.title}</span><small>{item.type} · Edit</small></button>)}
  </div></div>}
  {planning&&<div className="planning-editor"><h3>Build your week</h3><p>Schedule open tasks around your calendar. Tasks without estimates use 30 minutes; events without an end time reserve an hour.</p><div className="planning-window"><label>Day starts<input type="time" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Day ends<input type="time" value={end} onChange={e=>setEnd(e.target.value)}/></label><button type="button" disabled={busy} onClick={()=>void build()}>{busy?'Working…':'Preview schedule'}</button></div>
  {plan&&<><p>{plan.source==='ravin'?'Prioritized by RAVIN':'Ordered by deadline'} · {plan.blocks.length} proposed blocks</p><div className="schedule-preview">{plan.blocks.map(block=><label key={block.task_id}><input type="checkbox" checked={selected.has(block.task_id)} disabled={busy} onChange={e=>setSelected(current=>{const next=new Set(current);e.target.checked?next.add(block.task_id):next.delete(block.task_id);return next;})}/><span><strong>{block.title}</strong><small>{block.date} · {block.start}–{block.end}{block.late?' · After deadline':''}</small></span></label>)}</div>{plan.conflicts.map((text,i)=><p key={i} role="status">Calendar conflict: {text}</p>)}{plan.unscheduled.map(item=><p key={item.task_id}>{item.title}: {item.reason}</p>)}{!plan.blocks.length&&<p>No new tasks need scheduling in this window.</p>}<p>{plan.can_apply===false?"This beta can preview your week. Applying focus blocks and AI prioritization await the beta scheduling backend.":""}</p><button type="button" disabled={busy||!selected.size||plan.can_apply===false} onClick={()=>void apply()}>Apply {selected.size} selected blocks</button></>}
  </div>}
 </section>;
}
function localDate(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
