import type { ArrowTodo, ArrowCalendarEvent } from './ravin';
import type { CapturedItem } from './types';

export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
export function belongsToToday(task: Pick<ArrowTodo,'completed'|'due_on'|'scheduled_on'>, today: string) {
  return task.scheduled_on === today || task.due_on === today || (!task.completed && (!task.due_on || task.due_on < today));
}
const clock = (value: string) => Number(value.slice(0,2))*60+Number(value.slice(3,5));
export function prerequisiteReason(task: ArrowTodo, tasks: ArrowTodo[], plans: CapturedItem[]) {
  const normal = (value: string) => value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ');
  for (const ref of task.depends_on || []) {
    const rows = [...tasks.map(t=>({id:t.id,title:t.title,done:t.completed})), ...plans.map(p=>({id:p.id,title:p.title,done:false}))];
    const exact = rows.filter(row=>row.id===ref || row.id===`waypoint:${ref}`);
    const matches = exact.length ? exact : rows.filter(row=>normal(row.title)===normal(ref));
    if (matches.length!==1 || !matches[0].done) return `Waiting for ${matches.length===1 ? matches[0].title : ref}`;
  }
  return null;
}
export function buildDailyPlan(tasks: ArrowTodo[], events: ArrowCalendarEvent[], plans: CapturedItem[], now = new Date()) {
  const today = localDay(now), minute = now.getHours()*60+now.getMinutes();
  const blocks = events.filter(event=>event.event_date===today).map(event=>({
    event, start:event.is_all_day?0:clock(event.start_time || '00:00'),
    end:event.is_all_day?1440:event.end_time?clock(event.end_time):Math.min(1440,clock(event.start_time || '00:00')+60)
  })).filter(block=>block.end>minute).sort((a,b)=>a.start-b.start);
  const active = blocks.find(block=>block.start<=minute && block.end>minute);
  const nextEvent = blocks.find(block=>block.start>minute);
  const available = active ? 0 : Math.max(0, Math.min(nextEvent?.start ?? 1320,1320)-minute);
  const open = tasks.filter(task=>!task.completed);
  const todayTasks = open.filter(task=>belongsToToday(task,today));
  const ranked = todayTasks.filter(task=>!prerequisiteReason(task,tasks,plans) &&
    (!task.scheduled_on || task.scheduled_on<today || task.scheduled_on===today && (!task.scheduled_start || clock(task.scheduled_start)<=minute)))
    .sort((a,b)=>(a.due_on || '9999').localeCompare(b.due_on || '9999') ||
      ({high:0,medium:1,low:2}[a.priority || 'medium']-({high:0,medium:1,low:2}[b.priority || 'medium'])) || (a.position||0)-(b.position||0));
  const next = ranked.find(task=>(task.estimated_minutes || 30)<=available) || null;
  return {next,activeEvent:active?.event || null,nextEvent:nextEvent?.event || null,available,openCount:open.length,
    blockedCount:todayTasks.filter(task=>prerequisiteReason(task,tasks,plans)).length,
    reason:next ? `${next.estimated_minutes || 30} minutes fits before ${nextEvent ? nextEvent.event.title : 'your 10 PM planning cutoff'}. ${next.due_on<today?'This task is overdue.':next.priority==='high'?'High priority.':'Ordered by deadline.'}` :
      active ? `Your calendar has ${active.event.title} in progress.` : available===0 ? 'No time remains in today’s planning window. Preview tomorrow before adding more work.' :
      ranked.length ? `Your ready tasks need more than the ${available} minutes available. Preview a new schedule.` :
      todayTasks.length ? 'Remaining work is blocked or scheduled for later. Review its timing and prerequisites.' :
      open.length ? `${open.length} unfinished task${open.length===1?'':'s'} remain in Plans.` : 'No open tasks. Your calendar and parked plans are still available.'};
}
export function allowedPlacements(type: CapturedItem['type']): NonNullable<CapturedItem['placement']>[] {
  return type==='event'?['calendar']:type==='note'?['notes']:type==='goal'?['direction']:type==='task'?['today','plans','later']:type==='later'?['later','plans']:['plans'];
}
export function validWindow(start: string, end: string) {
  const valid=(value:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return valid(start) && valid(end) && end>start;
}
