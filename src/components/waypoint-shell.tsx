"use client";
import {PlanningControls} from "./planning-controls";

import { useEffect, useMemo, useState } from "react";
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
  archiveSharedWaypointItem,
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
  id: string;
  title: string;
  date: string;
  time?: string;
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
  if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) return item.date;
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
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function WaypointShell() {
  const [activeTab, setActiveTab] = useState<WaypointTab>("today");
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
  const [isApplyingCapture, setIsApplyingCapture] = useState(false);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<WaypointInterpretation | null>(null);

  const [pendingTasks, setPendingTasks] = useState<Set<string>>(new Set());
  async function refreshSharedPlanning() {
    setSyncing(true);
    try {
      const shared = await loadSharedPlanningData();
      const today = localIsoDate(0);
      const requestedItem=new URLSearchParams(location.search).get("item");
      const todayTodos = shared.todos.filter((task) =>
        task.id===requestedItem || task.scheduled_on===today || !task.due_on || task.due_on === today || (!task.completed && task.due_on < today)
      );

      setSharedTodos(shared.todos);
      setSharedEvents(shared.events);
      setTodayItems(todayTodos.map((task) => ({
        id: task.id,
        title: task.title,
        meta: task.scheduled_on===localIsoDate(0)&&task.scheduled_start ? `Scheduled ${task.scheduled_start.slice(0,5)}` : task.due_on ? dueMeta(task.due_on) : "No due date",
        completed: task.completed,
      })));
      setEvents(shared.events.map((event) => ({
        id: event.id,
        title: event.title,
        date: event.event_date,
        time: event.start_time?.slice(0, 5) || "",
      })));
      setLibraryItems(shared.items.map(waypointRowToCapturedItem));
      setCaptureHistory(shared.captures);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Waypoint could not sync ARROW planning data.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && tabs.some((item) => item.id === tab)) {
      setActiveTab(tab as WaypointTab);
    }

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
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("arrow:planning-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const completed = todayItems.filter((item) => item.completed).length;
  const progress = todayItems.length ? Math.round((completed / todayItems.length) * 100) : 0;

  async function processDump() {
    if (!dump.trim() || isInterpreting) return;
    setIsInterpreting(true);
    setInterpretation(null);
    setActiveCaptureId(null);

    const sourceKey = `capture:${crypto.randomUUID()}`;

    try {
      const result = await interpretWithRavin(dump, {
        tasks: sharedTodos.map((task) => ({
          id: task.id,
          title: task.title,
          meta: task.scheduled_on===localIsoDate(0)&&task.scheduled_start ? `Scheduled ${task.scheduled_start.slice(0,5)}` : task.due_on ? dueMeta(task.due_on) : "No due date",
          completed: task.completed,
        })),
        events,
        library: libraryItems,
      });
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
      const fallback = interpretBrainDump(dump);
      const fallbackInterpretation: WaypointInterpretation = {
        summary: `RAVIN is unavailable right now, so Waypoint used its local capture sorter instead. ${error instanceof Error ? error.message : ""}`.trim(),
        intent: null,
        next_move: fallback[0]?.title || null,
        signals: [],
        route: fallback.slice(0, 4).map((item, index) => ({
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
    setCaptures((current) =>
      current.map((item) => item.id === id ? { ...item, accepted: !item.accepted } : item)
    );
  }

  async function acceptCaptures() {
    const accepted = captures.filter((item) => item.accepted);
    if (!accepted.length || isApplyingCapture) return;

    const todayTasks = accepted
      .filter((item) => item.type === "task");

    const capturedEvents = accepted.flatMap((item) => {
      if (item.type !== "event") return [];
      const date = resolveCaptureDate(item);
      if (!date) return [];
      return [{
        sourceKey: `waypoint:${item.id}`,
        title: item.title,
        date,
        time: item.time || "",
      }];
    });

    const libraryAdds = accepted.filter((item) => {
      if (item.type === "event") return false;
      if (item.type === "task" && (!item.placement || item.placement === "today")) return false;
      return true;
    });

    const notes = accepted.filter((item) => item.type === "note");

    setIsApplyingCapture(true);
    setSyncError(null);
    try {
      await Promise.all([
        ...todayTasks.filter(item=>!sharedTodos.some(task=>!task.completed&&task.title.trim().toLowerCase()===item.title.trim().toLowerCase())).map((item) =>
          createSharedTodo(
            item.title,
            resolveCaptureDate(item) || localIsoDate(0),
            `waypoint:${item.id}`,
            item.duration_minutes || null,
          )
        ),
        ...capturedEvents.map((event) =>
          createSharedCalendarEvent(event.title, event.date, event.time || "", event.sourceKey)
        ),
        ...notes.map((item) =>
          createSharedArrowNote(
            item.title,
            [item.context, item.why, item.when ? `Timing: ${item.when}` : ""]
              .filter(Boolean)
              .join("\n") || item.title,
            `waypoint:${item.id}`,
          )
        ),
        upsertSharedWaypointItems(libraryAdds, activeCaptureId),
      ]);

      if (activeCaptureId) await markSharedWaypointCaptureApplied(activeCaptureId);

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
    if(pendingTasks.has(id))return;
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
    } finally {setPendingTasks(current=>{const next=new Set(current);next.delete(id);return next;});}
  }

  useEffect(()=>{if(syncing)return;const id=new URLSearchParams(location.search).get('item');if(!id)return;const handle=window.setTimeout(()=>document.getElementById('item-'+id)?.scrollIntoView({block:'center',behavior:document.documentElement.dataset.arrowMotion==='reduce'?'auto':'smooth'}),100);return()=>clearTimeout(handle);},[syncing,activeTab]);
  const acceptedCount = useMemo(
    () => captures.filter((item) => item.accepted).length,
    [captures]
  );

  const futureTodos = useMemo(
    () => sharedTodos.filter((task) => !task.completed && task.due_on > localIsoDate(0)),
    [sharedTodos]
  );

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
            <div className="eyebrow">ARROW</div>
            <div className="brand-name">Waypoint</div>
          </div>
        </div>

        <nav className="nav">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? "active" : ""}`}
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
          <div className="sidebar-caption">Give your life direction.</div>
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">{tabEyebrow(activeTab)}</div>
            <h1>{tabTitle(activeTab)}</h1>
          </div>

          <div className="topbar-actions">
            <div data-arrow-os-shell data-module="waypoint" suppressHydrationWarning />
            <button className="icon-button" aria-label="Quick add" onClick={() => setActiveTab("dump")}>
              <PlusIcon width={18} height={18} />
            </button>
            <button className="ravin-chip" onClick={() => openRavinFromWaypoint()}>
              <SparkIcon width={16} height={16} />
              Ask RAVIN
            </button>
          </div>
        </header>

        <div className="content">
          <PlanningControls tasks={sharedTodos} events={sharedEvents} plans={libraryItems} onChanged={refreshSharedPlanning} />
          {(syncError || syncing) && (
            <div className={`waypoint-sync-state ${syncError ? "error" : ""}`}>
              <span>{syncError || "Syncing Waypoint with your ARROW account…"}</span>
              {syncError ? (
                <button type="button" onClick={() => void refreshSharedPlanning()}>Retry</button>
              ) : null}
            </div>
          )}
          {activeTab === "today" && (
            <TodayView
              items={todayItems}
              onToggle={toggleTodayItem}
              progress={progress}
              onDump={() => setActiveTab("dump")}
            />
          )}

          {activeTab === "dump" && (
            <DumpView
              dump={dump}
              setDump={setDump}
              captures={captures}
              processDump={processDump}
              toggleCapture={toggleCapture}
              acceptCaptures={acceptCaptures}
              acceptedCount={acceptedCount}
              isInterpreting={isInterpreting}
              isApplying={isApplyingCapture}
              interpretation={interpretation}
            />
          )}

          {activeTab === "plans" && (
            <PlansView
              items={libraryItems}
              futureTodos={futureTodos}
              onArchive={archiveWaypointItem}
              onNewPlan={() => {
                setDump("I want to plan: ");
                setActiveTab("dump");
              }}
            />
          )}
          {activeTab === "calendar" && <CalendarView events={events} onDelete={async id=>{await deleteSharedEvent(id);await refreshSharedPlanning();}} />}
          {activeTab === "direction" && (
            <DirectionView items={libraryItems} onArchive={archiveWaypointItem} />
          )}
          {activeTab === "review" && (
            <ReviewView
              items={todayItems}
              allTodos={sharedTodos}
              libraryItems={libraryItems}
              events={events}
              captures={captureHistory}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function TodayView({
  items,
  onToggle,
  progress,
  onDump
}: {
  items: TodayItem[];
  onToggle: (id: string, completed: boolean) => void;
  progress: number;
  onDump: () => void;
}) {
  return (
    <div className="page-grid today-grid">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow">RIGHT NOW</div>
          <h2>One clear next move.</h2>
          <p>
            Waypoint keeps the whole picture nearby without making you stare at all of it at once.
          </p>
        </div>

        <div className="progress-orbit">
          <div className="progress-value">{progress}%</div>
          <div className="progress-label">today</div>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="51" className="progress-track" />
            <circle
              cx="60"
              cy="60"
              r="51"
              className="progress-ring"
              pathLength="100"
              strokeDasharray={`${progress} ${100 - progress}`}
            />
          </svg>
        </div>
      </section>

      <section className="panel primary-list-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">TODAY</div>
            <h3>Your moves</h3>
          </div>
          <span className="soft-pill">
            {items.filter((item) => !item.completed).length} remaining
          </span>
        </div>

        <div className="task-list">
          {items.map((item, index) => (
            <button
              id={`item-${item.id}`}
              className={`task-row ${item.completed ? "done" : ""}`}
              key={item.id}
              onClick={() => void onToggle(item.id, !item.completed)}
            >
              <span className="task-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="task-check">{item.completed ? "✓" : ""}</span>
              <span className="task-main">
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <button className="panel dump-card" onClick={onDump}>
        <div className="dump-card-icon">
          <SparkIcon width={18} height={18} />
        </div>
        <div>
          <div className="eyebrow">CAPTURE</div>
          <h3>Too much in your head?</h3>
          <p>
            Put it here as-is. RAVIN will read the whole situation, connect it to what Waypoint already knows, and find a route forward.
          </p>
        </div>
        <span className="arrow-glyph">↗</span>
      </button>

      <section className="panel now-card">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">FOCUS</div>
            <h3>Current objective</h3>
          </div>
        </div>

        <div className="focus-objective">
          <BeaconIcon size={42} active />
          <div>
            <strong>
              {items.find((item) => !item.completed)?.title ?? "You're clear."}
            </strong>
            <p>
              {items.find((item) => !item.completed)
                ? "This is the next unresolved item in today's route."
                : "Nothing else is demanding your attention."}
            </p>
          </div>
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
  acceptCaptures,
  acceptedCount,
  isInterpreting,
  isApplying,
  interpretation
}: {
  dump: string;
  setDump: (value: string) => void;
  captures: CapturedItem[];
  processDump: () => void | Promise<void>;
  toggleCapture: (id: string) => void;
  acceptCaptures: () => void;
  acceptedCount: number;
  isInterpreting: boolean;
  isApplying: boolean;
  interpretation: WaypointInterpretation | null;
}) {
  return (
    <div className="dump-layout">
      <section className="panel dump-input-panel">
        <div className="dump-prompt">
          <BeaconIcon size={50} active />
          <div>
            <div className="eyebrow">CAPTURE → CLARITY</div>
            <h2>What’s taking up space in your head?</h2>
            <p>
              Don’t organize it first. Give RAVIN the raw version — things to do, decisions,
              ideas, plans, dates, goals, problems, stuff you’re unsure about. Waypoint will
              compare it with what you already have and help decide what it means.
            </p>
          </div>
        </div>

        <textarea
          value={dump}
          onChange={(event) => setDump(event.target.value)}
          placeholder="I’ve got calc tomorrow, I want to finish the Waypoint prototype, I need to figure out when I can work on..."
          className="brain-textarea"
        />

        <div className="dump-actions">
          <span>
            {dump.length
              ? `${dump.split(/\s+/).filter(Boolean).length} words · context-aware`
              : "Capture first. Organize later."}
          </span>
          <button
            className="primary-button"
            disabled={!dump.trim() || isInterpreting}
            onClick={processDump}
          >
            <SparkIcon width={17} height={17} />
            {isInterpreting ? "RAVIN is reasoning…" : "Find my direction"}
          </button>
        </div>
      </section>

      {interpretation && (
        <>
          <section className="capture-analysis-grid">
            <article className="panel reasoning-card reasoning-summary">
              <div className="eyebrow">
                {interpretation.source === "ravin" ? "RAVIN READ" : "LOCAL FALLBACK"}
              </div>
              <h3>{interpretation.summary}</h3>
              {interpretation.intent ? (
                <div className="reasoning-detail">
                  <span>WHAT YOU’RE REALLY TRYING TO DO</span>
                  <strong>{interpretation.intent}</strong>
                </div>
              ) : null}
            </article>

            <article className="panel reasoning-card reasoning-next">
              <div className="eyebrow">CLEAREST NEXT MOVE</div>
              <div className="next-move-mark"><BeaconIcon size={36} active /></div>
              <h3>{interpretation.next_move || "Review the route below."}</h3>
              <p>One move first. The rest can stay visible without competing for attention.</p>
            </article>
          </section>

          {interpretation.signals.length > 0 && (
            <section className="panel reasoning-section">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">WHAT RAVIN NOTICED</div>
                  <h3>Signals in the situation</h3>
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
                  <div className="eyebrow">RECOMMENDED ROUTE</div>
                  <h3>How I’d move through this</h3>
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
                  <div className="eyebrow">UNRESOLVED</div>
                  <h3>Answers that could change the route</h3>
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
                  <div className="eyebrow">PROPOSED CHANGES</div>
                  <h3>{captures.length} things Waypoint can place.</h3>
                  <p className="interpretation-summary">
                    These are the structured pieces underneath the route. Select only what you
                    actually want added to Waypoint.
                  </p>
                </div>
                <span className="soft-pill">{acceptedCount} selected</span>
              </div>

              <div className="capture-list">
                {captures.map((item) => (
                  <button
                    key={item.id}
                    className={`capture-row ${item.accepted ? "selected" : ""}`}
                    onClick={() => toggleCapture(item.id)}
                  >
                    <span className={`type-dot type-${item.type}`} />
                    <span className="capture-copy">
                      <strong>{item.title}</strong>
                      <small>
                        {item.type}
                        {item.priority ? ` · ${item.priority}` : ""}
                        {item.placement ? ` · → ${item.placement}` : ""}
                        {item.when ? ` · ${item.when}` : ""}
                        {item.duration_minutes ? ` · ~${item.duration_minutes} min` : ""}
                      </small>
                      {item.context ? <em>{item.context}</em> : null}
                      {item.why ? <span className="capture-why">{item.why}</span> : null}
                      {item.depends_on?.length ? (
                        <span className="capture-deps">After: {item.depends_on.join(", ")}</span>
                      ) : null}
                    </span>
                    <span className="capture-check">{item.accepted ? "✓" : ""}</span>
                  </button>
                ))}
              </div>

              <div className="capture-footer">
                <span>Nothing changes until you approve it.</span>
                <button
                  className="primary-button"
                  onClick={acceptCaptures}
                  disabled={!acceptedCount || isApplying}
                >
                  {isApplying ? "Applying…" : "Apply selected"}
                </button>
              </div>
            </section>
          )}

          {!captures.length && (
            <section className="panel reasoning-section no-changes-card">
              <div className="eyebrow">NO CHANGES NEEDED</div>
              <h3>This Capture was useful without turning it into more tasks.</h3>
              <p>
                Keep the reasoning above, or add more context if you want RAVIN to turn it into
                something actionable.
              </p>
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
  onNewPlan
}: {
  items: CapturedItem[];
  futureTodos: ArrowTodo[];
  onArchive: (item: CapturedItem) => void | Promise<void>;
  onNewPlan: () => void;
}) {
  const projects = items.filter((item) => item.type === "project");
  const upcoming = items.filter((item) => item.type === "task" && item.placement !== "today");
  const loose = items.filter((item) => item.type === "note" || item.type === "later");

  return (
    <div className="stack">
      <section className="section-intro">
        <div className="eyebrow">OUTCOMES → ROUTES → MOVES</div>
        <h2>Plans turn direction into something you can actually do.</h2>
      </section>

      <div className="plan-grid">
        {projects.map((plan) => (
          <article className="panel plan-card" key={plan.id}>
            <div className="plan-top">
              <BeaconIcon size={28} />
              <span>{(plan.priority || "medium").toUpperCase()}</span>
            </div>
            <h3>{plan.title}</h3>
            <div className="next-step">
              <small>NEXT MOVE</small>
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
              <span>READY</span>
            </div>
            <h3>No active plans yet.</h3>
            <div className="next-step">
              <small>START HERE</small>
              <strong>Capture a project or goal and RAVIN will pull out the route.</strong>
            </div>
          </article>
        ) : null}

        <button className="panel new-plan-card" onClick={onNewPlan}>
          <PlusIcon width={22} height={22} />
          <span>New plan</span>
        </button>
      </div>

      {(upcoming.length || futureTodos.length) ? (
        <section className="panel capture-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">UPCOMING MOVES</div>
              <h3>Useful, just not for Today.</h3>
            </div>
            <span className="soft-pill">{upcoming.length + futureTodos.length}</span>
          </div>
          <div className="capture-list">
            {futureTodos.map((task) => (
              <div className="capture-row selected" key={task.id}>
                <span className="type-dot type-task" />
                <span className="capture-copy">
                  <strong>{task.title}</strong>
                  <small>{dueMeta(task.due_on)}</small>
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
                <span className="capture-check">→</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {loose.length ? (
        <section className="panel capture-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">PARKED</div>
              <h3>Notes + later</h3>
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
      <section className="section-intro">
        <div className="eyebrow">TIME</div>
        <h2>Your plans need somewhere to live.</h2>
      </section>

      <section className="panel week-panel">
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
                  {event.time ? `${event.time} · ` : ""}{event.title}<button type="button" disabled={busy===event.id} aria-label={`Remove ${event.title}`} onClick={async()=>{if(!confirm(`Remove ${event.title} from your calendar?`))return;setBusy(event.id);setError('');try{await onDelete(event.id);}catch(e){setError(e instanceof Error?e.message:'Could not remove event.');}finally{setBusy(null);}}}>×</button>
                </div>
              )) : (
                <div className="time-block muted">Clear</div>
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
      <section className="panel direction-hero">
        <div className="direction-beacon">
          <BeaconIcon size={92} active />
        </div>
        <div className="eyebrow">YOUR DIRECTION</div>
        <h2>What are you trying to make your life become?</h2>
        <p>
          You don't need the entire answer. Start with a few directions worth moving toward.
        </p>
      </section>

      <section className="panel horizons">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">HORIZONS</div>
            <h3>Directions worth moving toward</h3>
          </div>
        </div>

        {goals.length ? goals.map((goal, index) => (
          <div className="horizon-row" key={goal.id}>
            <span>{goal.when ? goal.when.toUpperCase() : `GOAL ${index + 1}`}</span>
            <strong>{goal.title}</strong>
            <button className="row-action compact" type="button" onClick={() => void onArchive(goal)}>
              Archive
            </button>
          </div>
        )) : (
          <div className="horizon-row">
            <span>EMPTY</span>
            <strong>Capture a goal and RAVIN will place it here.</strong>
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
  captures
}: {
  items: TodayItem[];
  allTodos: ArrowTodo[];
  libraryItems: CapturedItem[];
  events: SharedEvent[];
  captures: ArrowWaypointCapture[];
}) {
  const completed = allTodos.filter((item) => item.completed).length;
  const projects = libraryItems.filter((item) => item.type === "project");
  const goals = libraryItems.filter((item) => item.type === "goal");
  const postponed = libraryItems.filter((item) => item.type === "later");

  return (
    <div className="review-grid">
      <section className="panel metric-card">
        <span className="metric">{completed}</span>
        <small>moves completed</small>
      </section>
      <section className="panel metric-card">
        <span className="metric">{projects.length}</span>
        <small>active plans</small>
      </section>
      <section className="panel metric-card">
        <span className="metric">{postponed.length}</span>
        <small>things intentionally parked</small>
      </section>

      <section className="panel review-story">
        <div className="eyebrow">CURRENT STATE</div>
        <h2>What is actually in motion?</h2>
        <p>
          Waypoint reads the same account-backed planning data across ARROW, so this view follows
          you between devices instead of being tied to one browser.
        </p>

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
            <div className="eyebrow">CAPTURE HISTORY</div>
            <h3>Recent reasoning</h3>
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
                <span>{capture.source === "ravin" ? "RAVIN" : "LOCAL"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="interpretation-summary">Your recent Captures will appear here.</p>
        )}
      </section>
    </div>
  );
}

function tabEyebrow(tab: WaypointTab) {
  const map: Record<WaypointTab, string> = {
    today: "WAYPOINT / TODAY",
    dump: "WAYPOINT / CAPTURE",
    plans: "WAYPOINT / PLANS",
    calendar: "WAYPOINT / CALENDAR",
    direction: "WAYPOINT / DIRECTION",
    review: "WAYPOINT / REVIEW"
  };

  return map[tab];
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
