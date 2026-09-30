const SUPABASE_URL = "https://cnorozrjugxpanpfmssa.supabase.co";
const SUPABASE_KEY = "sb_publishable_yVNPiB7opT0WRvBfKTZ2BA_s5bOQLRg";
const AUTH_STORAGE_KEY = "sb-cnorozrjugxpanpfmssa-auth-token";
const MIGRATION_KEY = "waypoint_shared_planning_migrated_v1";
const LEGACY_TASKS_KEY = "arrow_os_tasks_v1";
const LEGACY_EVENTS_KEY = "arrow_os_events_v1";

export type ArrowTodo = {
  id: string;
  title: string;
  due_on: string;
  completed: boolean;
  position: number;
  created_at: string;
};

export type ArrowCalendarEvent = {
  id: string;
  title: string;
  event_date: string;
  is_all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  details: string | null;
};

type ArrowSession = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user?: { id?: string };
  [key: string]: unknown;
};

function readSession(): ArrowSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null") as ArrowSession | null;
    return parsed?.access_token ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(session: ArrowSession) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

async function refreshSession(session: ArrowSession) {
  if (!session.refresh_token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  if (!response.ok) return null;
  const fresh = await response.json() as ArrowSession;
  const merged = { ...session, ...fresh, user: fresh.user || session.user };
  saveSession(merged);
  return merged;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; prefer?: string } = {},
  retry = true
): Promise<T> {
  let session = readSession();
  if (!session) throw new Error("Sign in to ARROW before using Waypoint.");

  if (session.expires_at && session.expires_at * 1000 < Date.now() + 30_000) {
    session = await refreshSession(session) || session;
  }

  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${session.access_token}`,
    Accept: "application/json"
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (response.status === 401 && retry) {
    const fresh = await refreshSession(session);
    if (fresh) return request<T>(path, options, false);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(payload?.message || payload?.error || "ARROW data request failed.");
  }

  if ((options.method || "GET").toUpperCase() !== "GET") {
    try { localStorage.setItem("arrow_shared_data_ping_v1", String(Date.now())); } catch {}
  }

  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

function userId() {
  const id = readSession()?.user?.id;
  if (!id) throw new Error("Your ARROW session is missing its account ID.");
  return id;
}

function localDate(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function resolveDueDate(when?: string) {
  if (!when) return localDate();
  const normalized = when.trim().toLowerCase();
  const base = new Date();
  base.setHours(12, 0, 0, 0);

  if (normalized === "today" || normalized === "tonight") return localDate(base);
  if (normalized === "tomorrow") {
    base.setDate(base.getDate() + 1);
    return localDate(base);
  }
  if (normalized === "next week") {
    base.setDate(base.getDate() + 7);
    return localDate(base);
  }

  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(normalized);
  if (weekday >= 0) {
    let delta = (weekday - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    base.setDate(base.getDate() + delta);
    return localDate(base);
  }

  const parsed = new Date(when);
  return Number.isNaN(parsed.getTime()) ? localDate() : localDate(parsed);
}

export async function loadPlanningData() {
  const [todos, events] = await Promise.all([
    request<ArrowTodo[]>("/rest/v1/todos?select=id,title,due_on,completed,position,created_at&order=completed.asc,due_on.asc,position.asc,created_at.asc&limit=120"),
    request<ArrowCalendarEvent[]>("/rest/v1/relay_calendar_events?select=id,title,event_date,is_all_day,start_time,end_time,details&order=event_date.asc,start_time.asc&limit=160")
  ]);
  return { todos: todos || [], events: events || [] };
}

export async function createTodo(title: string, dueOn = localDate()) {
  await request("/rest/v1/todos", {
    method: "POST",
    prefer: "return=minimal",
    body: { user_id: userId(), title: title.trim(), due_on: dueOn }
  });
}

export async function setTodoCompleted(id: string, completed: boolean) {
  await request(`/rest/v1/todos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { completed }
  });
}

export async function createCalendarEvent(title: string, eventDate: string, startTime = "") {
  await request("/rest/v1/relay_calendar_events", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      user_id: userId(),
      title: title.trim(),
      event_date: eventDate,
      is_all_day: !startTime,
      start_time: startTime || null
    }
  });
}

export async function createSharedNote(title: string, text: string) {
  await request("/rest/v1/notes", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      user_id: userId(),
      title: title.trim().slice(0, 120) || "Waypoint capture",
      content: [{ id: crypto.randomUUID(), type: "paragraph", text: text.trim() }],
      is_pinned: false
    }
  });
}

function safeLegacyList<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function migrateLegacyPlanningData() {
  if (localStorage.getItem(MIGRATION_KEY) === "1") return;

  const legacyTasks = safeLegacyList<{ text?: string; done?: boolean }>(LEGACY_TASKS_KEY)
    .filter((item) => typeof item.text === "string" && item.text.trim());
  const legacyEvents = safeLegacyList<{ title?: string; date?: string; time?: string }>(LEGACY_EVENTS_KEY)
    .filter((item) => typeof item.title === "string" && typeof item.date === "string");

  if (!legacyTasks.length && !legacyEvents.length) {
    localStorage.setItem(MIGRATION_KEY, "1");
    return;
  }

  const existing = await loadPlanningData();
  const existingTaskKeys = new Set(existing.todos.map((item) => `${item.title.trim().toLowerCase()}|${item.due_on}`));
  const existingEventKeys = new Set(existing.events.map((item) => `${item.title.trim().toLowerCase()}|${item.event_date}|${item.start_time?.slice(0, 5) || ""}`));
  const today = localDate();

  for (const item of legacyTasks) {
    const title = item.text!.trim();
    const key = `${title.toLowerCase()}|${today}`;
    if (existingTaskKeys.has(key)) continue;
    await createTodo(title, today);
    existingTaskKeys.add(key);
  }

  for (const item of legacyEvents) {
    const title = item.title!.trim();
    const time = item.time || "";
    const key = `${title.toLowerCase()}|${item.date}|${time}`;
    if (existingEventKeys.has(key)) continue;
    await createCalendarEvent(title, item.date!, time);
    existingEventKeys.add(key);
  }

  localStorage.setItem(MIGRATION_KEY, "1");
}

export function openRavinFromWaypoint(prompt = "") {
  const base = ["enterarrow.com", "www.enterarrow.com"].includes(window.location.hostname)
    ? "/ravin/"
    : "https://link9060.github.io/Project-R.A.V.I.N.-1.1/";
  const url = new URL(base, window.location.href);
  url.searchParams.set("from", "waypoint");
  url.searchParams.set("surface", "waypoint");
  if (prompt.trim()) url.searchParams.set("prompt", prompt.trim());
  window.location.assign(url.toString());
}
