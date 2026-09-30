"use client";

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
import { interpretWithRavin, type WaypointInterpretation } from "@/lib/ravin";
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
const NOTES_KEY = "arrow_os_notes_v1";
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
  const target = weekdays.indexOf(when.replace(/^next\s+/, ""));
  if (target >= 0) {
    const date = new Date();
    const delta = (target - date.getDay() + 7) % 7 || 7;
    return localIsoDate(when.startsWith("next ") ? delta + 7 : delta);
  }

  const parsed = new Date(item.when || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function WaypointShell() {
  const [activeTab, setActiveTab] = useState<WaypointTab>("today");
  const [dump, setDump] = useState("");
  const [captures, setCaptures] = useState<CapturedItem[]>([]);
  const [todayItems, setTodayItems] = useState(initialToday);
  const [events, setEvents] = useState<SharedEvent[]>([]);
  const [libraryItems, setLibraryItems] = useState<CapturedItem[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<WaypointInterpretation | null>(null);

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
      setLibraryItems(
        safeJsonList<CapturedItem>(LIBRARY_KEY)
          .filter((item) => typeof item.id === "string" && typeof item.title === "string")
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
    if (!dump.trim() || isInterpreting) return;
    setIsInterpreting(true);
    setInterpretation(null);

    try {
      const result = await interpretWithRavin(dump, {
        tasks: todayItems,
        events,
        library: libraryItems,
      });
      setCaptures(result.items);
      setInterpretation(result);
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
    } finally {
      setIsInterpreting(false);
    }
  }

  function toggleCapture(id: string) {
    setCaptures((current) =>
      current.map((item) => item.id === id ? { ...item, accepted: !item.accepted } : item)
    );
  }

  function acceptCaptures() {
    const accepted = captures.filter((item) => item.accepted);

    const tasks = accepted
      .filter((item) => item.type === "task")
      .map((item) => {
        const timing = [item.date, item.time].filter(Boolean).join(" ");
        return {
          id: `today-${item.id}`,
          title: item.title,
          meta: timing
            ? `Captured · ${timing}`
            : item.when
              ? `Captured · ${item.when}`
              : "Captured from Capture"
        };
      });

    if (tasks.length) {
      setTodayItems((current) => [...current, ...tasks]);
    }

    const capturedEvents: SharedEvent[] = accepted.flatMap((item) => {
      if (item.type !== "event") return [];
      const date = resolveCaptureDate(item);
      if (!date) return [];
      return [{
        id: `event-${item.id}`,
        title: item.title,
        date,
        time: item.time || "",
      }];
    });

    if (capturedEvents.length) {
      const nextEvents = [...events, ...capturedEvents];
      setEvents(nextEvents);
      localStorage.setItem(EVENTS_KEY, JSON.stringify(nextEvents));
      window.dispatchEvent(new CustomEvent("arrow-os:datachange", { detail: { key: EVENTS_KEY, value: nextEvents } }));
    }

    const libraryAdds = accepted.filter((item) => !["task", "event"].includes(item.type));
    if (libraryAdds.length) {
      const nextLibrary = [...libraryItems, ...libraryAdds];
      setLibraryItems(nextLibrary);
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(nextLibrary));
    }

    const notes = accepted.filter((item) => item.type === "note");
    if (notes.length) {
      const currentNotes = localStorage.getItem(NOTES_KEY) || "";
      const addition = notes.map((item) => `• ${item.title}`).join("\n");
      const nextNotes = [currentNotes.trim(), addition].filter(Boolean).join("\n\n");
      localStorage.setItem(NOTES_KEY, nextNotes);
      window.dispatchEvent(new CustomEvent("arrow-os:datachange", { detail: { key: NOTES_KEY, value: nextNotes } }));
    }

    const nextTab: WaypointTab =
      tasks.length ? "today"
        : capturedEvents.length ? "calendar"
          : accepted.some((item) => item.type === "project" || item.type === "note" || item.type === "later") ? "plans"
            : accepted.some((item) => item.type === "goal") ? "direction"
              : "today";

    setDump("");
    setCaptures([]);
    setInterpretation(null);
    setActiveTab(nextTab);
  }

  const acceptedCount = useMemo(
    () => captures.filter((item) => item.accepted).length,
    [captures]
  );

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
            <button className="ravin-chip" onClick={() => setActiveTab("dump")}>
              <SparkIcon width={16} height={16} />
              Ask RAVIN
            </button>
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
              isInterpreting={isInterpreting}
              interpretation={interpretation}
            />
          )}

          {activeTab === "plans" && (
            <PlansView
              items={libraryItems}
              onNewPlan={() => {
                setDump("I want to plan: ");
                setActiveTab("dump");
              }}
            />
          )}
          {activeTab === "calendar" && <CalendarView events={events} />}
          {activeTab === "direction" && <DirectionView items={libraryItems} />}
          {activeTab === "review" && (
            <ReviewView items={todayItems} libraryItems={libraryItems} events={events} />
          )}
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
              className={`task-row ${item.completed ? "done" : ""}`}
              key={item.id}
              onClick={() =>
                setItems((current) =>
                  current.map((currentItem) =>
                    currentItem.id === item.id
                      ? { ...currentItem, completed: !currentItem.completed }
                      : currentItem
                  )
                )
              }
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
                  disabled={!acceptedCount}
                >
                  Apply selected
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
  onNewPlan
}: {
  items: CapturedItem[];
  onNewPlan: () => void;
}) {
  const projects = items.filter((item) => item.type === "project");
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
              <span>0%</span>
            </div>
            <h3>{plan.title}</h3>
            <div className="mini-progress">
              <span style={{ width: "0%" }} />
            </div>
            <div className="next-step">
              <small>NEXT MOVE</small>
              <strong>{plan.context || "Choose the first concrete action."}</strong>
            </div>
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
                <span className="capture-check">•</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CalendarView({ events }: { events: SharedEvent[] }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() + 1);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      iso,
      label: date.toLocaleDateString([], { weekday: "short", day: "numeric" }).toUpperCase(),
      isToday: iso === today.toISOString().slice(0, 10),
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
        <div className="week-row">
          {days.map((day) => (
            <div
              className={`day-column ${day.isToday ? "today-column" : ""}`}
              key={day.iso}
            >
              <div className="day-name">{day.label}</div>
              {day.events.length ? day.events.map((event) => (
                <div className="time-block visible" key={event.id}>
                  {event.time ? `${event.time} · ` : ""}{event.title}
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

function DirectionView({ items }: { items: CapturedItem[] }) {
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
          </div>
        )) : (
          <div className="horizon-row">
            <span>EMPTY</span>
            <strong>Capture a goal in Dump and RAVIN will place it here.</strong>
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewView({
  items,
  libraryItems,
  events
}: {
  items: TodayItem[];
  libraryItems: CapturedItem[];
  events: SharedEvent[];
}) {
  const completed = items.filter((item) => item.completed).length;
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
        <small>active plans captured</small>
      </section>
      <section className="panel metric-card">
        <span className="metric">{postponed.length}</span>
        <small>things intentionally parked</small>
      </section>

      <section className="panel review-story">
        <div className="eyebrow">REAL DATA</div>
        <h2>What is actually in motion?</h2>
        <p>
          This prototype review uses your real Waypoint data instead of placeholder scores.
          As Waypoint grows, RAVIN can turn this into a weekly reflection and pattern report.
        </p>

        <div className="review-line">
          <span>Open moves</span>
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
