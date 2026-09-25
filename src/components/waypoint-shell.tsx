"use client";

import { useMemo, useState } from "react";
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
  { id: "dump", label: "Dump", icon: DumpIcon },
  { id: "plans", label: "Plans", icon: PlansIcon },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
  { id: "direction", label: "Direction", icon: DirectionIcon },
  { id: "review", label: "Review", icon: ReviewIcon }
] as const;

const initialToday: TodayItem[] = [
  { id: "t1", title: "Choose your first real priority", meta: "Waypoint setup · 10 min" },
  { id: "t2", title: "Add everything currently on your mind", meta: "Brain dump · 5 min" },
  { id: "t3", title: "Create your first plan", meta: "Plans · when ready" }
];

const samplePlans = [
  { title: "Build Waypoint", progress: 12, next: "Define the first working brain-dump flow" },
  { title: "ARROW ecosystem", progress: 38, next: "Connect Waypoint into the ARROW shell" },
  { title: "Personal direction", progress: 5, next: "Add the first long-range horizon" }
];

export function WaypointShell() {
  const [activeTab, setActiveTab] = useState<WaypointTab>("today");
  const [dump, setDump] = useState("");
  const [captures, setCaptures] = useState<CapturedItem[]>([]);
  const [todayItems, setTodayItems] = useState(initialToday);

  const completed = todayItems.filter((item) => item.completed).length;
  const progress = todayItems.length ? Math.round((completed / todayItems.length) * 100) : 0;

  function processDump() {
    const result = interpretBrainDump(dump);
    setCaptures(result);
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
          <button className="orbit-button" type="button">
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
            <button className="icon-button" aria-label="Quick add">
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
            />
          )}

          {activeTab === "plans" && <PlansView />}
          {activeTab === "calendar" && <CalendarView />}
          {activeTab === "direction" && <DirectionView />}
          {activeTab === "review" && <ReviewView />}
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
          <div className="eyebrow">BRAIN DUMP</div>
          <h3>Too much going on?</h3>
          <p>
            Throw the mess here. Waypoint + RAVIN will sort it into tasks, notes, plans, and time.
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
  acceptedCount
}: {
  dump: string;
  setDump: (value: string) => void;
  captures: CapturedItem[];
  processDump: () => void;
  toggleCapture: (id: string) => void;
  acceptCaptures: () => void;
  acceptedCount: number;
}) {
  return (
    <div className="dump-layout">
      <section className="panel dump-input-panel">
        <div className="dump-prompt">
          <BeaconIcon size={50} active />
          <div>
            <div className="eyebrow">NO ORGANIZING REQUIRED</div>
            <h2>What's going on?</h2>
            <p>
              Say everything. Homework, ideas, things you're worried you'll forget, stuff you want
              to build, dates, goals — messy is fine.
            </p>
          </div>
        </div>

        <textarea
          value={dump}
          onChange={(event) => setDump(event.target.value)}
          placeholder="Okay, so tomorrow I need to..."
          className="brain-textarea"
        />

        <div className="dump-actions">
          <span>
            {dump.length
              ? `${dump.split(/\s+/).filter(Boolean).length} words`
              : "Your brain, unfiltered."}
          </span>
          <button
            className="primary-button"
            disabled={!dump.trim()}
            onClick={processDump}
          >
            <SparkIcon width={17} height={17} />
            Make sense of this
          </button>
        </div>
      </section>

      {captures.length > 0 && (
        <section className="panel capture-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">RAVIN INTERPRETATION</div>
              <h3>I found {captures.length} things.</h3>
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
                    {item.when ? ` · ${item.when}` : ""}
                  </small>
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
              Add selected
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function PlansView() {
  return (
    <div className="stack">
      <section className="section-intro">
        <div className="eyebrow">OUTCOMES → ROUTES → MOVES</div>
        <h2>Plans turn direction into something you can actually do.</h2>
      </section>

      <div className="plan-grid">
        {samplePlans.map((plan) => (
          <article className="panel plan-card" key={plan.title}>
            <div className="plan-top">
              <BeaconIcon size={28} />
              <span>{plan.progress}%</span>
            </div>
            <h3>{plan.title}</h3>
            <div className="mini-progress">
              <span style={{ width: `${plan.progress}%` }} />
            </div>
            <div className="next-step">
              <small>NEXT MOVE</small>
              <strong>{plan.next}</strong>
            </div>
          </article>
        ))}

        <button className="panel new-plan-card">
          <PlusIcon width={22} height={22} />
          <span>New plan</span>
        </button>
      </div>
    </div>
  );
}

function CalendarView() {
  const days = [
    "MON 21",
    "TUE 22",
    "WED 23",
    "THU 24",
    "FRI 25",
    "SAT 26",
    "SUN 27"
  ];

  return (
    <div className="stack">
      <section className="section-intro">
        <div className="eyebrow">TIME</div>
        <h2>Your plans need somewhere to live.</h2>
      </section>

      <section className="panel week-panel">
        <div className="week-row">
          {days.map((day, index) => (
            <div
              className={`day-column ${index === 4 ? "today-column" : ""}`}
              key={day}
            >
              <div className="day-name">{day}</div>
              <div
                className={`time-block ${index === 0 || index === 3 ? "visible" : ""}`}
              >
                {index === 0 ? "School" : "ARROW"}
              </div>
              <div
                className={`time-block muted ${index === 2 || index === 4 ? "visible" : ""}`}
              >
                {index === 2 ? "Practice" : "Review"}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DirectionView() {
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
            <h3>Near → Far</h3>
          </div>
        </div>

        {[
          ["NOW", "Get the important stuff under control"],
          ["NEAR", "Build things that actually work"],
          ["NEXT", "Become genuinely capable at engineering"],
          ["FAR", "Create work and products that matter"]
        ].map(([range, copy]) => (
          <div className="horizon-row" key={range}>
            <span>{range}</span>
            <strong>{copy}</strong>
          </div>
        ))}
      </section>
    </div>
  );
}

function ReviewView() {
  return (
    <div className="review-grid">
      <section className="panel metric-card">
        <span className="metric">12</span>
        <small>moves completed</small>
      </section>
      <section className="panel metric-card">
        <span className="metric">3</span>
        <small>plans advanced</small>
      </section>
      <section className="panel metric-card">
        <span className="metric">2</span>
        <small>things repeatedly postponed</small>
      </section>

      <section className="panel review-story">
        <div className="eyebrow">THIS WEEK</div>
        <h2>What actually happened?</h2>
        <p>
          Waypoint should reflect reality, not grade you. Reviews surface where your time went,
          what moved, what stalled, and what you may want to change.
        </p>

        <div className="review-line">
          <span>Most attention</span>
          <strong>ARROW</strong>
        </div>
        <div className="review-line">
          <span>Lost momentum</span>
          <strong>Personal projects</strong>
        </div>
        <div className="review-line">
          <span>Worth reconsidering</span>
          <strong>2 postponed items</strong>
        </div>
      </section>
    </div>
  );
}

function tabEyebrow(tab: WaypointTab) {
  const map: Record<WaypointTab, string> = {
    today: "WAYPOINT / TODAY",
    dump: "WAYPOINT / DUMP",
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
    dump: "Brain dump",
    plans: "Plans",
    calendar: "Calendar",
    direction: "Direction",
    review: "Review"
  };

  return map[tab];
}
