import fs from "node:fs";

const shell = fs.readFileSync("src/components/waypoint-shell.tsx", "utf8");
const ravin = fs.readFileSync("src/lib/ravin.ts", "utf8");

const forbidden = [
  ["placeholder project progress", '<span>0%</span>'],
  ["prototype review copy", "This prototype review"],
  ["browser-only Waypoint library writes", "localStorage.setItem(LIBRARY_KEY"],
  ["old user-facing Dump label", 'label: "Dump"'],
];

for (const [label, needle] of forbidden) {
  if (shell.includes(needle)) {
    throw new Error(`Production check failed: ${label} is still present.`);
  }
}

const required = [
  ["account-backed Waypoint items", "/rest/v1/waypoint_items"],
  ["Capture history persistence", "/rest/v1/waypoint_captures"],
  ["idempotent shared writes", "on_conflict=user_id,source_key"],
  ["authenticated request retry", "getAccessToken(true)"],
];

for (const [label, needle] of required) {
  if (!ravin.includes(needle)) {
    throw new Error(`Production check failed: missing ${label}.`);
  }
}

if (!shell.includes("isApplyingCapture") || !shell.includes('disabled={!acceptedCount || isApplying}')) {
  throw new Error("Production check failed: Capture apply is not protected against double-submit.");
}

console.log("Waypoint production checks passed.");
