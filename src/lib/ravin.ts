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

async function getAccessToken() {
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
