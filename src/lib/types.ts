export type WaypointTab =
  | "today"
  | "dump"
  | "plans"
  | "calendar"
  | "direction"
  | "review";

export type CapturedItemType =
  | "task"
  | "event"
  | "note"
  | "goal"
  | "project"
  | "later";

export type CapturedItem = {
  id: string;
  title: string;
  type: CapturedItemType;
  when?: string | null;
  date?: string | null;
  time?: string | null;
  context?: string | null;
  why?: string | null;
  priority?: "low" | "medium" | "high";
  duration_minutes?: number | null;
  depends_on?: string[];
  accepted?: boolean;
};

export type TodayItem = {
  id: string;
  title: string;
  meta: string;
  completed?: boolean;
};


export type WaypointSignalKind =
  | "priority"
  | "dependency"
  | "conflict"
  | "constraint"
  | "opportunity";

export type WaypointSignal = {
  kind: WaypointSignalKind;
  title: string;
  detail: string;
};

export type WaypointRouteStep = {
  order: number;
  title: string;
  reason?: string | null;
  timing?: string | null;
};
