import test from "node:test";
import assert from "node:assert/strict";
import { parseLines, matchSpace, groupBySpace, topClasses, newDenies, totals, productOf } from "../mods/kya/trail.js";

const line = (o) => JSON.stringify(o);
const FIXTURE = [
  line({ ts: "2026-11-10T09:00:00.000Z", sessionId: "s1", product: "claude", project: "shop", toolId: "Read", targetClass: "file:read", verdict: "ALLOW", reasonCode: "LOW_RISK_READ", argsHash: "a1", summary: "read src/a.ts" }),
  "{not json",
  line({ ts: "2026-11-10T09:01:00.000Z", sessionId: "s1", product: "claude", project: "shop", toolId: "Bash", targetClass: "command:cd", verdict: "REQUIRE_APPROVE", reasonCode: "SHELL_EXEC", argsHash: "a2", summary: "shell cd" }),
  line({ ts: "2026-11-10T09:02:00.000Z", sessionId: "s1", product: "claude", project: "shop", toolId: "Bash", targetClass: "command:rm", verdict: "DENY", reasonCode: "NEVER_EVENT", neverEvent: true, argsHash: "a3", summary: "shell rm -rf ~" }),
  line({ ts: "2026-11-10T09:03:00.000Z", sessionId: "s2", product: "codex", project: "api", toolId: "Edit", targetClass: "file:write", verdict: "REQUIRE_APPROVE", reasonCode: "HIGH_STAKES_WRITE", argsHash: "a4", summary: "x".repeat(300) }),
  line({ ts: "2026-11-10T09:04:00.000Z", sessionId: "s3", product: "pi", project: "nowhere", toolId: "Write", verdict: "WEIRD", argsHash: "a5" }),
  line({ ts: 5, toolId: "Read" }),
  "",
].join("\n");

const spaces = [
  { id: "sp1", name: "shop", folder: "/Users/me/dev/shop/" },
  { id: "sp2", name: "api", folder: "/Users/me/dev/api" },
];
const agents = [
  { space: "sp1", app: "claude-code" },
  { space: "sp2", app: "codex" },
];

test("parseLines skips bad lines and maps verdicts", () => {
  const ev = parseLines(FIXTURE);
  assert.equal(ev.length, 5);
  assert.deepEqual(ev.map((e) => e.verdict), ["allow", "hold", "deny", "hold", "other"]);
  assert.equal(ev[2].never, true);
  assert.equal(ev[3].summary.length, 120);
  assert.ok(ev[3].summary.endsWith("…"));
  assert.equal(parseLines("").length, 0);
  assert.equal(parseLines(JSON.stringify({ ts: "t", toolId: "x", verdict: "constructor" }))[0].verdict, "other");
});

test("matchSpace uses folder basename and product", () => {
  const ev = parseLines(FIXTURE);
  assert.equal(matchSpace(ev[0], spaces, agents), "sp1");
  assert.equal(matchSpace(ev[3], spaces, agents), "sp2");
  assert.equal(matchSpace(ev[4], spaces, agents), null);
  assert.equal(productOf("claude-code"), "claude");
  assert.equal(productOf(null), null);
});

test("matchSpace prefers the space that runs the same product", () => {
  const two = [{ id: "a", name: "shop", folder: "/x/shop" }, { id: "b", name: "shop 2", folder: "/y/shop" }];
  const ag = [{ space: "b", app: "claude-code" }];
  assert.equal(matchSpace(parseLines(FIXTURE)[0], two, ag), "b");
});

test("groupBySpace counts, orders newest first, Other last", () => {
  const g = groupBySpace(parseLines(FIXTURE), spaces, agents, 2);
  assert.deepEqual(g.map((x) => x.label), ["api", "shop", "Other"]);
  const shop = g[1];
  assert.deepEqual(shop.counts, { allow: 1, hold: 1, deny: 1, other: 0, never: 1 });
  assert.deepEqual(shop.recent.map((e) => e.tool), ["Bash", "Bash"]);
  assert.equal(shop.recent[0].verdict, "deny");
});

test("topClasses hides navigation-only classes and falls back to tool id", () => {
  const top = topClasses(parseLines(FIXTURE), 10);
  assert.ok(!top.some(([k]) => k === "command:cd"));
  assert.ok(top.some(([k]) => k === "Write"));
});

test("newDenies reports each deny once", () => {
  const ev = parseLines(FIXTURE), seen = new Set();
  assert.equal(newDenies(ev, seen).length, 1);
  assert.equal(newDenies(ev, seen).length, 0);
});

test("totals", () => {
  assert.deepEqual(totals(parseLines(FIXTURE)), { allow: 1, hold: 2, deny: 1, other: 1, never: 1 });
});
