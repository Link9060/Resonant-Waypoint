"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CaptureOrbit, type CapturePhase } from "./capture-orbit";
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

const TASKS_KEY = "arrow_os_tasks_v1";
const EVENTS_KEY = "arrow_os_events_v1";
const ORBIT_URL = "https://link9060.github.io/Resonant-Orbit/";

const waitForAnimation = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

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

export function WaypointShell() {
  const [activeTab, setActiveTab] = useState<WaypointTab>("today");
  const [dump, setDump] = useState("");
  const [captures, setCaptures] = useState<CapturedItem[]>([]);
  const [todayItems, setTodayItems] = useState(initialToday);
  const [events, setEvents] = useState<SharedEvent[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [capturePhase, setCapturePhase] = useState<"idle" | CapturePhase>("idle");
  const [processingText, setProcessingText] = useState("");
  const [captureError, setCaptureError] = useState("");
  const captureRun = useRef(0);

  useEffect(() => () => {
    captureRun.current += 1;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && tabs.some((item) => item.id === tab)) {
      setActiveTab(tab as WaypointTab);
    }

    const loadShared = () => {
      const sharedTasks = safeJsonList<{ id?: string; text?: string; done?: boolean; createdAt?: number }>(TASKS_KEY)
        .filter((task) => typeof task.id === "string" && typeof task.text === "string");
      setTodayItems(sharedTasks.map((task) => ({
        id: task.id!,
        title: task.text!,
        meta: "ARROW task",
        completed: Boolean(task.done),
      })));

      setEvents(
        safeJsonList<SharedEvent>(EVENTS_KEY)
          .filter((event) => typeof event.id === "string" && typeof event.title === "string" && typeof event.date === "string")
      );
      setStorageReady(true);
    };

    loadShared();
    const refresh = () => loadShared();
    window.addEventListener("storage", refresh);
    window.addEventListener("arrow-os:datachange", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("arrow-os:datachange", refresh as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const sharedTasks = todayItems.map((item) => ({
      id: item.id,
      text: item.title,
      done: Boolean(item.completed),
      createdAt: Date.now(),
    }));
    localStorage.setItem(TASKS_KEY, JSON.stringify(sharedTasks));
  }, [storageReady, todayItems]);

  const completed = todayItems.filter((item) => item.completed).length;
  const progress = todayItems.length ? Math.round((completed / todayItems.length) * 100) : 0;

  async function processDump() {
    const input = dump.trim();
    if (!input || capturePhase !== "idle") return;

    const run = ++captureRun.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setProcessingText(input);
    setCaptureError("");
    setCaptures([]);
    setCapturePhase("gathering");

    try {
      await waitForAnimation(reducedMotion ? 0 : 1260);
      if (run !== captureRun.current) return;

      setCapturePhase("thinking");
      // The current standalone Waypoint build uses a local parser.
      // A future async RAVIN request can replace this call without changing the animation.
      const result = interpretBrainDump(input);
      await waitForAnimation(reducedMotion ? 0 : 540);
      if (run !== captureRun.current) return;

      setCaptures(result);
      setCapturePhase("releasing");
      await waitForAnimation(reducedMotion ? 0 : 580);
    } catch {
      if (run === captureRun.current) {
        setCaptureError("Capture couldn't be processed. Your text is still here. Try again.");
      }
    } finally {
      if (run === captureRun.current) setCapturePhase("idle");
    }
  }

  function toggleCapture(id: string) {
    setCaptures((current) =>
      current.map((item) => item.id === id ? { ...item, accepted: !item.accepted } : item)
    );
  }

  function acceptCaptures() {
    const tasks = captures
      .filter((item) => item.accepted && item.type === "task")
      .map((item) => ({
        id: `today-${item.id}`,
        title: item.title,
        meta: item.when ? `Captured · ${item.when}` : "Captured from Dump"
      }));

    if (tasks.length) {
      setTodayItems((current) => [...current, ...tasks]);
    }

    const capturedEvents: SharedEvent[] = captures
      .filter((item) => item.accepted && item.type === "event" && item.when)
      .map((item) => {
        const parsed = new Date(item.when!);
        const validDate = !Number.isNaN(parsed.getTime());
        return {
          id: `event-${item.id}`,
          title: item.title,
          date: validDate ? parsed.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          time: validDate ? parsed.toTimeString().slice(0, 5) : "",
        };
      });

    if (capturedEvents.length) {
      const nextEvents = [...events, ...capturedEvents];
      setEvents(nextEvents);
      localStorage.setItem(EVENTS_KEY, JSON.stringify(nextEvents));
      window.dispatchEvent(new CustomEvent("arrow-os:datachange", { detail: { key: EVENTS_KEY, value: nextEvents } }));
    }

    setDump("");
    setCaptures([]);
    setActiveTab("today");
  }

  const acceptedCount = useMemo(
    () => captures.filter((item) => item.accepted).length,
    [captures]
  );

  return (
    <main className="waypoint-app">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <BeaconIcon size={29} />
          </div>
          <div>
            <div className="eyebrow">ARROW / PLANNING</div>
            <div className="brand-name">Waypoint</div>
          </div>
        </div>

        <div className="nav-heading">NAVIGATION</div>
        <nav className="nav" aria-label="Waypoint sections">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? "active" : ""}`}
              aria-current={activeTab === id ? "page" : undefined}
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

              const url = new URL(ORBIT_URL);
              url.searchParams.set("from", "waypoint");
              window.location.assign(url.toString());
            }}
          >
            <span className="orbit-dot" />
            Back to Orbit
          </button>
          <div className="sidebar-caption">Your planning workspace</div>
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div className="topbar-heading">
            <div className="eyebrow">{tabEyebrow(activeTab)}</div>
            <h1>{tabTitle(activeTab)}</h1>
          </div>
          <div className="topbar-actions">
            <div data-arrow-os-shell data-module="waypoint" suppressHydrationWarning />
            {activeTab !== "dump" && (
              <button className="header-capture-button" type="button" onClick={() => setActiveTab("dump")}>
                <PlusIcon width={16} height={16} />
                <span>New capture</span>
              </button>
            )}
          </div>
        </header>

        <div className="content">
          {activeTab === "today" && (
            <TodayView
              items={todayItems}
              setItems={setTodayItems}
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
              capturePhase={capturePhase}
              processingText={processingText}
              captureError={captureError}
            />
          )}

          {activeTab === "plans" && <PlansView onCapture={() => setActiveTab("dump")} />}
          {activeTab === "calendar" && <CalendarView events={events} />}
          {activeTab === "direction" && <DirectionView />}
          {activeTab === "review" && <ReviewView items={todayItems} events={events} />}
        </div>
      </section>
    </main>
  );
}

function TodayView({
  items,
  setItems,
  progress,
  onDump
}: {
  items: TodayItem[];
  setItems: React.Dispatch<React.SetStateAction<TodayItem[]>>;
  progress: number;
  onDump: () => void;
}) {
  const completed = items.filter((item) => item.completed).length;
  const remaining = items.length - completed;
  const nextItem = items.find((item) => !item.completed);
  return (
    <div className="today-layout">
      <section className="overview-bar" aria-label="Today's overview">
        <div className="overview-copy">
          <div className="eyebrow">TODAY'S OVERVIEW</div>
          <h2>Today at a glance</h2>
          <p>Review your priorities and keep moving.</p>
        </div>
        <div className="overview-stats">
          <div className="overview-stat"><strong>{remaining}</strong><span>To do</span></div>
          <div className="overview-stat"><strong>{completed}</strong><span>Done</span></div>
        </div>
      </section>

      <div className="today-workspace">
        <section className="panel primary-list-panel">
          <header className="panel-heading">
            <div>
              <div className="eyebrow">TASKS</div>
              <h3>Today's tasks</h3>
            </div>
            <span className="soft-pill">{items.length ? progress + "% complete" : "Ready when you are"}</span>
          </header>
          <div className="task-progress" role="progressbar" aria-label="Tasks completed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: progress + "%" }} />
          </div>

          {items.length ? (
            <div className="task-list">
              {items.map((item, index) => (
                <button
                  type="button"
                  aria-pressed={Boolean(item.completed)}
                  className={"task-row " + (item.completed ? "done" : "")}
                  key={item.id}
                  onClick={() => setItems((current) => current.map((currentItem) =>
                    currentItem.id === item.id
                      ? { ...currentItem, completed: !currentItem.completed }
                      : currentItem
                  ))}
                >
                  <span className="task-check" aria-hidden="true">{item.completed ? "✓" : ""}</span>
                  <span className="task-main">
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </span>
                  <span className="task-index">{String(index + 1).padStart(2, "0")}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="list-empty">
              <span className="empty-indicator"><TodayIcon width={22} height={22} /></span>
              <h4>Nothing on your list yet.</h4>
              <p>Capture a thought and turn it into a task. Start with what's on your mind.</p>
              <button className="text-action" type="button" onClick={onDump}>Open Capture <span aria-hidden="true">↗</span></button>
            </div>
          )}
        </section>

        <aside className="today-aside">
          <section className="panel focus-panel">
            <div className="eyebrow">UP NEXT</div>
            <div className="focus-content">
              <span className="focus-marker" aria-hidden="true">NEXT</span>
              <h3>{nextItem?.title ?? "You're all caught up."}</h3>
              <p>{nextItem ? "Next incomplete task" : "Add a task from Capture when you're ready."}</p>
            </div>
          </section>

          <button type="button" className="panel capture-entry" onClick={onDump}>
            <span className="capture-entry-icon"><SparkIcon width={18} height={18} /></span>
            <span className="capture-entry-content">
              <span className="eyebrow">QUICK ACTION</span>
              <strong>Quick capture</strong>
              <small>Turn notes into actions.</small>
            </span>
            <span className="capture-entry-arrow" aria-hidden="true">↗</span>
          </button>
        </aside>
      </div>
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
  capturePhase,
  processingText,
  captureError
}: {
  dump: string;
  setDump: (value: string) => void;
  captures: CapturedItem[];
  processDump: () => void;
  toggleCapture: (id: string) => void;
  acceptCaptures: () => void;
  acceptedCount: number;
  capturePhase: "idle" | CapturePhase;
  processingText: string;
  captureError: string;
}) {
  const firstMove = captures.find((item) => item.type === "task" || item.type === "project") ?? captures[0];
  return (
    <div className="dump-layout">
      <section className="panel dump-input-panel">
        <div className="dump-prompt">
          <div className="dump-prompt-mark"><BeaconIcon size={26} /></div>
          <div>
            <div className="eyebrow">INBOX</div>
            <h2>Capture and organize</h2>
            <p>Add notes, tasks, or ideas. Review the suggested items before saving anything.</p>
          </div>
        </div>

        <div className={`brain-editor ${capturePhase !== "idle" ? "is-processing" : ""}`}>
          <textarea
            value={dump}
            onChange={(event) => setDump(event.target.value)}
            placeholder="Okay, so tomorrow I need to..."
            className="brain-textarea"
            aria-label="Your brain dump"
            disabled={capturePhase !== "idle"}
          />
          {capturePhase !== "idle" && (
            <CaptureOrbit text={processingText} phase={capturePhase} />
          )}
        </div>
        {captureError && <p className="dump-error" role="alert">{captureError}</p>}

        <div className="dump-actions">
          <span>
            {dump.length
              ? `${dump.split(/\s+/).filter(Boolean).length} words`
              : "A blank space to think."}
          </span>
          <button
            className="primary-button"
            disabled={!dump.trim() || capturePhase !== "idle"}
            onClick={processDump}
          >
            <SparkIcon width={17} height={17} />
            Organize capture
          </button>
        </div>
      </section>

      {captures.length > 0 && (
        <section className="panel capture-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">REVIEW / NOT YET SAVED</div>
              <h3>Review your items</h3>
            </div>
            <span className="soft-pill">{acceptedCount} selected</span>
          </div>

          {firstMove && (
            <div className="capture-guidance">
              <div>
                <div className="eyebrow">SUGGESTED NEXT ACTION</div>
                <strong>{firstMove.title}</strong>
              </div>
              <p>Review the steps below. Only the items you approve will be added.</p>
            </div>
          )}

          <div className="capture-list">
            {captures.map((item, index) => (
              <button
                key={item.id}
                className={`capture-row ${item.accepted ? "selected" : ""}`}
                aria-pressed={Boolean(item.accepted)}
                style={{ animationDelay: `${index * 65}ms` }}
                onClick={() => toggleCapture(item.id)}
              >
                <span className={`type-dot type-${item.type}`} />
                <span className="capture-copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.type}
                    {item.when ? ` · ${item.when}` : ""}
                  </small>
                </span>
                <span className="capture-check">{item.accepted ? "✓" : ""}</span>
              </button>
            ))}
          </div>

          <div className="capture-footer">
            <span>Nothing is added until you approve your selection.</span>
            <button
              className="primary-button"
              onClick={acceptCaptures}
              disabled={!acceptedCount}
            >
              Add {acceptedCount} selected
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function PlansView({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="workspace-page">
      <div className="section-intro">
        <div className="eyebrow">PLANS / WORK IN PROGRESS</div>
        <h2>Give your ideas a direction.</h2>
        <p>A place for projects, milestones, and the small steps that move them forward.</p>
      </div>
      <div className="plans-layout">
        <section className="panel plans-empty">
          <span className="empty-indicator"><PlansIcon width={23} height={23} /></span>
          <h3>Your plans will live here.</h3>
          <p>Plan management isn't connected yet. For now, capture project ideas and review how they're classified.</p>
          <button type="button" className="secondary-button" onClick={onCapture}>
            <PlusIcon width={16} height={16} /> Capture a project
          </button>
        </section>
        <aside className="panel plans-guide">
          <div className="eyebrow">THE APPROACH</div>
          <h3>From intention to action</h3>
          <div className="guide-step"><span>01</span><div><strong>Capture</strong><p>Get the idea out of your head.</p></div></div>
          <div className="guide-step"><span>02</span><div><strong>Clarify</strong><p>Decide what matters and what doesn't.</p></div></div>
          <div className="guide-step"><span>03</span><div><strong>Move</strong><p>Break it into realistic next steps.</p></div></div>
        </aside>
      </div>
    </div>
  );
}

function CalendarView({ events }: { events: SharedEvent[] }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const localDate = (date: Date) =>
    [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = localDate(date);
    return {
      iso,
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      number: date.getDate(),
      isToday: iso === localDate(today),
      events: events
        .filter((event) => event.date === iso)
        .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    };
  });
  const weekLabel = start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="workspace-page">
      <div className="section-intro">
        <div className="eyebrow">CALENDAR / THIS WEEK</div>
        <h2>See what's ahead.</h2>
        <p>Your approved events show up in this weekly view.</p>
      </div>
      <section className="panel week-panel">
        <div className="panel-heading week-heading">
          <div><div className="eyebrow">MONDAY – SUNDAY</div><h3>Week of {weekLabel}</h3></div>
          <span className="soft-pill">{events.length} events saved</span>
        </div>
        <div className="week-scroll">
          <div className="week-row">
            {days.map((day) => (
              <div className={"day-column " + (day.isToday ? "today-column" : "")} key={day.iso}>
                <div className="day-name"><span>{day.day}</span><strong>{day.number}</strong></div>
                <div className="day-events">
                  {day.events.map((event) => (
                    <div className="time-block visible" key={event.id}>
                      {event.time && <span className="event-time">{event.time}</span>}
                      <strong>{event.title}</strong>
                    </div>
                  ))}
                  {!day.events.length && <div className="day-empty">No events</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function DirectionView() {
  const prompts = [
    { horizon: "NOW", title: "What needs attention?", detail: "The commitments and decisions closest to you." },
    { horizon: "NEXT", title: "What are you building toward?", detail: "The projects and capabilities you want to develop." },
    { horizon: "LATER", title: "What matters long term?", detail: "A bigger direction, without requiring every answer." }
  ];
  return (
    <div className="workspace-page">
      <div className="section-intro">
        <div className="eyebrow">DIRECTION / LONG VIEW</div>
        <h2>Know what you're moving toward.</h2>
        <p>Not another to-do list. A place to keep your priorities in perspective.</p>
      </div>
      <div className="direction-layout">
        <section className="panel direction-hero">
          <div className="direction-symbol"><DirectionIcon width={30} height={30} /></div>
          <div className="direction-hero-copy">
            <div className="eyebrow">YOUR DIRECTION</div>
            <h3>Make space for the bigger picture.</h3>
            <p>No directions have been saved here yet. Future updates will let you build a personal set of horizons.</p>
          </div>
        </section>
        <section className="panel horizons">
          <div className="panel-heading"><div><div className="eyebrow">REFLECTION</div><h3>Questions worth keeping</h3></div></div>
          {prompts.map((prompt) => (
            <div className="horizon-row" key={prompt.horizon}>
              <span>{prompt.horizon}</span>
              <div><strong>{prompt.title}</strong><p>{prompt.detail}</p></div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function ReviewView({ items, events }: { items: TodayItem[]; events: SharedEvent[] }) {
  const done = items.filter((item) => item.completed).length;
  const open = items.length - done;
  const next = items.find((item) => !item.completed);
  return (
    <div className="workspace-page">
      <div className="section-intro">
        <div className="eyebrow">REVIEW / CURRENT SNAPSHOT</div>
        <h2>See where things stand.</h2>
        <p>A simple look at your current tasks and saved events, without made-up metrics.</p>
      </div>
      <div className="review-grid">
        <section className="panel metric-card"><span className="metric">{done}</span><small>completed tasks</small></section>
        <section className="panel metric-card"><span className="metric">{open}</span><small>tasks remaining</small></section>
        <section className="panel metric-card"><span className="metric">{events.length}</span><small>events on calendar</small></section>
        <section className="panel review-story">
          <div className="eyebrow">AT A GLANCE</div>
          <h3>Progress, not pressure.</h3>
          <p>These numbers are based on the current items in your workspace. A historical review will become possible when activity tracking is available.</p>
          <div className="review-line"><span>Tasks tracked</span><strong>{items.length}</strong></div>
          <div className="review-line"><span>Completion</span><strong>{items.length ? Math.round((done / items.length) * 100) + "%" : "No tasks yet"}</strong></div>
          <div className="review-line"><span>Up next</span><strong>{next?.title ?? "Nothing queued"}</strong></div>
        </section>
      </div>
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
