// Pure functions over the Shield KYA trail (~/.kya/trail.jsonl). No Herdr imports, so Node tests can load this file.

const VERDICT = { ALLOW: "allow", REQUIRE_APPROVE: "hold", HOLD: "hold", DENY: "deny" };
// Navigation-only shell classes: counted, but hidden from the top list (same rule as `kya map`).
const NAV_ONLY = new Set(["command:cd", "command:ls", "command:pwd"]);
// Herdr reports the agent app ("claude-code"); kya records the product ("claude").
const APP_TO_PRODUCT = { "claude-code": "claude", "copilot-cli": "copilot", "gemini-cli": "gemini", "kimi-code": "kimi" };

export const productOf = (app) => (app ? APP_TO_PRODUCT[app] ?? app : null);
const basename = (p) => (p || "").replace(/\/+$/, "").split("/").pop() || "";
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Trail text (JSON lines) to events, oldest first. Bad or partial lines are skipped. */
export function parseLines(text) {
  const out = [];
  for (const line of (text || "").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== "object" || typeof e.ts !== "string" || typeof e.toolId !== "string") continue;
    out.push({
      id: `${e.ts}|${e.sessionId ?? ""}|${e.argsHash ?? e.toolId}`,
      ts: e.ts,
      product: typeof e.product === "string" ? e.product : null,
      project: typeof e.project === "string" ? e.project : null,
      tool: e.toolId,
      cls: typeof e.targetClass === "string" ? e.targetClass : null,
      verdict: Object.hasOwn(VERDICT, e.verdict) ? VERDICT[e.verdict] : "other",
      reason: typeof e.reasonCode === "string" ? e.reasonCode : "",
      never: e.neverEvent === true,
      // summary is redacted by kya already; raw arguments are never in the trail.
      summary: clip(typeof e.summary === "string" ? e.summary : "", 120),
    });
  }
  return out;
}

/** The Herdr space an event belongs to: space folder name == project, and an agent there runs the same product. */
export function matchSpace(event, spaces, agents) {
  if (!event.project) return null;
  const hits = spaces.filter((s) => basename(s.folder) === event.project);
  if (hits.length === 0) return null;
  const withProduct = hits.find((s) => agents.some((a) => a.space === s.id && productOf(a.app) === event.product));
  return (withProduct ?? hits[0]).id;
}

const counts = () => ({ allow: 0, hold: 0, deny: 0, other: 0, never: 0 });

/** Groups events by Herdr space (newest first inside each); unmatched events go to "other". */
export function groupBySpace(events, spaces, agents, recent = 5) {
  const groups = new Map();
  for (const e of events) {
    const id = matchSpace(e, spaces, agents);
    const key = id ?? "other";
    if (!groups.has(key)) {
      const s = spaces.find((x) => x.id === id);
      groups.set(key, { key, space: id, label: s ? s.name : "Other", counts: counts(), recent: [], last: "" });
    }
    const g = groups.get(key);
    g.counts[e.verdict] += 1;
    if (e.never) g.counts.never += 1;
    if (e.ts > g.last) g.last = e.ts;
    g.recent.push(e);
  }
  const list = [...groups.values()];
  for (const g of list) g.recent = g.recent.slice(-recent).reverse();
  // Matched spaces by newest event, "Other" last.
  return list.sort((a, b) => (a.space === null) - (b.space === null) || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

/** Top target classes (falls back to the tool id), navigation-only classes left out. */
export function topClasses(events, n = 3) {
  const c = new Map();
  for (const e of events) {
    const k = e.cls ?? e.tool;
    if (NAV_ONLY.has(k)) continue;
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}

/** Denies and never-list hits not in `seen`. Adds them to `seen`. */
export function newDenies(events, seen) {
  const out = [];
  for (const e of events) {
    if ((e.verdict === "deny" || e.never) && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  return out;
}

export function totals(events) {
  const t = counts();
  for (const e of events) { t[e.verdict] += 1; if (e.never) t.never += 1; }
  return t;
}
