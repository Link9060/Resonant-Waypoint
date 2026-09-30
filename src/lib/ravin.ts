import type { CapturedItem, TodayItem, WaypointRouteStep, WaypointSignal } from "./types";

const SUPABASE_URL = "https://cnorozrjugxpanpfmssa.supabase.co";
const SUPABASE_KEY = "sb_publishable_yVNPiB7opT0WRvBfKTZ2BA_s5bOQLRg";
const SESSION_KEY = "sb-cnorozrjugxpanpfmssa-auth-token";

type ArrowSession = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: unknown;
};

export type WaypointInterpretation = {
  summary: string;
  intent?: string | null;
  next_move?: string | null;
  signals: WaypointSignal[];
  route: WaypointRouteStep[];
  questions: string[];
  items: CapturedItem[];
  model?: string | null;
  source: "ravin" | "local";
};

export type WaypointContext = {
  tasks: TodayItem[];
  events: Array<{ id: string; title: string; date: string; time?: string }>;
  library: CapturedItem[];
};

function readSession(): ArrowSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as ArrowSession : null;
  } catch {
    return null;
  }
}

function writeSession(session: ArrowSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export async function getAccessToken() {
  let session = readSession();
  if (!session?.access_token) {
    const legacy = localStorage.getItem("ravin_access_token") || "";
    if (legacy) return legacy;
    throw new Error("Your ARROW session is missing. Open Waypoint through enterarrow.com.");
  }

  const expiresAt = Number(session.expires_at || 0) * 1000;
  const fresh = !expiresAt || expiresAt - Date.now() > 90_000;
  if (fresh) return session.access_token;

  if (!session.refresh_token) return session.access_token;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  const refreshed = await response.json().catch(() => null) as ArrowSession | null;
  if (!response.ok || !refreshed?.access_token) {
    throw new Error("Your ARROW session expired. Sign in again.");
  }

  session = { ...session, ...refreshed };
  writeSession(session);
  return session.access_token;
}

function apiUrl() {
  if (["enterarrow.com", "www.enterarrow.com"].includes(window.location.hostname)) {
    return "/ravin/api/waypoint/interpret";
  }
  return "https://ravin-hyeq.onrender.com/api/waypoint/interpret";
}

function localDateParts(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

export async function interpretWithRavin(
  input: string,
  context: WaypointContext
): Promise<WaypointInterpretation> {
  const token = await getAccessToken();
  const now = localDateParts();

  const response = await fetch(apiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      input,
      current_date: now.date,
      local_time: now.time,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      context,
    }),
  });

  const data = await response.json().catch(() => ({})) as {
    error?: string;
    summary?: string;
    intent?: string | null;
    next_move?: string | null;
    signals?: WaypointSignal[];
    route?: WaypointRouteStep[];
    questions?: string[];
    items?: CapturedItem[];
    model?: string | null;
    source?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || `RAVIN request failed (HTTP ${response.status}).`);
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const route = Array.isArray(data.route) ? data.route : [];
  const questions = Array.isArray(data.questions) ? data.questions : [];

  if (!items.length && !route.length && !questions.length) {
    throw new Error("RAVIN returned no useful Waypoint interpretation.");
  }

  return {
    summary: data.summary || "RAVIN organized the capture into a clearer route.",
    intent: data.intent || null,
    next_move: data.next_move || null,
    signals: Array.isArray(data.signals) ? data.signals : [],
    route,
    questions,
    items: items.map((item, index) => ({
      ...item,
      id: item.id || `ravin-${Date.now()}-${index}`,
      accepted: item.accepted !== false,
    })),
    model: data.model || null,
    source: "ravin",
  };
}


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

async function arrowDataRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

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

function arrowUserId() {
  const session = readSession();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) throw new Error("Your ARROW session is missing its account ID.");
  return user.id;
}

function waypointLocalDate(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export async function loadSharedPlanningData() {
  const [todos, events] = await Promise.all([
    arrowDataRequest<ArrowTodo[]>("/rest/v1/todos?select=id,title,due_on,completed,position,created_at&order=completed.asc,due_on.asc,position.asc,created_at.asc&limit=160"),
    arrowDataRequest<ArrowCalendarEvent[]>("/rest/v1/relay_calendar_events?select=id,title,event_date,is_all_day,start_time,end_time,details&order=event_date.asc,start_time.asc&limit=200"),
  ]);
  return { todos: todos || [], events: events || [] };
}

export async function createSharedTodo(title: string, dueOn = waypointLocalDate()) {
  return arrowDataRequest("/rest/v1/todos", {
    method: "POST",
    prefer: "return=representation",
    body: {
      user_id: arrowUserId(),
      title: title.trim(),
      due_on: dueOn,
      completed: false,
    },
  });
}

export async function setSharedTodoCompleted(id: string, completed: boolean) {
  return arrowDataRequest(`/rest/v1/todos?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(arrowUserId())}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { completed },
  });
}

export async function createSharedCalendarEvent(
  title: string,
  eventDate: string,
  startTime = "",
) {
  return arrowDataRequest("/rest/v1/relay_calendar_events", {
    method: "POST",
    prefer: "return=representation",
    body: {
      user_id: arrowUserId(),
      title: title.trim(),
      event_date: eventDate,
      is_all_day: !startTime,
      start_time: startTime || null,
    },
  });
}

export async function createSharedArrowNote(title: string, text: string) {
  return arrowDataRequest("/rest/v1/notes", {
    method: "POST",
    prefer: "return=representation",
    body: {
      user_id: arrowUserId(),
      title: title.trim().slice(0, 120) || "Waypoint capture",
      content: [{
        id: crypto.randomUUID(),
        type: "paragraph",
        text: text.trim(),
      }],
      is_pinned: false,
    },
  });
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
