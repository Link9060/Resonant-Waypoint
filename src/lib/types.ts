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
  when?: string;
  context?: string;
  accepted?: boolean;
};

export type TodayItem = {
  id: string;
  title: string;
  meta: string;
  completed?: boolean;
};
