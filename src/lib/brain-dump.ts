import type { CapturedItem, CapturedItemType } from "./types";

const DATE_WORDS = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week)\b/i;
const IDEA_WORDS = /\b(idea|remember|thought|note|maybe|what if)\b/i;
const GOAL_WORDS = /\b(goal|want to|eventually|someday|become|learn|improve)\b/i;
const PROJECT_WORDS = /\b(build|launch|finish|project|prototype|design|release)\b/i;
const LATER_WORDS = /\b(eventually|later|not urgent|someday|when i can)\b/i;

function inferType(text: string): CapturedItemType {
  if (LATER_WORDS.test(text)) return "later";
  if (IDEA_WORDS.test(text)) return "note";
  if (GOAL_WORDS.test(text)) return "goal";
  if (PROJECT_WORDS.test(text) && text.length > 45) return "project";
  if (DATE_WORDS.test(text) && /\b(game|meeting|appointment|practice|event|class)\b/i.test(text)) return "event";
  return "task";
}

function inferWhen(text: string) {
  return text.match(DATE_WORDS)?.[0];
}

export function interpretBrainDump(input: string): CapturedItem[] {
  const pieces = input
    .split(/\n+|(?<=[.!?])\s+|,\s+(?=(?:and\s+)?(?:i|we|need|finish|work|study|clean|practice|research|look|start|remember)\b)/i)
    .map((part) => part.trim().replace(/^(and|also|oh and|then)\s+/i, ""))
    .filter((part) => part.length > 2);

  return pieces.slice(0, 14).map((title, index) => ({
    id: `capture-${Date.now()}-${index}`,
    title: title.charAt(0).toUpperCase() + title.slice(1).replace(/[.!?]+$/, ""),
    type: inferType(title),
    when: inferWhen(title),
    accepted: true
  }));
}
