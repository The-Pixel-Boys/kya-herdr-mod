// Shield KYA window for Herdr: what KYA recorded for each agent, beside the terminals. Never changes a verdict.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, exec, watchFolder, notify, theme, home } from "herdr";
import { parseLines, groupBySpace, topClasses, newDenies, totals } from "./trail.js";

// The trail grows without a cap on disk; read only its end.
const TAIL_LINES = "500";
const INSTALL = "npm i -g @shield-agent/kya && kya start";
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const time = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default class Kya extends View {
  init(_props, cx) {
    this.events = []; this.state = "loading"; this.seen = new Set(); this.primed = false; this.note = null;
    cx.spawn(async (cx) => this.refresh(cx));
    cx.timer.every(15000, (cx) => { cx.spawn(async (cx) => this.refresh(cx)); });
  }

  // Where the record is and whether `kya` is on PATH. Asked again on every refresh until it answers.
  async locate() {
    // KYA_HOME overrides ~ for kya itself; follow it.
    const r = await exec("sh", ["-c", 'printf %s "${KYA_HOME:-$HOME}/.kya"; command -v kya >/dev/null 2>&1 && printf "\\nkya"'], { timeout: 5000 }).catch(() => null);
    if (!r || r.code !== 0) return false;
    const [dir, has] = r.stdout.split("\n");
    this.dir = dir || null; this.hasKya = has === "kya";
    return Boolean(this.dir);
  }

  watch(cx) {
    if (this.watching || !this.dir) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const paths = await watchFolder(this.dir);
          // kya also writes stamp files here; only the record (or a full-refresh root) matters.
          if (paths.some((p) => p === this.dir || p.endsWith("/trail.jsonl"))) await this.refresh(cx);
        }
      } catch { this.watching = false; /* the 15 s timer keeps it fresh and restarts the watch */ }
    });
  }

  async refresh(cx) {
    if (this.loading) { this.dirty = true; return; }
    this.loading = true;
    try {
      if (!this.dir || !this.hasKya) {
        const found = await this.locate();
        if (!found) { this.state = "error"; return; }
      }
      this.watch(cx);
      const r = await exec("tail", ["-n", TAIL_LINES, "--", `${this.dir}/trail.jsonl`], { timeout: 10000 });
      if (r.code !== 0) { this.state = this.hasKya ? "empty" : "missing"; this.events = []; this.primed = true; return; }
      this.events = parseLines(r.stdout);
      this.state = this.events.length ? "ready" : "empty";
      const fresh = newDenies(this.events, this.seen);
      // The first read only marks what is there; toasts are for denies that happen while Herdr is open.
      if (this.primed) {
        for (const e of fresh.slice(-3)) {
          const where = [clip(e.project ?? "", 40), clip(e.tool, 40)].filter(Boolean).join(" ");
          notify({ title: e.never ? "KYA never-list hit" : "KYA flagged a call: deny", body: e.summary ? `${where}: ${e.summary}` : where, level: "warning" });
        }
      }
      this.primed = true;
    } catch { this.state = "error"; } finally {
      this.loading = false; cx.notify();
      // A change that came in during this read: read once more.
      if (this.dirty) { this.dirty = false; cx.spawn(async (cx) => this.refresh(cx)); }
    }
  }

  openReport(cx) {
    this.note = "Opening the KYA report…"; cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("kya", ["receipt", "--open"], { cwd: home(), timeout: 20000 }).catch(() => null);
      this.note = r && r.code === 0 ? null : "Could not open the report. Run: kya receipt --open";
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const color = { allow: t.ansi2, hold: t.ansi3, deny: t.blocked, other: t.dim };
    const root = v_flex().id("root").size_full().bg(t.surface).text_size(12.5).text_color(t.foreground);
    const header = h_flex().px(12).py(8).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/kya/kya.svg").size(14).text_color(t.accent))
      .child(div().font_semibold().child("Shield KYA"))
      .child(div().flex_1())
      .child(div().id("open").px(8).py(2).rounded(5).border(1).border_color(t.input).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.openReport(cx)).child("Open report"));

    if (this.state !== "ready") {
      const msg = {
        loading: "Reading the KYA record…",
        missing: `KYA is not installed. Install: ${INSTALL}`,
        empty: "No KYA record yet. Run: kya start",
        error: "Could not read the KYA record.",
      }[this.state];
      return root.child(header).child(div().p(12).text_color(t.muted).child(msg));
    }

    const sum = totals(this.events);
    const badge = (n, v, label) => div().text_color(color[v]).child(`${n} ${label}`);
    const groups = groupBySpace(this.events, spaces(), agents());
    const status = (spaceId) => {
      const a = agents().filter((x) => x.space === spaceId);
      return a.length ? a.reduce((m, x) => (["blocked", "working", "done", "idle"].indexOf(x.status) < ["blocked", "working", "done", "idle"].indexOf(m) ? x.status : m), "idle") : null;
    };
    const row = (e) => h_flex().gap(6).items_center().py(1)
      .child(div().w(36).flex_none().text_color(t.dim).child(time(e.ts)))
      .child(div().w(40).flex_none().text_color(color[e.verdict]).child(e.never ? "never" : e.verdict))
      .child(div().flex_1().truncate().text_color(t.muted).child(`${e.tool} · ${e.summary}`));

    const body = v_flex().id("body").flex_1().overflow_y_scrollbar().px(12).py(8).gap(12).children(groups.map((g) => {
      const st = g.space ? status(g.space) : null;
      return v_flex().gap(2)
        .child(h_flex().gap(6).items_center()
          .child(div().w(7).h(7).rounded(4).bg(st ? t[st] ?? t.idle : t.dim))
          .child(div().font_semibold().truncate().child(g.label))
          .child(div().flex_1())
          .child(div().text_color(t.dim).text_size(11.5).child(`${g.counts.allow}·${g.counts.hold}·${g.counts.deny}`)))
        .children(g.recent.map(row));
    }));

    const top = topClasses(this.events);
    const footer = v_flex().px(12).py(8).gap(4).border_t(1).border_color(t.border).text_size(11.5).text_color(t.dim)
      .when(top.length > 0, (el) => el.child(div().truncate().child(`Top: ${top.map(([k, n]) => `${k} ${n}`).join(", ")}`)))
      .when(Boolean(this.note), (el) => el.child(div().text_color(t.muted).child(this.note)))
      .child(div().child(`Last ${this.events.length} calls. Local KYA is advisory and fails open; enforcement is the hosted plane.`));

    return root.child(header)
      .child(h_flex().px(12).py(6).gap(12).border_b(1).border_color(t.border)
        .child(badge(sum.allow, "allow", "allow")).child(badge(sum.hold, "hold", "hold")).child(badge(sum.deny, "deny", "deny"))
        .when(sum.never > 0, (el) => el.child(div().text_color(t.blocked).child(`${sum.never} never-list`))))
      .child(body).child(footer);
  }
}
