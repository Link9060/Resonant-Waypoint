"use client";
import {buildDailyPlan, belongsToToday, prerequisiteReason, allowedPlacements} from "@/lib/daily-plan";
import {PlanningControls} from "./planning-controls";

import { useEffect, useMemo, useRef, useState } from "react";
import { BeaconIcon } from "./beacon-icon";
import {
  CalendarIcon,
  DirectionIcon,
  DumpIcon,
  PlansIcon,
  PlusIcon,
  ReviewIcon,
  SparkIcon,
  TodayIcon
} from "./icons";
import { interpretBrainDump } from "@/lib/brain-dump";
import {
  currentPlanningAccount,
  archiveSharedWaypointItem,
  applySharedCapture,
  activateSharedAction,
  deleteSharedEvent,
  createSharedArrowNote,
  createSharedCalendarEvent,
  createSharedTodo,
  interpretWithRavin,
  loadSharedPlanningData,
  markSharedWaypointCaptureApplied,
  migrateLegacyWaypointItems,
  openRavinFromWaypoint,
  saveSharedWaypointCapture,
  setSharedTodoCompleted,
  upsertSharedWaypointItems,
  waypointRowToCapturedItem,
  type ArrowTodo,
  type ArrowCalendarEvent,
  type ArrowWaypointCapture,
  type WaypointInterpretation,
} from "@/lib/ravin";
import type { CapturedItem, TodayItem, WaypointTab } from "@/lib/types";

const tabs = [
  { id: "today", label: "Today", icon: TodayIcon },
  { id: "dump", label: "Capture", icon: DumpIcon },
  { id: "plans", label: "Plans", icon: PlansIcon },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
  { id: "direction", label: "Direction", icon: DirectionIcon },
  { id: "review", label: "Review", icon: ReviewIcon }
] as const;

const initialToday: TodayItem[] = [];

const LIBRARY_KEY = "waypoint_library_v1";
const ORBIT_URL = "/orbit/";

type SharedEvent = {
  read_only?: boolean;
  source?: string;
  source_href?: string;
  id: string;
  title: string;
  date: string;
  time?: string;
  endTime?: string;
  allDay?: boolean;
};

function safeJsonList<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dueMeta(dueOn: string) {
  if (dueOn === localIsoDate(0)) return "Due today";
  const label = new Date(`${dueOn}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return dueOn < localIsoDate(0) ? `Overdue · ${label}` : `Due ${label}`;
}

function localIsoDate(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function resolveCaptureDate(item: CapturedItem) {
  if (item.date) { const date = new Date(`${item.date}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === item.date ? item.date : null; }
  const when = String(item.when || "").trim().toLowerCase();
  if (!when) return null;
  if (when === "today" || when === "tonight") return localIsoDate(0);
  if (when === "tomorrow") return localIsoDate(1);

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const isNextWeekday = when.startsWith("next ");
  const target = weekdays.indexOf(when.replace(/^next\s+/, ""));
  if (target >= 0) {
    const date = new Date();
    const rawDelta = (target - date.getDay() + 7) % 7;
    const delta = isNextWeekday
      ? rawDelta === 0 ? 7 : rawDelta + 7
      : rawDelta === 0 ? 7 : rawDelta;
    return localIsoDate(delta);
  }

  const parsed = new Date(item.when || "");
  return Number.isNaN(parsed.getTime()) ? null : `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
}

export function WaypointShell() {
  const [activeTab, setTab] = useState<WaypointTab>("today");
  const [now,setNow] = useState(new Date());
  const [reviewingCapture,setReviewingCapture] = useState(false);
  const [draftReady,setDraftReady] = useState(false);
  const [draftNotice,setDraftNotice] = useState('');
  const draftOwner = useRef<string | null>(null);
  const draftKey = (owner:string) => `arrow_capture_draft_v2:${owner}`;
  function setActiveTab(tab:WaypointTab) {
    setTab(tab);
    const url=new URL(window.location.href);url.searchParams.set('tab',tab);url.searchParams.delete('item');
    if(url.toString()!==location.href)window.history.pushState(null,'',url);
  }
  const [dump, setDump] = useState("");
  const [captures, setCaptures] = useState<CapturedItem[]>([]);
  const [todayItems, setTodayItems] = useState(initialToday);
  const [sharedTodos, setSharedTodos] = useState<ArrowTodo[]>([]);
  const [events, setEvents] = useState<SharedEvent[]>([]);
  const [libraryItems, setLibraryItems] = useState<CapturedItem[]>([]);
  const [captureHistory, setCaptureHistory] = useState<ArrowWaypointCapture[]>([]);
  const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sharedEvents,setSharedEvents]=useState<ArrowCalendarEvent[]>([]);
  const [syncing, setSyncing] = useState(true);
  const [planningLoaded, setPlanningLoaded] = useState(false);
  const [isApplyingCapture, setIsApplyingCapture] = useState(false);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<WaypointInterpretation | null>(null);

  const [sharedNotes,setSharedNotes]=useState<CapturedItem[]>([]);
  const [pendingTasks, setPendingTasks] = useState<Set<string>>(new Set());
  const refreshVersion = useRef(0);
  const pendingTaskIds = useRef(new Set<string>());
  async function refreshSharedPlanning() {
    const version = ++refreshVersion.current;
    setSyncing(true);
    try {
      const shared = await loadSharedPlanningData();
      if (version !== refreshVersion.current) return;
      const today = localIsoDate(0);
      const requestedItem=new URLSearchParams(location.search).get("item");
      const todayTodos = shared.todos.filter((task) =>
        task.id===requestedItem || belongsToToday(task,today)
      );

      setSharedTodos(shared.todos);
      setSharedNotes(shared.notes);
      setSharedEvents(shared.events);
      setTodayItems(current => todayTodos.map((task) => ({
        id: task.id,
        title: task.title,
        meta: [task.due_on ? dueMeta(task.due_on) : "No due date",task.scheduled_on ? `Scheduled ${task.scheduled_on}${task.scheduled_start ? " at "+task.scheduled_start.slice(0,5):""}` : "",prerequisiteReason(task,shared.todos,shared.items.map(waypointRowToCapturedItem))].filter(Boolean).join(" · "),
        completed: pendingTaskIds.current.has(task.id) ? (current.find(item=>item.id===task.id)?.completed ?? task.completed) : task.completed,
      })));
      setEvents(shared.events.map((event) => ({
        id: event.id,
        read_only:event.read_only,source:event.source,source_href:event.source_href,
        title: event.title,
        date: event.event_date,
        time: event.start_time?.slice(0, 5) || "",
        endTime:event.end_time?.slice(0,5) || "", allDay:event.is_all_day,
      })));
      setLibraryItems(shared.items.map(waypointRowToCapturedItem));
      setCaptureHistory(shared.captures);
      setPlanningLoaded(true);
      setSyncError(shared.warnings.length?shared.warnings.join(" "):null);
    } catch (error) {
      if (version === refreshVersion.current) setSyncError(error instanceof Error ? error.message : "Waypoint could not sync ARROW planning data.");
    } finally {
      if (version === refreshVersion.current) setSyncing(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && tabs.some((item) => item.id === tab)) {
      setTab(tab as WaypointTab);
    }

    const pop=()=>{const tab=new URLSearchParams(location.search).get('tab');setTab(tabs.some(t=>t.id===tab)?tab as WaypointTab:'today');};
    window.addEventListener('popstate',pop);
    const owner=currentPlanningAccount();draftOwner.current=owner;
    if(owner) { try {const cached=JSON.parse(localStorage.getItem(draftKey(owner)) || 'null');
      if(cached?.version===2 && cached.owner===owner && typeof cached.dump==='string' && cached.dump.length<=16000 && Date.now()-cached.savedAt<7*86400000) {
        setDump(cached.dump);setCaptures(Array.isArray(cached.captures)?cached.captures.slice(0,14):[]);setInterpretation(cached.interpretation || null);setActiveCaptureId(cached.captureId || null);setDraftNotice('Your unfinished Capture was restored on this device.');
      }
    }catch {setDraftNotice('Your saved draft could not be restored.');}}
    setDraftReady(true);
    let cancelled = false;
    const bootstrap = async () => {
      const legacy = safeJsonList<CapturedItem>(LIBRARY_KEY)
        .filter((item) => typeof item.id === "string" && typeof item.title === "string");

      if (legacy.length) {
        try {
          await migrateLegacyWaypointItems(legacy);
          if (!cancelled) localStorage.removeItem(LIBRARY_KEY);
        } catch (error) {
          if (!cancelled) {
            setSyncError(error instanceof Error ? error.message : "Waypoint could not migrate older local planning data.");
          }
        }
      }

      if (!cancelled) await refreshSharedPlanning();
    };

    void bootstrap();
    const poll=window.setInterval(()=>{if(!document.hidden)void refreshSharedPlanning();},30000);

    const refresh = () => void refreshSharedPlanning();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "arrow_shared_data_ping_v1") refresh();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("arrow:planning-changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    const visible=()=>{if(!document.hidden)refresh();};
    document.addEventListener("visibilitychange",visible);
    return () => {
      cancelled = true;
      refreshVersion.current++;
      window.clearInterval(poll);
      window.removeEventListener('popstate',pop);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("arrow:planning-changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online",refresh);
      document.removeEventListener("visibilitychange",visible);
    };
  }, []);

  useEffect(()=>{
    const tick=()=>{setNow(new Date());if(currentPlanningAccount()!==draftOwner.current){setDump('');setCaptures([]);setInterpretation(null);setActiveCaptureId(null);setDraftReady(false);setSharedTodos([]);setLibraryItems([]);setTodayItems([]);setPlanningLoaded(false);}};
    const interval=window.setInterval(tick,30000);window.addEventListener('storage',tick);window.addEventListener('focus',tick);
    return()=>{clearInterval(interval);window.removeEventListener('storage',tick);window.removeEventListener('focus',tick);};
  },[]);
  useEffect(()=>{
    const owner=draftOwner.current;
    if(!draftReady || !owner || owner!==currentPlanningAccount() || reviewingCapture)return;
    try {if(dump.trim() || captures.length || interpretation) {
      localStorage.setItem(draftKey(owner),JSON.stringify({version:2,owner,dump,captures,interpretation,captureId:activeCaptureId,savedAt:Date.now()}));
    } else localStorage.removeItem(draftKey(owner));}
    catch {setDraftNotice('Draft recovery is unavailable on this device. Keep this page open until you approve your Capture.');}
  },[draftReady,dump,captures,interpretation,activeCaptureId,reviewingCapture]);
  const daily=useMemo(()=>buildDailyPlan(sharedTodos.map(task=>({...task,completed:todayItems.find(item=>item.id===task.id)?.completed ?? task.completed})),sharedEvents,libraryItems,now),[sharedTodos,sharedEvents,libraryItems,now,todayItems]);
  function openHistory(capture:ArrowWaypointCapture) {
    setReviewingCapture(true);setDump(capture.raw_input);setCaptures([]);setActiveCaptureId(null);
    setInterpretation({...capture,items:[]});setActiveTab('dump');
  }
  function leaveHistory() {
    const owner=draftOwner.current;
    if(owner!==currentPlanningAccount())return;
    try {const draft=owner ? JSON.parse(localStorage.getItem(draftKey(owner)) || 'null') : null;
      setDump(draft?.dump || '');setCaptures(draft?.captures || []);setInterpretation(draft?.interpretation || null);setActiveCaptureId(draft?.captureId || null);
    }catch {setDump('');setCaptures([]);setInterpretation(null);setActiveCaptureId(null);}
    setReviewingCapture(false);
  }
  const completed = todayItems.filter((item) => item.completed).length;
  const progress = todayItems.length ? Math.round((completed / todayItems.length) * 100) : 0;

  async function processDump() {
    if (!dump.trim() || isInterpreting || isApplyingCapture || reviewingCapture) return;
    setIsInterpreting(true);
    setInterpretation(null);
    setActiveCaptureId(null);

    const requestOwner=currentPlanningAccount();
    const sourceKey = `capture:${crypto.randomUUID()}`;

    try {
      const result = await interpretWithRavin(dump, {
        tasks: sharedTodos.map((task) => ({
          id: task.id,
          due_on: task.due_on, estimated_minutes: task.estimated_minutes, scheduled_on: task.scheduled_on, scheduled_start: task.scheduled_start,
          title: task.title,
          meta: task.scheduled_on===localIsoDate(0)&&task.scheduled_start ? `Scheduled ${task.scheduled_start.slice(0,5)}` : task.due_on ? dueMeta(task.due_on) : "No due date",
          completed: task.completed,
        })),
        events: sharedEvents.map(event=>({id:event.id,title:event.title,date:event.event_date,time:event.start_time?.slice(0,5),end_time:event.end_time,is_all_day:event.is_all_day})),
        library: [...libraryItems,...sharedNotes],
      });
      if(requestOwner!==currentPlanningAccount())return;
      setCaptures(result.items);
      setInterpretation(result);

      try {
        const saved = await saveSharedWaypointCapture(dump, result, sourceKey);
        setActiveCaptureId(saved?.id || null);
        await refreshSharedPlanning();
      } catch (saveError) {
        setSyncError(saveError instanceof Error ? saveError.message : "Waypoint could not save this Capture history.");
      }
    } catch (error) {
      if(requestOwner!==currentPlanningAccount())return;
      const fallback = interpretBrainDump(dump).map(item=>({...item, accepted:false}));
      const fallbackInterpretation: WaypointInterpretation = {
        summary: `RAVIN is unavailable right now, so Waypoint used its local capture sorter instead. ${error instanceof Error ? error.message : ""}`.trim(),
        intent: null,
        next_move: "Retry RAVIN, or edit and select the local draft items before applying.",
        signals: [],
        route: [].map((item: CapturedItem, index) => ({
          order: index + 1,
          title: item.title,
          reason: "Local fallback ordering",
          timing: item.when || null,
        })),
        questions: [],
        items: fallback,
        source: "local",
      };
      setCaptures(fallback);
      setInterpretation(fallbackInterpretation);

      try {
        const saved = await saveSharedWaypointCapture(dump, fallbackInterpretation, sourceKey);
        setActiveCaptureId(saved?.id || null);
        await refreshSharedPlanning();
      } catch (saveError) {
        setSyncError(saveError instanceof Error ? saveError.message : "Waypoint could not save this Capture history.");
      }
    } finally {
      setIsInterpreting(false);
    }
  }

  function toggleCapture(id: string) {
    if (isApplyingCapture) return;
    setCaptures((current) =>
      current.map((item) => item.id === id ? { ...item, accepted: !item.accepted } : item)
    );
  }

  function editCapture(id: string, patch: Partial<CapturedItem>) {
    if (!isApplyingCapture) setCaptures(current=>current.map(item=>item.id===id ? {...item,...patch} : item));
  }

  async function acceptCaptures() {
    if(reviewingCapture)return;
    const accepted = captures.filter((item) => item.accepted);
    if (!accepted.length || isApplyingCapture || isInterpreting) return;
    const undated = accepted.find(item=>item.type==='event' && !resolveCaptureDate(item));
    if (undated) { setSyncError(`Choose a date for “${undated.title}” before applying this capture.`); return; }

    const invalid = accepted.find(item => (item.placement && !allowedPlacements(item.type).includes(item.placement)) || !item.title.trim() || item.title.length > 120 ||
      (item.date && !resolveCaptureDate(item)) ||
      (item.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) ||
      (item.duration_minutes != null && (!Number.isInteger(item.duration_minutes) || item.duration_minutes < (item.type==='task'?5:1) || item.duration_minutes > (item.type==='task'?720:1440))) ||
      (item.type==='event' && item.time && item.duration_minutes && Number(item.time.slice(0,2))*60+Number(item.time.slice(3))+item.duration_minutes>=1440));
    if (invalid) {setSyncError(`Check the title, date, time, and duration for “${invalid.title}”. Events crossing midnight need separate dates.`);return;}
    const todayTasks = accepted.filter(item=>item.type==='task' && (!item.placement || item.placement==='today'));
    const capturedEvents = accepted.filter(item=>item.type==='event');
    setIsApplyingCapture(true);
    setSyncError(null);
    try {
      let captureId=activeCaptureId;
      if (!captureId) {
        if (!interpretation) throw new Error("Interpret this Capture before applying.");
        const saved=await saveSharedWaypointCapture(dump,interpretation,`capture:${crypto.randomUUID()}`);
        captureId=saved?.id || null;
        if (!captureId) throw new Error("Capture history could not be saved. Retry before applying.");
        setActiveCaptureId(captureId);
      }
      const items=accepted.map(item=>({...item, date:resolveCaptureDate(item) || (item.type==='task' && (!item.placement || item.placement==='today') ? localIsoDate(0) : null)}));
      await applySharedCapture(captureId,items);
      await refreshSharedPlanning();
      window.dispatchEvent(new CustomEvent("arrow:planning-changed"));

      const nextTab: WaypointTab =
        todayTasks.length ? "today"
          : capturedEvents.length ? "calendar"
            : accepted.some((item) => item.placement === "plans" || item.type === "project" || item.type === "later") ? "plans"
              : accepted.some((item) => item.placement === "direction" || item.type === "goal") ? "direction"
                : "today";

      setDump("");
      setCaptures([]);
      setInterpretation(null);
      setActiveCaptureId(null);
      setActiveTab(nextTab);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Waypoint could not save that route to ARROW.");
    } finally {
      setIsApplyingCapture(false);
    }
  }

  async function toggleTodayItem(id: string, completed: boolean) {
    if(pendingTaskIds.current.has(id))return;
    pendingTaskIds.current.add(id);
    refreshVersion.current++;
    setPendingTasks(current=>new Set(current).add(id));
    setTodayItems((current) =>
      current.map((item) => item.id === id ? { ...item, completed } : item)
    );

    try {
      await setSharedTodoCompleted(id, completed);
      window.dispatchEvent(new CustomEvent("arrow:planning-changed"));
    } catch (error) {
      setTodayItems((current) =>
        current.map((item) => item.id === id ? { ...item, completed: !completed } : item)
      );
      setSyncError(error instanceof Error ? error.message : "Waypoint could not update that task.");
    } finally {pendingTaskIds.current.delete(id); setSyncing(false); setPendingTasks(current=>{const next=new Set(current);next.delete(id);return next;});}
  }

  useEffect(()=>{if(syncing)return;const id=new URLSearchParams(location.search).get('item');if(!id)return;const handle=window.setTimeout(()=>document.getElementById('item-'+id)?.scrollIntoView({block:'center',behavior:document.documentElement.dataset.arrowMotion==='reduce'?'auto':'smooth'}),100);return()=>clearTimeout(handle);},[syncing,activeTab]);
  const acceptedCount = useMemo(
    () => captures.filter((item) => item.accepted).length,
    [captures]
  );

  const futureTodos = useMemo(
    () => sharedTodos.filter((task) => !task.completed && (task.due_on > localIsoDate(0) || (task.scheduled_on && task.scheduled_on > localIsoDate(0)))),
    [sharedTodos,now]
  );

  async function activateAction(item:CapturedItem) {
    if (isApplyingCapture) return;
    setIsApplyingCapture(true);
    try {await activateSharedAction(item.id.startsWith('waypoint:')?item.id:`waypoint:${item.id}`,localIsoDate(0));await refreshSharedPlanning();setActiveTab('today');}
    catch(error){setSyncError(error instanceof Error?error.message:'That action could not move to Today.');}
    finally {setIsApplyingCapture(false);}
  }

  async function archiveWaypointItem(item: CapturedItem) {
    const sourceKey = item.id.startsWith("waypoint:") ? item.id : `waypoint:${item.id}`;
    try {
      await archiveSharedWaypointItem(sourceKey);
      await refreshSharedPlanning();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Waypoint could not archive that item.");
    }
  }

  return (
    <main className="waypoint-app">
      <div className="ambient-grid" />
      <div className="ambient-glow ambient-glow-a" />
      <div className="ambient-glow ambient-glow-b" />

      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <BeaconIcon size={34} active />
          </div>
          <div>
            
            <div className="brand-name">Waypoint</div>
          </div>
        </div>

        <nav className="nav">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button type="button"
              key={id}
              className={`nav-item ${activeTab === id ? "active" : ""}`} aria-current={activeTab===id?'page':undefined}
              onClick={() => setActiveTab(id)}
            >
              <Icon width={19} height={19} />
              <span>{label}</span>
              {id === "dump" && captures.length > 0 ? (
                <span className="nav-badge">{captures.length}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="orbit-button"
            type="button"
            onClick={(event) => {
              const arrowOS = (window as Window & {
                ArrowOS?: {
                  launchToOrbit?: (module: string, anchor?: HTMLElement) => void;
                };
              }).ArrowOS;

              if (arrowOS?.launchToOrbit) {
                arrowOS.launchToOrbit("waypoint", event.currentTarget);
                return;
              }

              const url = new URL(ORBIT_URL, window.location.origin);
              url.searchParams.set("from", "waypoint");
              window.location.assign(url.toString());
            }}
          >
            <span className="orbit-dot" />
            Back to Orbit
          </button>
          
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div>
            
            <h1>{tabTitle(activeTab)}</h1>
          </div>

          <div className="topbar-actions">
            <div data-arrow-os-shell data-module="waypoint" suppressHydrationWarning />
            <button type="button" className="icon-button" aria-label="Quick add" onClick={() => setActiveTab("dump")}>
              <PlusIcon width={18} height={18} />
            </button>
            <button type="button" className="ravin-chip" onClick={() => {
              const shell=(window as Window & {ArrowOS?:{openQuickRavin?:(module:string)=>void}}).ArrowOS;
              if(shell?.openQuickRavin) shell.openQuickRavin('waypoint');
              else openRavinFromWaypoint();
            }}>
              <SparkIcon width={16} height={16} />
              Ask RAVIN
            </button>
          </div>
        </header>

        <div className="content">
          {planningLoaded && <PlanningControls tasks={sharedTodos} events={sharedEvents} plans={libraryItems} onChanged={refreshSharedPlanning} />}
          {(syncError || syncing) && (
            <div className={`waypoint-sync-state ${syncError ? "error" : ""}`}>
              <span>{syncError || "Syncing Waypoint with your ARROW account…"}</span>
              {syncError ? (
                <button type="button" onClick={() => void refreshSharedPlanning()}>Retry</button>
              ) : null}
            </div>
          )}
          {!planningLoaded && activeTab !== "dump" && <div role="status" className="waypoint-sync-state">{syncing ? "Loading your tasks and plans…" : "Your tasks and plans could not load. Retry to see your next move."}</div>}
          {planningLoaded && activeTab === "today" && (
            <TodayView
              items={todayItems}
              daily={daily}
              pending={pendingTasks}
              onPlans={()=>setActiveTab('plans')}
              onPlan={()=>{document.querySelector<HTMLButtonElement>('[data-plan-week]')?.click();}}
              onToggle={toggleTodayItem}
              progress={progress}
              onDump={() => setActiveTab("dump")}
            />
          )}

          {activeTab === "dump" && (
            <DumpView
              dump={dump}
              reviewing={reviewingCapture}
              draftNotice={draftNotice}
              leaveHistory={leaveHistory}
              setDump={value=>{setDump(value);setCaptures([]);setInterpretation(null);setActiveCaptureId(null);setDraftNotice('Draft saved on this device.');}}
              captures={captures}
              processDump={processDump}
              toggleCapture={toggleCapture}
              editCapture={editCapture}
              acceptCaptures={acceptCaptures}
              acceptedCount={acceptedCount}
              isInterpreting={isInterpreting}
              isApplying={isApplyingCapture}
              interpretation={interpretation}
            />
          )}

          {planningLoaded && activeTab === "plans" && (
            <PlansView
              items={libraryItems}
              futureTodos={futureTodos}
              onArchive={archiveWaypointItem}
              onActivate={activateAction}
              busy={isApplyingCapture}
              onNewPlan={() => {
                if(reviewingCapture)leaveHistory();
                setDump(current=>current.trim() ? current+"\nI want to plan: " : "I want to plan: ");
                setCaptures([]);setInterpretation(null);setActiveCaptureId(null);
                setActiveTab("dump");
              }}
            />
          )}
          {planningLoaded && activeTab === "calendar" && <CalendarView events={events} onDelete={async id=>{await deleteSharedEvent(id);await refreshSharedPlanning();}} />}
          {planningLoaded && activeTab === "direction" && (
            <DirectionView items={libraryItems} onArchive={archiveWaypointItem} />
          )}
          {planningLoaded && activeTab === "review" && (
            <ReviewView
              items={todayItems}
              allTodos={sharedTodos}
              libraryItems={libraryItems}
              events={events}
              captures={captureHistory}
              onOpenCapture={openHistory}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function TodayView({
  items, onToggle, progress, onDump, daily, pending, onPlans, onPlan
}: {
  items: TodayItem[];
  onToggle: (id: string, completed: boolean) => void;
  progress: number;
  onDump: () => void;
  daily: ReturnType<typeof buildDailyPlan>;
  pending: Set<string>;
  onPlans: () => void;
  onPlan: () => void;
}) {
  const [filter,setFilter] = useState<'open' | 'all' | 'done'>('open');
  const open=items.filter(item=>!item.completed);
  const completed=items.length-open.length;
  const visible=[...items].filter(item=>filter==='all'||(filter==='open'?!item.completed:item.completed))
    .sort((a,b)=>Number(a.completed)-Number(b.completed));
  return (
    <div className="today-workspace">
      <div className="today-toolbar">
        <div className="today-overview">
          <span><strong>{open.length}</strong> open</span>
          <span><strong>{daily.available}</strong> min free</span>
          {daily.blockedCount>0 && <span><strong>{daily.blockedCount}</strong> blocked</span>}
        </div>
        <div className="today-actions">
          <button type="button" onClick={onPlan}>Plan week</button>
          <button type="button" onClick={onPlans}>Plans</button>
          <button type="button" className="today-new" onClick={onDump}>+ Capture</button>
        </div>
      </div>
      <section className="panel today-task-sheet" aria-labelledby="waypoint-today-tasks">
        <div className="today-sheet-header">
          <div>
            <h2 id="waypoint-today-tasks">Tasks</h2>
            <span>{completed} of {items.length} complete</span>
          </div>
          <strong className="today-percent">{progress}%</strong>
        </div>
        <div className="today-progress-track" role="progressbar" aria-label="Tasks completed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span style={{width:progress+'%'}} />
        </div>
        <div className="today-filter-tabs" role="group" aria-label="Filter tasks">
          <button type="button" aria-pressed={filter==='open'} onClick={()=>setFilter('open')}>Open <span>{open.length}</span></button>
          <button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All <span>{items.length}</span></button>
          <button type="button" aria-pressed={filter==='done'} onClick={()=>setFilter('done')}>Done <span>{completed}</span></button>
        </div>
        <div className="task-list today-task-list">
          {!visible.length && <div className="today-empty">{filter==='done'?'No completed tasks':filter==='open'?'No open tasks':'No tasks today'}</div>}
          {visible.map(item=>(
            <button type="button"
              id={'item-'+item.id}
              className={'task-row'+(item.completed?' done':'')}
              key={item.id} disabled={pending.has(item.id)}
              aria-pressed={Boolean(item.completed)}
              aria-label={(item.completed?'Reopen ':'Complete ')+item.title}
              onClick={()=>void onToggle(item.id,!item.completed)}
            >
              <span className="task-check" aria-hidden="true">{item.completed?'✓':''}</span>
              <span className="task-main"><strong>{item.title}</strong><small>{item.meta}</small></span>
              <span className="task-status">{item.completed?'Done':'Open'}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function DumpView({
  dump,
  setDump,
  captures,
  processDump,
  toggleCapture,
  editCapture,
  acceptCaptures,
  acceptedCount,
  isInterpreting,
  isApplying,
  interpretation, reviewing, draftNotice, leaveHistory
}: {
  dump: string;
  setDump: (value: string) => void;
  captures: CapturedItem[];
  processDump: () => void | Promise<void>;
  toggleCapture: (id: string) => void;
  editCapture: (id: string, patch: Partial<CapturedItem>) => void;
  acceptCaptures: () => void;
  acceptedCount: number;
  isInterpreting: boolean;
  isApplying: boolean;
  interpretation: WaypointInterpretation | null;
  reviewing:boolean;
  draftNotice:string;
  leaveHistory:()=>void;
}) {
  return (
    <div className="dump-layout">
      {(reviewing || draftNotice) && <div className="capture-recovery" role="status"><span>{reviewing ? 'History · read-only' : draftNotice}</span>{reviewing && <button type="button" onClick={leaveHistory}>Return to unfinished Capture</button>}</div>}
      <section className="panel dump-input-panel">
        <div className="dump-prompt">
          <BeaconIcon size={50} active />
          <div>
            
            <h2>New capture</h2>
          </div>
        </div>

        <textarea
          value={dump}
          aria-label="Capture your thoughts" maxLength={16000} readOnly={reviewing}
          disabled={isInterpreting || isApplying}
          onChange={(event) => setDump(event.target.value)}
          placeholder="Add tasks, notes, or ideas…"
          className="brain-textarea"
        />

        <div className="dump-actions">
          <span>
            {dump.length
              ? `${dump.split(/\s+/).filter(Boolean).length} words`
              : ""}
          </span>
          <button type="button"
            className="primary-button"
            disabled={!dump.trim() || isInterpreting || isApplying || reviewing}
            onClick={processDump}
          >
            <SparkIcon width={17} height={17} />
            {isInterpreting ? "Organizing…" : "Organize with RAVIN"}
          </button>
        </div>
      </section>

      {interpretation && (
        <>
          <section className="capture-analysis-grid">
            <article className="panel reasoning-card reasoning-summary">
              {interpretation.source !== "ravin" && <div className="eyebrow">Local analysis</div>}
              <h3>{interpretation.summary}</h3>
              {interpretation.intent ? (
                <div className="reasoning-detail">
                  <span>Goal</span>
                  <strong>{interpretation.intent}</strong>
                </div>
              ) : null}
            </article>

            <article className="panel reasoning-card reasoning-next">
              <div className="eyebrow">Next step</div>
              <div className="next-move-mark"><BeaconIcon size={36} active /></div>
              <h3>{interpretation.next_move || "Review the suggestions below."}</h3>
              
            </article>
          </section>

          {interpretation.signals.length > 0 && (
            <section className="panel reasoning-section">
              <div className="panel-heading">
                <div>
                  
                  <h3>Key details</h3>
                </div>
                <span className="soft-pill">{interpretation.signals.length}</span>
              </div>

              <div className="signal-grid">
                {interpretation.signals.map((signal, index) => (
                  <div className="signal-card" key={`${signal.kind}-${signal.title}-${index}`}>
                    <span className={`signal-kind signal-${signal.kind}`}>{signal.kind}</span>
                    <strong>{signal.title}</strong>
                    <p>{signal.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {interpretation.route.length > 0 && (
            <section className="panel reasoning-section">
              <div className="panel-heading">
                <div>
                  
                  <h3>Steps</h3>
                </div>
              </div>

              <div className="route-list">
                {interpretation.route.map((step) => (
                  <div className="route-row" key={`${step.order}-${step.title}`}>
                    <span className="route-index">{String(step.order).padStart(2, "0")}</span>
                    <div className="route-copy">
                      <strong>{step.title}</strong>
                      {step.reason ? <p>{step.reason}</p> : null}
                    </div>
                    {step.timing ? <span className="route-timing">{step.timing}</span> : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {interpretation.questions.length > 0 && (
            <section className="panel reasoning-section questions-section">
              <div className="panel-heading">
                <div>
                  
                  <h3>Questions</h3>
                </div>
              </div>
              <div className="question-list">
                {interpretation.questions.map((question, index) => (
                  <div className="question-row" key={`${index}-${question}`}>
                    <span>?</span>
                    <strong>{question}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {captures.length > 0 && (
            <section className="panel capture-panel">
              <div className="panel-heading">
                <div>
                  
                  <h3>Suggested items</h3>
                </div>
                <span className="soft-pill">{acceptedCount} selected</span>
              </div>

              <div className="capture-list">
                {captures.map((item) => (
                  <article key={item.id} className={`capture-row ${item.accepted ? "selected" : ""}`}>
                    <label><input type="checkbox" checked={Boolean(item.accepted)} disabled={isApplying} onChange={()=>toggleCapture(item.id)} aria-label={`Select ${item.title}`} /></label>
                    <div className="capture-copy">
                      <strong>{item.title}</strong>
                      {item.why ? <p className="capture-why">{item.why}</p> : null}
                      <details><summary>Edit proposal</summary>
                        <div className="capture-editor">
                          <label>Title<input value={item.title} maxLength={120} disabled={isApplying} onChange={e=>editCapture(item.id,{title:e.target.value})}/></label>
                          <label>Type<select value={item.type} disabled={isApplying} onChange={e=>{const type=e.target.value as CapturedItem['type'];editCapture(item.id,{type,placement:type==='event'?'calendar':type==='note'?'notes':type==='goal'?'direction':type==='later'?'later':'plans'});}}>{['task','event','note','goal','project','later'].map(type=><option key={type}>{type}</option>)}</select></label>
                          <label>Placement<select value={item.placement || 'plans'} disabled={isApplying} onChange={e=>editCapture(item.id,{placement:e.target.value as CapturedItem['placement']})}>{allowedPlacements(item.type).map(place=><option key={place}>{place}</option>)}</select></label>
                          <label>Date<input type="date" value={item.date || ''} disabled={isApplying} onChange={e=>editCapture(item.id,{date:e.target.value || null,when:null})}/></label>
                          <label>Time<input type="time" value={item.time || ''} disabled={isApplying} onChange={e=>editCapture(item.id,{time:e.target.value || null})}/></label>
                          <label>Duration (minutes)<input type="number" min={item.type==='task'?5:1} max={item.type==='task'?720:1440} value={item.duration_minutes ?? ''} disabled={isApplying} onChange={e=>editCapture(item.id,{duration_minutes:e.target.value?Number(e.target.value):null})}/></label>
                          <label>Priority<select value={item.priority || 'medium'} disabled={isApplying} onChange={e=>editCapture(item.id,{priority:e.target.value as CapturedItem['priority']})}>{['low','medium','high'].map(priority=><option key={priority}>{priority}</option>)}</select></label>
                          <label>Prerequisites (one per line)<textarea value={(item.depends_on || []).join('\n')} disabled={isApplying} onChange={e=>editCapture(item.id,{depends_on:e.target.value.split('\n').map(x=>x.trim()).filter(Boolean)})}/></label>
                          <label>Context<textarea value={item.context || ''} disabled={isApplying} onChange={e=>editCapture(item.id,{context:e.target.value || null})}/></label>
                        </div>
                      </details>
                      <small>{item.type} · {item.placement || 'plans'} · {item.date || item.when || 'No deadline'}{item.time ? ` · ${item.time}` : ''}{item.duration_minutes ? ` · ${item.duration_minutes} min` : ''}</small>
                    </div>
                  </article>
                ))}
              </div>

              <div className="capture-footer">
                <span>Nothing changes until you approve it.</span>
                <button type="button"
                  className="primary-button"
                  onClick={acceptCaptures}
                  disabled={!acceptedCount || isApplying}
                >
                  {isApplying ? "Applying…" : "Apply selected"}
                </button>
              </div>
            </section>
          )}

          {!captures.length && !reviewing && (
            <section className="panel reasoning-section no-changes-card">
              
              <h3>No items to add</h3>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PlansView({
  items,
  futureTodos,
  onArchive,
  onActivate,
  busy,
  onNewPlan
}: {
  items: CapturedItem[];
  futureTodos: ArrowTodo[];
  onArchive: (item: CapturedItem) => void | Promise<void>;
  onActivate: (item: CapturedItem) => void | Promise<void>;
  busy: boolean;
  onNewPlan: () => void;
}) {
  const projects = items.filter((item) => item.type === "project");
  const upcoming = items.filter((item) => item.type === "task" && item.placement !== "today");
  const loose = items.filter((item) => item.type === "note" || item.type === "later");

  return (
    <div className="stack">

      <div className="plan-grid">
        {projects.map((plan) => (
          <article className="panel plan-card" key={plan.id}>
            <div className="plan-top">
              <BeaconIcon size={28} />
              <span>{(plan.priority || "medium").toUpperCase()}</span>
            </div>
            <h3>{plan.title}</h3>
            <div className="next-step">
              <small>NEXT STEP</small>
              <strong>{plan.context || "Choose the first concrete action."}</strong>
            </div>
            <button className="row-action" type="button" onClick={() => void onArchive(plan)}>
              Archive
            </button>
          </article>
        ))}

        {!projects.length ? (
          <article className="panel plan-card">
            <div className="plan-top">
              <BeaconIcon size={28} />
              
            </div>
            <h3>No plans yet</h3>
          </article>
        ) : null}

        <button type="button" className="panel new-plan-card" onClick={onNewPlan}>
          <PlusIcon width={22} height={22} />
          <span>New plan</span>
        </button>
      </div>

      {(upcoming.length || futureTodos.length) ? (
        <section className="panel capture-panel">
          <div className="panel-heading">
            <div>
              
              <h3>Upcoming tasks</h3>
            </div>
            <span className="soft-pill">{upcoming.length + futureTodos.length}</span>
          </div>
          <div className="capture-list">
            {futureTodos.map((task) => (
              <div className="capture-row selected" key={task.id}>
                <span className="type-dot type-task" />
                <span className="capture-copy">
                  <strong>{task.title}</strong>
                  <small>{dueMeta(task.due_on)}{task.scheduled_on ? ` · Scheduled ${task.scheduled_on} ${task.scheduled_start?.slice(0,5) || ''}` : ''}</small>
                </span>
                <span className="capture-check">→</span>
              </div>
            ))}
            {upcoming.map((item) => (
              <div className="capture-row selected" key={item.id}>
                <span className={`type-dot type-${item.type}`} />
                <span className="capture-copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.priority || "medium"}
                    {item.when ? ` · ${item.when}` : ""}
                    {item.duration_minutes ? ` · ~${item.duration_minutes} min` : ""}
                  </small>
                  {item.context ? <em>{item.context}</em> : null}
                </span>
                <button className="row-action" type="button" disabled={busy} onClick={()=>void onActivate(item)}>Move to Today</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {loose.length ? (
        <section className="panel capture-panel">
          <div className="panel-heading">
            <div>
              
              <h3>Notes &amp; later</h3>
            </div>
            <span className="soft-pill">{loose.length}</span>
          </div>
          <div className="capture-list">
            {loose.map((item) => (
              <div className="capture-row selected" key={item.id}>
                <span className={`type-dot type-${item.type}`} />
                <span className="capture-copy">
                  <strong>{item.title}</strong>
                  <small>{item.type}{item.when ? ` · ${item.when}` : ""}</small>
                </span>
                <button className="row-action compact" type="button" onClick={() => void onArchive(item)}>
                  Archive
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CalendarView({ events, onDelete }: { events: SharedEvent[]; onDelete:(id:string)=>Promise<void> }) {
  const [week,setWeek]=useState(0);
  useEffect(()=>{const id=new URLSearchParams(location.search).get('item');const event=events.find(e=>e.id===id);if(event){const target=new Date(event.date+'T12:00:00');const today=new Date();today.setHours(12,0,0,0);const offset=(today.getDay()+6)%7;today.setDate(today.getDate()-offset);setWeek(Math.floor((target.getTime()-today.getTime())/(7*86400000)));}},[events]);const [error,setError]=useState('');const [busy,setBusy]=useState<string|null>(null);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  const mondayOffset = (today.getDay() + 6) % 7;
  start.setDate(today.getDate() - mondayOffset + week * 7);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
    return {
      iso,
      label: date.toLocaleDateString([], { weekday: "short", day: "numeric" }).toUpperCase(),
      isToday: iso === localIsoDate(0),
      events: events
        .filter((event) => event.date === iso)
        .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    };
  });

  return (
    <div className="stack">

      <section className="panel week-panel">
        <h3 className="week-range">{days[0].iso} – {days[6].iso}</h3>
        <div className="calendar-week-controls"><button type="button" onClick={()=>setWeek(week-1)}>Previous week</button><button type="button" onClick={()=>setWeek(0)}>This week</button><button type="button" onClick={()=>setWeek(week+1)}>Next week</button></div>
        {error&&<p role="alert">{error}</p>}
        <div className="week-row">
          {days.map((day) => (
            <div
              className={`day-column ${day.isToday ? "today-column" : ""}`}
              key={day.iso}
            >
              <div className="day-name">{day.label}</div>
              {day.events.length ? day.events.map((event) => (
                <div className="time-block visible" id={`item-${event.id}`} key={event.id}>
                  <time>{event.allDay ? 'All day' : event.time ? `${event.time}${event.endTime ? '–'+event.endTime : ' · end time not set'}` : 'Time not set'}</time>{event.title}{event.read_only?<a href={event.source_href}>{event.source||"Open source"} ↗</a>:<button type="button" disabled={busy===event.id} aria-label={`Remove ${event.title}`} onClick={async()=>{if(!confirm(`Remove ${event.title} from your calendar?`))return;setBusy(event.id);setError('');try{await onDelete(event.id);}catch(e){setError(e instanceof Error?e.message:'Could not remove event.');}finally{setBusy(null);}}}>×</button>}
                </div>
              )) : (
                <div className="time-block muted" aria-label="No events" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DirectionView({
  items,
  onArchive
}: {
  items: CapturedItem[];
  onArchive: (item: CapturedItem) => void | Promise<void>;
}) {
  const goals = items.filter((item) => item.type === "goal");

  return (
    <div className="direction-layout">

      <section className="panel horizons">
        <div className="panel-heading">
          <div>
            
            <h3>Goals</h3>
          </div>
        </div>

        {goals.length ? goals.map((goal) => (
          <div className="horizon-row" key={goal.id}>
            {goal.when ? <span>{goal.when}</span> : null}
            <strong>{goal.title}</strong>
            <button className="row-action compact" type="button" onClick={() => void onArchive(goal)}>
              Archive
            </button>
          </div>
        )) : (
          <div className="horizon-row">
            
            <strong>No goals yet</strong>
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewView({
  items,
  allTodos,
  libraryItems,
  events,
  captures, onOpenCapture
}: {
  items: TodayItem[];
  allTodos: ArrowTodo[];
  libraryItems: CapturedItem[];
  events: SharedEvent[];
  captures: ArrowWaypointCapture[];
  onOpenCapture:(capture:ArrowWaypointCapture)=>void;
}) {
  const completed = allTodos.filter((item) => item.completed).length;
  const projects = libraryItems.filter((item) => item.type === "project");
  const goals = libraryItems.filter((item) => item.type === "goal");
  const postponed = libraryItems.filter((item) => item.type === "later");

  return (
    <div className="review-grid">
      <section className="panel metric-card">
        <span className="metric">{completed}</span>
        <small>Tasks completed</small>
      </section>
      <section className="panel metric-card">
        <span className="metric">{projects.length}</span>
        <small>Plans</small>
      </section>
      <section className="panel metric-card">
        <span className="metric">{postponed.length}</span>
        <small>Saved for later</small>
      </section>

      <section className="panel review-story">
        
        <h2>Overview</h2>

        <div className="review-line">
          <span>Open today / overdue</span>
          <strong>{items.filter((item) => !item.completed).length}</strong>
        </div>
        <div className="review-line">
          <span>Direction</span>
          <strong>{goals.length ? `${goals.length} saved goal${goals.length === 1 ? "" : "s"}` : "No saved goals yet"}</strong>
        </div>
        <div className="review-line">
          <span>Calendar</span>
          <strong>{events.length ? `${events.length} saved event${events.length === 1 ? "" : "s"}` : "No saved events yet"}</strong>
        </div>
      </section>

      <section className="panel capture-history">
        <div className="panel-heading">
          <div>
            
            <h3>Capture history</h3>
          </div>
          <span className="soft-pill">{captures.length}</span>
        </div>
        {captures.length ? (
          <div className="capture-history-list">
            {captures.slice(0, 8).map((capture) => (
              <div className="capture-history-row" key={capture.id}>
                <div>
                  <strong>{capture.summary || "Capture"}</strong>
                  <small>
                    {new Date(capture.created_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit"
                    })}
                    {capture.applied ? " · applied" : " · reviewed"}
                  </small>
                </div>
                
                <button type="button" onClick={()=>onOpenCapture(capture)}>Open reasoning</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="interpretation-summary">No captures yet.</p>
        )}
      </section>
    </div>
  );
}

function tabTitle(tab: WaypointTab) {
  const map: Record<WaypointTab, string> = {
    today: "Today",
    dump: "Capture",
    plans: "Plans",
    calendar: "Calendar",
    direction: "Direction",
    review: "Review"
  };

  return map[tab];
}

