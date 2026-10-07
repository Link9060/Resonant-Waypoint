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

let refreshInFlight: { token: string; promise: Promise<string> } | null = null;

async function performRefresh(session: ArrowSession) {
  if (!session?.refresh_token) throw new Error("Your ARROW session expired. Sign in again.");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      signal: controller.signal,
    });

    const refreshed = await response.json().catch(() => null) as ArrowSession | null;
    if (!response.ok || !refreshed?.access_token) {
      throw new Error("Your ARROW session expired. Sign in again.");
    }

    const current = readSession();
    if (!current || current.refresh_token !== session.refresh_token) {
      throw new Error("Your account changed while refreshing. Sign in again.");
    }
    const next = { ...session, ...refreshed };
    writeSession(next);
    return next.access_token!;
  } finally {
    window.clearTimeout(timer);
  }
}

async function refreshAccessToken(session = readSession()) {
  if (!session?.refresh_token) throw new Error("Your ARROW session expired. Sign in again.");
  const token = session.refresh_token;
  if (refreshInFlight?.token === token) return refreshInFlight.promise;
  const promise = performRefresh(session);
  refreshInFlight = {token, promise};
  try { return await promise; }
  finally { if (refreshInFlight?.promise === promise) refreshInFlight = null; }
}

export async function getAccessToken(forceRefresh = false) {
  const session = readSession();
  if (!session?.access_token) {
    const legacy = localStorage.getItem("ravin_access_token") || "";
    if (legacy && !forceRefresh) return legacy;
    throw new Error("Your ARROW session is missing. Open Waypoint through enterarrow.com.");
  }

  const expiresAt = Number(session.expires_at || 0) * 1000;
  const fresh = !expiresAt || expiresAt - Date.now() > 90_000;
  if (!forceRefresh && fresh) return session.access_token;

  if (!session.refresh_token) return session.access_token;
  return refreshAccessToken(session);
}

async function authorizedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
) {
  const account=(readSession()?.user as {id?:string} | undefined)?.id;
  let token = await getAccessToken();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${token}`);

      const response = await fetch(url, {
        ...init,
        headers,
        signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
      });

      if (response.status === 401 && attempt === 0) {
        token = await getAccessToken(true);
        continue;
      }
      if ((readSession()?.user as {id?:string} | undefined)?.id !== account) throw new Error("Your account changed. Refresh Waypoint before continuing.");
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("The request timed out. Check your connection and try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw new Error("Your ARROW session could not be verified.");
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
  const now = localDateParts();

  const response = await authorizedFetch(apiUrl(), {
    method: "POST",
    headers: {
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
  }, 45_000);

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
  estimated_minutes: number | null;
  scheduled_on: string | null;
  scheduled_start: string | null;
};

export type ArrowCalendarEvent = {
  read_only?: boolean;
  source?: string;
  source_href?: string;
  id: string;
  title: string;
  event_date: string;
  is_all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  details: string | null;
};

export type ArrowWaypointItem = {
  id: string;
  source_key: string;
  capture_id: string | null;
  title: string;
  item_type: CapturedItem["type"];
  placement: NonNullable<CapturedItem["placement"]>;
  due_date: string | null;
  due_time: string | null;
  when_text: string | null;
  context: string | null;
  why: string | null;
  priority: NonNullable<CapturedItem["priority"]>;
  duration_minutes: number | null;
  depends_on: string[];
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
};

export type ArrowWaypointCapture = {
  id: string;
  source_key: string;
  raw_input: string;
  summary: string;
  intent: string | null;
  next_move: string | null;
  signals: WaypointSignal[];
  route: WaypointRouteStep[];
  questions: string[];
  source: "ravin" | "local";
  model: string | null;
  applied: boolean;
  applied_at: string | null;
  created_at: string;
};

async function arrowDataRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; prefer?: string; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await authorizedFetch(`${SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }, options.timeoutMs || 15_000);

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      message?: string;
      error?: string;
      details?: string;
      hint?: string;
    } | null;
    throw new Error(
      payload?.message ||
      payload?.error ||
      payload?.details ||
      `ARROW data request failed (HTTP ${response.status}).`
    );
  }

  const text = response.status===204 ? '' : await response.text();
  const data = text ? JSON.parse(text) : null;
  if ((options.method || 'GET').toUpperCase() === 'PATCH' && (!Array.isArray(data) || !data.length)) {
    throw new Error('That item no longer exists or could not be updated. Refresh to reload your planning data.');
  }
  if ((options.method || 'GET').toUpperCase() !== 'GET') {
    try { localStorage.setItem('arrow_shared_data_ping_v1',String(Date.now())); } catch {}
    window.dispatchEvent(new CustomEvent('arrow:planning-changed'));
  }
  return data as T;
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

export function waypointRowToCapturedItem(row: ArrowWaypointItem): CapturedItem {
  return {
    id: row.source_key || row.id,
    title: row.title,
    type: row.item_type,
    placement: row.placement,
    date: row.due_date,
    time: row.due_time?.slice(0, 5) || null,
    when: row.when_text,
    context: row.context,
    why: row.why,
    priority: row.priority,
    duration_minutes: row.duration_minutes,
    depends_on: Array.isArray(row.depends_on) ? row.depends_on : [],
    accepted: true,
  };
}

async function arrowDataAll<T>(path: string): Promise<T[]> {
  const url = new URL(path,'https://arrow.invalid');
  const rows: T[] = [];
  for (let offset=0;;offset+=500) {
    url.searchParams.set('limit','500');url.searchParams.set('offset',String(offset));
    const page = await arrowDataRequest<T[]>(url.pathname+url.search);
    rows.push(...(page ?? []));
    if ((page?.length ?? 0)<500) return rows;
  }
}

export async function loadSharedPlanningData() {
  const calendarLoader = () => (window as Window & {ArrowOS?:{loadCalendarSources?:()=>Promise<{events:ArrowCalendarEvent[];warnings:string[]}>}}).ArrowOS?.loadCalendarSources;
  let calendar=calendarLoader();
  if(location.pathname.startsWith('/Resonant-Relay/arrow/waypoint/')) {
    const deadline=Date.now()+10000;
    while(!calendar&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,100));calendar=calendarLoader();}
    if(!calendar)throw new Error('ARROW calendar controls could not start. Refresh to retry.');
  }
  const [todos, calendarResult, items, captures] = await Promise.all([
    arrowDataAll<ArrowTodo>("/rest/v1/todos?select=id,title,due_on,completed,position,created_at,estimated_minutes,scheduled_on,scheduled_start&order=completed.asc,due_on.asc.nullslast,position.asc,created_at.asc,id.asc&limit=500"),
    calendar ? calendar() : arrowDataRequest<ArrowCalendarEvent[]>("/rest/v1/relay_calendar_events?select=id,title,event_date,is_all_day,start_time,end_time,details&order=event_date.asc,start_time.asc&limit=500").then(events=>({events,warnings:[] as string[]})),
    arrowDataAll<ArrowWaypointItem>("/rest/v1/waypoint_items?status=eq.active&select=id,source_key,capture_id,title,item_type,placement,due_date,due_time,when_text,context,why,priority,duration_minutes,depends_on,status,created_at,updated_at&order=created_at.asc,id.asc&limit=500"),
    arrowDataRequest<ArrowWaypointCapture[]>("/rest/v1/waypoint_captures?select=id,source_key,raw_input,summary,intent,next_move,signals,route,questions,source,model,applied,applied_at,created_at&order=created_at.desc&limit=24"),
  ]);
  return {
    todos: todos || [],
    events: calendarResult.events || [],
    warnings: calendarResult.warnings || [],
    items: items || [],
    captures: captures || [],
  };
}

export async function createSharedTodo(
  title: string,
  dueOn = waypointLocalDate(),
  sourceKey = "",
  estimatedMinutes: number | null = null,
) {
  const path = sourceKey
    ? "/rest/v1/todos?on_conflict=user_id,source_key"
    : "/rest/v1/todos";
  return arrowDataRequest(path, {
    method: "POST",
    prefer: sourceKey ? "resolution=ignore-duplicates,return=representation" : "return=representation",
    body: {
      user_id: arrowUserId(),
      title: title.trim(),
      due_on: dueOn,
      completed: false,
      estimated_minutes: estimatedMinutes,
      source_key: sourceKey || null,
    },
  });
}

export async function setSharedTodoCompleted(id: string, completed: boolean) {
  return arrowDataRequest(`/rest/v1/todos?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(arrowUserId())}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { completed },
  });
}

export async function createSharedCalendarEvent(
  title: string,
  eventDate: string,
  startTime = "",
  sourceKey = "",
  endTime = "",
) {
  const path = sourceKey
    ? "/rest/v1/relay_calendar_events?on_conflict=user_id,source_key"
    : "/rest/v1/relay_calendar_events";
  return arrowDataRequest(path, {
    method: "POST",
    prefer: sourceKey ? "resolution=ignore-duplicates,return=representation" : "return=representation",
    body: {
      user_id: arrowUserId(),
      title: title.trim(),
      event_date: eventDate,
      is_all_day: !startTime,
      start_time: startTime || null,
      end_time: endTime || null,
      source_key: sourceKey || null,
    },
  });
}

export async function createSharedArrowNote(
  title: string,
  text: string,
  sourceKey = "",
) {
  const path = sourceKey
    ? "/rest/v1/notes?on_conflict=user_id,source_key"
    : "/rest/v1/notes";
  return arrowDataRequest(path, {
    method: "POST",
    prefer: sourceKey ? "resolution=ignore-duplicates,return=representation" : "return=representation",
    body: {
      user_id: arrowUserId(),
      title: title.trim().slice(0, 120) || "Waypoint capture",
      content: [{
        id: crypto.randomUUID(),
        type: "paragraph",
        text: text.trim(),
      }],
      is_pinned: false,
      source_key: sourceKey || null,
    },
  });
}

export async function saveSharedWaypointCapture(
  rawInput: string,
  interpretation: WaypointInterpretation,
  sourceKey: string,
) {
  const rows = await arrowDataRequest<ArrowWaypointCapture[]>("/rest/v1/waypoint_captures?on_conflict=user_id,source_key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      user_id: arrowUserId(),
      source_key: sourceKey,
      raw_input: rawInput.trim(),
      summary: interpretation.summary,
      intent: interpretation.intent || null,
      next_move: interpretation.next_move || null,
      signals: interpretation.signals,
      route: interpretation.route,
      questions: interpretation.questions,
      source: interpretation.source,
      model: interpretation.model || null,
      updated_at: new Date().toISOString(),
    },
  });
  return rows?.[0] || null;
}

export async function markSharedWaypointCaptureApplied(id: string) {
  return arrowDataRequest(`/rest/v1/waypoint_captures?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(arrowUserId())}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      applied: true,
      applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
}

export async function upsertSharedWaypointItems(
  items: CapturedItem[],
  captureId: string | null = null,
) {
  if (!items.length) return [] as ArrowWaypointItem[];
  return arrowDataRequest<ArrowWaypointItem[]>("/rest/v1/waypoint_items?on_conflict=user_id,source_key", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=representation",
    body: items.map((item) => ({
      user_id: arrowUserId(),
      source_key: `waypoint:${item.id}`,
      capture_id: captureId,
      title: item.title.trim().slice(0, 240),
      item_type: item.type,
      placement: item.placement || (
        item.type === "project" ? "plans"
          : item.type === "goal" ? "direction"
            : item.type === "note" ? "notes"
              : item.type === "later" ? "later"
                : item.type === "event" ? "calendar"
                  : "plans"
      ),
      due_date: item.date || null,
      due_time: item.time || null,
      when_text: item.when || null,
      context: item.context || null,
      why: item.why || null,
      priority: item.priority || "medium",
      duration_minutes: item.duration_minutes || null,
      depends_on: Array.isArray(item.depends_on) ? item.depends_on : [],
      status: "active",
      updated_at: new Date().toISOString(),
    })),
  });
}

export async function archiveSharedWaypointItem(sourceKey: string) {
  return arrowDataRequest(
    `/rest/v1/waypoint_items?source_key=eq.${encodeURIComponent(sourceKey)}&user_id=eq.${encodeURIComponent(arrowUserId())}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: { status: "archived", updated_at: new Date().toISOString() },
    }
  );
}

export async function migrateLegacyWaypointItems(items: CapturedItem[]) {
  if (!items.length) return;
  const migrated = items.map((item) => ({
    ...item,
    id: item.id.startsWith("legacy-") ? item.id : `legacy-${item.id}`,
  }));
  await upsertSharedWaypointItems(migrated);
}

export function openRavinFromWaypoint(prompt = "") {
  const base = ["enterarrow.com", "www.enterarrow.com"].includes(window.location.hostname)
    ? "/ravin/"
    : "https://link9060.github.io/Project-R.A.V.I.N.-1.1/";
  const resolve=(window as Window & {ArrowOS?:{resolveHref?:(href:string)=>string}}).ArrowOS?.resolveHref;
  const url = new URL(resolve?resolve('/ravin/'):base, window.location.href);
  url.searchParams.set("from", "waypoint");
  url.searchParams.set("surface", "waypoint");
  if (prompt.trim()) url.searchParams.set("prompt", prompt.trim());
  window.location.assign(url.toString());
}

export async function updateSharedTodo(id: string, changes: {title?: string; due_on?: string; completed?: boolean; estimated_minutes?: number | null; scheduled_on?: string | null; scheduled_start?: string | null}) {
  return arrowDataRequest(`/rest/v1/todos?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(arrowUserId())}`, {method:'PATCH',prefer:'return=representation',body:changes});
}
export async function deleteSharedEvent(id: string) {
  return arrowDataRequest(`/rest/v1/relay_calendar_events?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(arrowUserId())}`, {method:'DELETE',prefer:'return=representation'});
}

export type ScheduleBlock = {task_id:string; title:string; date:string; start:string; end:string; minutes:number; late:boolean};
export type AutoPlan = {blocks:ScheduleBlock[];unscheduled:{task_id:string;title:string;reason:string}[];conflicts:string[];source:string;generated_at:string;can_apply?:boolean};
export async function generateAutoPlan(start:string,end:string):Promise<AutoPlan> {
  if(location.pathname.startsWith('/Resonant-Relay/arrow/')) {
    const os=(window as Window & {ArrowOS?:{previewPlan?:(start:string,end:string)=>Promise<AutoPlan>}}).ArrowOS;
    if(!os?.previewPlan)throw new Error('The beta planning tools are still loading. Please retry.');
    return os.previewPlan(start,end);
  }
  const endpoint=['enterarrow.com','www.enterarrow.com'].includes(location.hostname)?'/ravin/api/waypoint/plan':'https://ravin-hyeq.onrender.com/api/waypoint/plan';
  const response=await authorizedFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start,end,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})},45000);
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not build your plan.');return data;
}
export async function applyScheduleBlock(block:ScheduleBlock) {
  return arrowDataRequest('/rest/v1/rpc/arrow_schedule_task',{method:'POST',body:{p_task_id:block.task_id,p_date:block.date,p_start:block.start,p_end:block.end}});
}

export async function updateSharedCalendarEvent(id:string,changes:Pick<ArrowCalendarEvent,'title'|'event_date'|'start_time'|'end_time'|'is_all_day'>) {
  return arrowDataRequest(`/rest/v1/relay_calendar_events?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(arrowUserId())}`,{method:'PATCH',prefer:'return=representation',body:changes});
}
export async function updateSharedPlan(sourceKey:string,changes:{title:string;due_date:string|null;due_time:string|null;status:'active'|'completed';duration_minutes:number|null}) {
  return arrowDataRequest(`/rest/v1/waypoint_items?source_key=eq.${encodeURIComponent(sourceKey)}&user_id=eq.${encodeURIComponent(arrowUserId())}`,{method:'PATCH',prefer:'return=representation',body:{...changes,updated_at:new Date().toISOString()}});
}

