// Warframe Price Tracker (beta): renders data/latest.json as a wall of cards.
(() => {
  "use strict";

  const STALE_HOURS = 3;
  const SVG = "http://www.w3.org/2000/svg";
  const OWNED_KEY = "wpt-owned-v1"; // {slug: how many}, kept in this browser only
  const LAYOUT_KEY = "wpt-layout"; // "rows" or "cards", remembered per browser
  const WATCH_KEY = "wpt-watch-v1"; // {slug: target plat, or null for "just watching"}
  const MAX_QTY = 999;
  const grid = document.getElementById("grid");
  const meta = document.getElementById("meta");
  const notice = document.getElementById("notice");
  const sortSel = document.getElementById("sort");
  const search = document.getElementById("search");
  const groupTabs = document.getElementById("groups");
  const pickBtns = document.getElementById("picks");
  const kindTabs = document.getElementById("kinds");
  const heading = document.getElementById("heading");
  const count = document.getElementById("count");
  const pickNote = document.getElementById("pick-note");
  const portfolioEl = document.getElementById("portfolio");
  const ownedCount = document.getElementById("owned-count");
  const layoutBtns = document.getElementById("layout");
  const mineBar = document.getElementById("mine-bar");
  const mineTabs = document.getElementById("mine-tabs");
  const GROUPS = {
    buy: "Near lows", sell: "Rising", owned: "Owned items", watch: "Tracking",
    warframe: "Warframes", primary: "Primary weapons", secondary: "Secondary weapons", melee: "Melee weapons",
  };
  const LISTS = new Set(["buy", "sell", "owned", "watch"]); // views that aren't a category
  const MINE = new Set(["owned", "watch"]); // the two tabs under "My items"
  const WATCH_NOTE = "Star any item to track it. Give it a target price and it jumps to the top, marked Target hit, once the lowest sell is at or under your target. Prices update hourly; the page checks them while it's open but can't notify you when it's closed.";
  const SINGULAR = { warframe: "Warframe", primary: "Primary", secondary: "Secondary", melee: "Melee" };
  const KINDS = { set: "sets", part: "parts", all: "sets and parts" };
  const PICK_NOTES = {
    buy: "At or near their lowest price in the last 90 days and at least 10% under their 30-day average. Items under 10p and items with less than 30 days of history (like new releases, which keep dropping for weeks) are left out.",
    sell: "At least 10% over their 30-day average, with the 7-day average also at least 5% over it, so a one-off spike doesn't count. Items under 10p and items with less than 30 days of history (like new releases, which keep dropping for weeks) are left out.",
  };
  let sets = [];
  let picks = { buy: [], sell: [] };
  let sparkStart = null;
  let view = { group: "warframe", kind: "set" };
  let owned = loadOwned();
  let watch = loadWatch();
  let bySlug = new Map();
  let mineTab = "owned"; // which My items tab the header button opens
  let layout = "rows";
  try { if (localStorage.getItem(LAYOUT_KEY) === "cards") layout = "cards"; } catch { /* storage blocked */ }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const plat = (v) => (v == null ? "–" : `${Math.round(v * 10) / 10}p`);
  const whole = (v) => Math.round(v).toLocaleString();
  const DAY = 86400000;
  const dayDate = (i) => new Date(sparkStart + i * DAY);
  const fmtDay = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const fmtIso = (iso) => fmtDay(new Date(`${iso}T00:00:00Z`));
  const shortName = (name) => name.replace(/ Set$/, "");
  const signed = (p, digits = 1) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(digits)}%`;
  const isPicks = () => view.group === "buy" || view.group === "sell";

  function ago(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }

  // ---- owned items (localStorage; can be blocked or empty, so every access is guarded)

  function cleanOwned(raw) {
    const out = {};
    if (raw && typeof raw === "object") {
      for (const [slug, n] of Object.entries(raw)) {
        const q = Math.floor(Number(n));
        if (/^[a-z0-9_]+$/.test(slug) && q > 0) out[slug] = Math.min(q, MAX_QTY);
      }
    }
    return out;
  }
  function loadOwned() {
    try { return cleanOwned(JSON.parse(localStorage.getItem(OWNED_KEY) || "{}")); } catch { return {}; }
  }
  function saveOwned() {
    try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned)); } catch { /* private mode: keeps working until reload */ }
    updateMineCount();
  }

  // ---- watchlist: same storage rules as owned items

  function cleanWatch(raw) {
    const out = {};
    if (raw && typeof raw === "object") {
      for (const [slug, t] of Object.entries(raw)) {
        if (!/^[a-z0-9_]+$/.test(slug)) continue;
        const n = Number(t);
        out[slug] = t == null || t === "" || !(n > 0) ? null : Math.min(Math.round(n * 10) / 10, 99999);
      }
    }
    return out;
  }
  function loadWatch() {
    try { return cleanWatch(JSON.parse(localStorage.getItem(WATCH_KEY) || "{}")); } catch { return {}; }
  }
  function saveWatch() {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(watch)); } catch { /* private mode */ }
    updateMineCount();
  }
  const isWatched = (slug) => Object.prototype.hasOwnProperty.call(watch, slug);

  // Where the item stands against its target: null when there's no target or no price.
  function targetState(item) {
    const t = watch[item.slug];
    if (t == null || item.sell == null) return null;
    return { target: t, hit: item.sell <= t, pct: ((item.sell - t) / t) * 100 };
  }
  const isHit = (item) => !!targetState(item)?.hit;

  // The header button shows how many targets are hit; otherwise how many items you keep.
  function updateMineCount() {
    const hits = Object.keys(watch).filter((slug) => bySlug.has(slug) && isHit(bySlug.get(slug))).length;
    ownedCount.textContent = hits ? `${hits} hit` : String(Object.keys(owned).length + Object.keys(watch).length);
    ownedCount.classList.toggle("hot", hits > 0);
    document.getElementById("n-owned").textContent = String(Object.keys(owned).length);
    document.getElementById("n-watch").textContent = hits ? `${Object.keys(watch).length} · ${hits} hit` : String(Object.keys(watch).length);
  }

  function toggleWatch(item) {
    if (isWatched(item.slug)) delete watch[item.slug];
    else watch[item.slug] = null;
    saveWatch();
  }

  function targetInput(item) {
    const label = el("label", "target");
    label.append(el("span", "target-label", "Target"));
    const input = el("input");
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.inputMode = "numeric";
    input.placeholder = "none";
    input.value = watch[item.slug] == null ? "" : String(watch[item.slug]);
    input.setAttribute("aria-label", `Target price for ${item.name}, in plat`);
    input.addEventListener("change", () => {
      watch[item.slug] = cleanWatch({ [item.slug]: input.value })[item.slug];
      saveWatch();
      render();
    });
    label.append(input, el("span", "unit", "p"));
    return label;
  }

  // One short line about the target, or null when the item has none.
  function watchLine(item) {
    const st = targetState(item);
    if (!st) return null;
    if (st.hit) {
      const under = st.target - item.sell;
      return el("div", "watch-line hit", `Target hit · ${plat(item.sell)}${under > 0 ? `, ${plat(under)} under ${plat(st.target)}` : ` = ${plat(st.target)}`}`);
    }
    return el("div", "watch-line", `Target ${plat(st.target)} · ${st.pct.toFixed(0)}% above`);
  }
  function setQty(slug, qty) {
    if (qty > 0) owned[slug] = Math.min(qty, MAX_QTY);
    else delete owned[slug];
    saveOwned();
  }

  function ownControl(item) {
    const box = el("div", "own");
    const q = owned[item.slug] || 0;
    const change = (n) => {
      setQty(item.slug, n);
      const c = box.closest(".card");
      if (inMine()) render();
      else if (c) c.replaceWith(card(item));
      else box.replaceWith(ownControl(item));
    };
    if (!q) {
      const add = el("button", "own-add", "+ Mark as owned");
      add.type = "button";
      add.addEventListener("click", () => change(1));
      box.appendChild(add);
      return box;
    }
    box.classList.add("is-owned");
    const label = el("span", "own-label", "Owned");
    const minus = el("button", "own-step", "−");
    const plus = el("button", "own-step", "+");
    minus.type = plus.type = "button";
    minus.setAttribute("aria-label", q === 1 ? `Remove ${item.name} from owned` : `Own one fewer ${item.name}`);
    plus.setAttribute("aria-label", `Own one more ${item.name}`);
    minus.addEventListener("click", () => change(q - 1));
    plus.addEventListener("click", () => change(q + 1));
    const qty = el("span", "own-qty", `×${q}`);
    qty.setAttribute("aria-live", "polite");
    const worth = item.sell != null ? el("span", "own-worth", `≈ ${whole(item.sell * q)}p`) : null;
    box.append(label, minus, qty, plus);
    if (worth) box.appendChild(worth);
    return box;
  }

  function exportMine() {
    const body = JSON.stringify({ app: "warframe-price-tracker", owned, watch }, null, 1);
    const a = el("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    a.download = "warframe-price-tracker-my-items.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importMine() {
    const input = el("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        // Older exports were just {owned} (or a bare {slug: qty} map).
        const nextOwned = cleanOwned(data.owned || (data.watch ? {} : data));
        const nextWatch = cleanWatch(data.watch || {});
        const nO = Object.keys(nextOwned).length, nW = Object.keys(nextWatch).length;
        if (!nO && !nW) throw new Error("no items in file");
        const have = Object.keys(owned).length + Object.keys(watch).length;
        if (have && !confirm(`Replace your current lists with this file (${nO} owned, ${nW} tracked)?`)) return;
        owned = nextOwned;
        watch = nextWatch;
        saveOwned();
        saveWatch();
        render();
      } catch (err) {
        alert(`Couldn't import that file (${err.message}).`);
      }
    });
    input.click();
  }

  // ---- charts

  // Chart with its date range on top, high/low values on the side and a
  // date + price readout that follows the pointer.
  function chartBox(item, opts = {}) {
    const pts = item.spark.map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (pts.length < 2) {
      const since = item.tracked_since ? ` since ${item.tracked_since}` : "";
      return el("div", "chart-empty", `Collecting history${since}`);
    }
    const fmt = opts.format || plat;
    const head = el("div", "chart-head");
    const first = pts[0][0], last = pts[pts.length - 1][0];
    const rangeEl = el("span", "chart-range", `${fmtDay(dayDate(first))} – ${fmtDay(dayDate(last))} · ${pts.length} days`);
    const readout = el("span", "chart-readout");
    head.append(rangeEl, readout);

    const vals = pts.map(([, v]) => v);
    const { svg: s, x, y, W, H } = sparkline(item, pts, opts.height || 64);
    const cross = svg("line", { x1: 0, x2: 0, y1: 0, y2: H, stroke: "#6B7480", "stroke-width": 1, "vector-effect": "non-scaling-stroke", visibility: "hidden" });
    s.appendChild(cross);
    const dot = el("span", "chart-dot");
    const plot = el("div", "chart-plot");
    plot.append(s, el("span", "chart-hi", fmt(Math.max(...vals))), el("span", "chart-lo", fmt(Math.min(...vals))), dot);

    const reset = () => { cross.setAttribute("visibility", "hidden"); dot.hidden = true; readout.textContent = ""; rangeEl.hidden = false; };
    plot.addEventListener("pointermove", (e) => {
      const r = s.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left) / r.width) * (item.spark.length - 1));
      const near = pts.reduce((a, b) => (Math.abs(b[0] - i) < Math.abs(a[0] - i) ? b : a));
      const px = x(near[0]);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      dot.hidden = false;
      dot.style.left = `${(px / W) * r.width}px`;
      dot.style.top = `${(y(near[1]) / H) * r.height}px`;
      readout.textContent = `${fmtDay(dayDate(near[0]))} · ${fmt(near[1])}`;
      rangeEl.hidden = true;
    });
    plot.addEventListener("pointerleave", reset);
    reset();
    const box = el("div", "chart-box");
    box.append(head, plot);
    return box;
  }

  function sparkline(item, pts, H) {
    const W = 240, n = item.spark.length - 1;
    const values = pts.map(([, v]) => v).concat(item.avg30 != null ? [item.avg30] : []);
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const x = (i) => (i / n) * W;
    const y = (v) => H - 6 - ((v - min) / span) * (H - 14);

    // Break the line where days are missing instead of drawing across gaps.
    let d = "", area = "", prev = -2, segStart = null;
    const closeArea = (lastI) => { if (segStart != null) area += `L${x(lastI).toFixed(1)},${H}L${x(segStart).toFixed(1)},${H}Z`; };
    for (const [i, v] of pts) {
      const p = `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      if (i !== prev + 1) { closeArea(prev); d += `M${p}`; area += `M${p}`; segStart = i; }
      else { d += `L${p}`; area += `L${p}`; }
      prev = i;
    }
    closeArea(prev);

    const dir = item.change_pct == null ? "flat" : item.change_pct < -0.5 ? "down" : item.change_pct > 0.5 ? "up" : "flat";
    const stroke = { down: "#6BB3F0", up: "#EE8D52", flat: "#9AA3AE" }[dir];
    const fill = { down: "rgba(107,179,240,0.12)", up: "rgba(238,141,82,0.10)", flat: "rgba(154,163,174,0.10)" }[dir];
    const label = `${item.name}, ${pts.length} days of prices` +
      (item.avg30 != null ? `, 30-day average ${plat(item.avg30)}` : "");

    const s = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": label });
    s.style.height = `${H}px`;
    s.appendChild(svg("path", { d: area, fill }));
    if (item.avg30 != null) {
      const ay = y(item.avg30).toFixed(1);
      s.appendChild(svg("line", { x1: 0, x2: W, y1: ay, y2: ay, stroke: "#4A535E", "stroke-width": 1, "stroke-dasharray": "4 4", "vector-effect": "non-scaling-stroke" }));
    }
    s.appendChild(svg("path", { d, fill: "none", stroke, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    return { svg: s, x, y, W, H };
  }

  // ---- cards

  function pickReason(item) {
    const vsAvg = `${signed(item.change_pct, 0)} vs 30-day avg`;
    if (view.group === "buy") {
      const low = item.sell <= item.low ? "Lowest price in 90 days"
        : `Near its 90-day low (${plat(item.low)} on ${fmtIso(item.low_date)})`;
      return `${low} · ${vsAvg}`;
    }
    return `${vsAvg} · 7-day avg ${plat(item.avg7)}`;
  }

  function vaultChip(item) {
    if (item.vaulted === true) {
      const c = el("span", "chip vaulted", "Vaulted");
      c.title = "Relics no longer drop: only available by trading (or Prime Resurgence)";
      return c;
    }
    if (item.vaulted === false) {
      const c = el("span", "chip farmable", "Farmable");
      c.title = "Relics currently drop, so this can be farmed";
      return c;
    }
    const c = el("span", "chip unknown", "Vault status unknown");
    c.title = "Not in the WFCD dataset yet (usually a very new release)";
    return c;
  }

  function card(item) {
    const c = el("article", "card");
    if (item.change_pct != null && item.change_pct < -4) c.classList.add("deal");
    if (owned[item.slug]) c.classList.add("mine");

    const head = el("div", "card-head");
    const title = el("div", "card-title");
    const sub = `${SINGULAR[item.group] || ""} ${item.kind === "part" ? "part" : "set"}` +
      (item.ducats ? ` · ${item.ducats} ducats` : "");
    // The name link stretches over the whole card (see .card-link::after), so
    // the card stays clickable while the owned buttons sit above it.
    const link = el("a", "card-link", shortName(item.name));
    link.href = `https://warframe.market/items/${encodeURIComponent(item.slug)}`;
    link.target = "_blank";
    link.rel = "noopener";
    const name = el("h2", "card-name");
    name.appendChild(link);
    const tags = el("div", "card-tags");
    tags.appendChild(vaultChip(item));
    title.append(el("div", "card-sub", sub.trim()), name, tags);
    head.appendChild(title);
    let badge;
    if (item.change_pct == null) badge = el("span", "badge", "New");
    else {
      const p = item.change_pct;
      badge = el("span", `badge ${p < -0.5 ? "down" : p > 0.5 ? "up" : ""}`.trim(), signed(p));
      badge.title = "Lowest sell vs 30-day average";
    }
    const side = el("div", "card-side");
    side.append(badge, cardMarks(item, c));
    head.appendChild(side);

    const price = el("div", "price");
    price.appendChild(el("span", "price-num", item.sell == null ? "–" : String(Math.round(item.sell))));
    price.appendChild(el("span", "price-label", item.sell == null ? "no sellers right now" : "plat lowest sell"));

    const stats = el("div", "stats");
    for (const [label, value] of [["30d avg", plat(item.avg30)], ["7d avg", plat(item.avg7)], ["Top buy", plat(item.buy)]]) {
      const d = el("div", null, label);
      d.appendChild(el("b", null, value));
      stats.appendChild(d);
    }

    if (isHit(item)) c.classList.add("hit");
    c.append(head, price, chartBox(item), stats);
    const wl = watchLine(item);
    if (wl) c.appendChild(wl);
    if (isPicks() && !search.value.trim()) c.appendChild(el("div", `reason ${view.group}`, pickReason(item)));
    // Only shown once there's something to adjust: how many you own, or your target.
    const actions = el("div", "card-actions");
    if (owned[item.slug]) actions.appendChild(ownControl(item));
    if (isWatched(item.slug)) actions.appendChild(targetInput(item));
    if (actions.childNodes.length) c.appendChild(actions);
    return c;
  }

  // ---- rows (default layout): one dense line per item, like a market screener

  const STAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>';
  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path class="tick" d="M5 8.2l2.1 2.1L11 6"/></svg>';

  // In My items the lists change when you toggle, so redraw; elsewhere just swap the control.
  const inMine = () => MINE.has(view.group) && !search.value.trim();

  function iconToggle(cls, icon, on, labelOn, labelOff, onClick) {
    const b = el("button", `mark ${cls}`);
    b.type = "button";
    b.innerHTML = icon;
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? labelOn : labelOff);
    b.title = on ? labelOn : labelOff;
    b.addEventListener("click", onClick);
    return b;
  }

  function rowMarks(item, tr) {
    if (view.group === "owned" && !search.value.trim()) {
      // In the Owned view the first column is a quantity stepper.
      const box = ownControl(item);
      box.classList.add("own-compact");
      return box;
    }
    const box = el("div", "marks");
    const redraw = () => { if (inMine()) render(); else box.replaceWith(rowMarks(item, tr)); };
    const q = owned[item.slug] || 0;
    box.append(
      iconToggle("star", STAR, isWatched(item.slug), `Stop tracking ${item.name}`, `Track ${item.name}`,
        () => { toggleWatch(item); redraw(); }),
      iconToggle("check", CHECK, !!q, `Remove ${item.name} from owned (×${q})`, `Mark ${item.name} as owned`,
        () => { setQty(item.slug, q ? 0 : 1); tr.classList.toggle("mine", !q); redraw(); }),
    );
    return box;
  }

  // Same two icons as the rows, in the card's top-right corner. Toggling redraws
  // the card so its stepper / target box appear or go away.
  function cardMarks(item, c) {
    const box = el("div", "marks");
    const redraw = () => { if (inMine()) render(); else c.replaceWith(card(item)); };
    const q = owned[item.slug] || 0;
    box.append(
      iconToggle("star", STAR, isWatched(item.slug), `Stop tracking ${item.name}`, `Track ${item.name}`,
        () => { toggleWatch(item); redraw(); }),
      iconToggle("check", CHECK, !!q, `Remove ${item.name} from owned (×${q})`, `Mark ${item.name} as owned`,
        () => { setQty(item.slug, q ? 0 : 1); redraw(); }),
    );
    return box;
  }

  function vaultTag(item) {
    const v = item.vaulted;
    const t = el("span", `vault ${v === true ? "is-vaulted" : v === false ? "is-farmable" : "is-unknown"}`,
      v === true ? "Vaulted" : v === false ? "Farmable" : "Vault ?");
    t.title = vaultChip(item).title;
    return t;
  }

  function rowsTable(list) {
    const showReason = isPicks() && !search.value.trim();
    const t = el("table", "tbl");
    const head = el("thead");
    const hr = el("tr");
    const watchView = view.group === "watch" && !search.value.trim();
    const cols = [["Watch / owned", "c-own"], ["Item", "c-item"], ["Lowest sell", "c-num"]];
    if (watchView) cols.push(["Target", "c-target"]);
    cols.push(["vs 30d", "c-num c-chg"], ["30d avg", "c-num c-avg"], ["Top buy", "c-num c-buy"], ["Last 90 days", "c-spark"], ["Ducats", "c-num c-duc"]);
    for (const [label, cls] of cols) {
      const th = el("th", cls, label);
      th.scope = "col";
      if (cls === "c-own") th.innerHTML = `<span class="sr-only">${label}</span>`;
      hr.appendChild(th);
    }
    head.appendChild(hr);
    const body = el("tbody");
    for (const item of list) {
      const tr = el("tr");
      if (owned[item.slug]) tr.classList.add("mine");
      if (isHit(item)) tr.classList.add("hit");
      const link = el("a", "row-link", shortName(item.name));
      link.href = `https://warframe.market/items/${encodeURIComponent(item.slug)}`;
      link.target = "_blank";
      link.rel = "noopener";
      const sub = el("div", "row-sub");
      sub.append(el("span", null, `${SINGULAR[item.group] || ""} ${item.kind === "part" ? "part" : "set"}`), vaultTag(item));
      const nameCell = el("td", "c-item");
      nameCell.append(link, sub);
      if (showReason) nameCell.appendChild(el("div", `row-reason ${view.group}`, pickReason(item)));
      const wl = watchLine(item);
      if (wl) nameCell.appendChild(wl);

      const chg = el("td", "c-num c-chg");
      if (item.change_pct == null) chg.appendChild(el("span", "chg", "new"));
      else {
        const p = item.change_pct;
        chg.appendChild(el("span", `chg ${p < -0.5 ? "down" : p > 0.5 ? "up" : ""}`.trim(), signed(p)));
      }
      const spark = el("td", "c-spark");
      const pts = item.spark.map((v, i) => [i, v]).filter(([, v]) => v != null);
      if (pts.length >= 2) {
        const s = sparkline(item, pts, 28).svg;
        s.classList.add("mini");
        spark.appendChild(s);
      } else spark.appendChild(el("span", "dim", "collecting"));

      const ownCell = el("td", "c-own");
      ownCell.appendChild(rowMarks(item, tr));
      const sellCell = el("td", "c-num c-sell");
      sellCell.append(el("b", null, item.sell == null ? "–" : String(Math.round(item.sell))), el("span", "unit", item.sell == null ? "" : "p"));
      tr.append(ownCell, nameCell, sellCell);
      if (watchView) {
        const tc = el("td", "c-target");
        tc.appendChild(targetInput(item));
        tr.appendChild(tc);
      }
      tr.append(chg, el("td", "c-num c-avg", plat(item.avg30)), el("td", "c-num c-buy", plat(item.buy)), spark,
        el("td", "c-num c-duc", item.ducats ? String(item.ducats) : "–"));
      // The whole row opens the item; buttons and inputs inside keep their own behaviour.
      tr.addEventListener("click", (e) => { if (!e.target.closest("button, a, input, label")) link.click(); });
      body.appendChild(tr);
    }
    t.append(head, body);
    return t;
  }

  // ---- owned summary

  // Daily total value of everything owned. A missing day reuses the item's last
  // known price (or its first one, before it has any), so gaps in one item's
  // history don't show up as dips in the total.
  function dailyTotals(items) {
    const n = items[0].spark.length;
    const totals = new Array(n).fill(0);
    let any = false;
    for (const item of items) {
      const vals = item.spark;
      const first = vals.findIndex((v) => v != null);
      if (first < 0) continue;
      any = true;
      let lastSeen = vals[first];
      for (let i = 0; i < n; i++) {
        if (vals[i] != null) lastSeen = vals[i];
        totals[i] += owned[item.slug] * (i < first ? vals[first] : lastSeen);
      }
    }
    return any ? totals : null;
  }

  function stat(label, value, note, cls) {
    const d = el("div", `pf-stat ${cls || ""}`.trim());
    d.append(el("span", "pf-label", label), el("span", "pf-value", value));
    if (note) d.appendChild(el("span", "pf-note", note));
    return d;
  }

  function renderPortfolio(items) {
    if (!items.length) {
      const empty = el("div", "pf-empty");
      empty.append(el("p", "pf-empty-title", "Nothing owned yet"),
        el("p", null, "Tick the box next to any item (or “+ Mark as owned” on a card) to track what your inventory is worth over time. Your list stays in this browser; Export above makes a backup you can Import elsewhere."));
      portfolioEl.replaceChildren(empty);
      return;
    }

    let sell = 0, buy = 0, ducats = 0, pieces = 0, unpriced = 0;
    for (const s of items) {
      const q = owned[s.slug];
      pieces += q;
      if (s.sell != null) sell += q * s.sell; else unpriced += q;
      if (s.buy != null) buy += q * s.buy;
      if (s.ducats) ducats += q * s.ducats;
    }
    const totals = dailyTotals(items);
    let change = null, avg30 = null;
    if (totals) {
      const recent = totals.slice(-30);
      avg30 = recent.reduce((a, b) => a + b, 0) / recent.length;
      const monthAgo = totals[Math.max(0, totals.length - 31)];
      change = monthAgo ? ((totals[totals.length - 1] - monthAgo) / monthAgo) * 100 : null;
    }

    const stats = el("div", "pf-stats");
    stats.append(
      stat("Value at lowest sell", `${whole(sell)}p`,
        change == null ? null : `${signed(change)} vs 30 days ago`, change == null ? "" : change < 0 ? "down" : "up"),
      stat("Sell instantly to top buyers", `${whole(buy)}p`, "highest buy order for each"),
      stat("Ducat value", whole(ducats), "at Baro's ducat kiosks"),
      stat("Items", whole(pieces), `${items.length} different${unpriced ? ` · ${unpriced} without a price now` : ""}`),
    );

    const chartWrap = el("div", "pf-chart");
    chartWrap.appendChild(el("p", "pf-label", "Total value over time"));
    if (totals) {
      const pseudo = { name: "Your owned items", spark: totals, avg30, change_pct: avg30 ? ((totals[totals.length - 1] - avg30) / avg30) * 100 : null };
      chartWrap.appendChild(chartBox(pseudo, { height: 96, format: (v) => `${whole(v)}p` }));
    } else chartWrap.appendChild(el("div", "chart-empty", "No price history for these items yet"));

    const top = el("div", "pf-top");
    top.append(stats);
    portfolioEl.replaceChildren(top, chartWrap);
  }

  // ---- views

  const sorters = {
    drop: (a, b) => (a.change_pct ?? Infinity) - (b.change_pct ?? Infinity),
    rise: (a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name),
    "price-low": (a, b) => (a.sell ?? Infinity) - (b.sell ?? Infinity),
    "price-high": (a, b) => (b.sell ?? -Infinity) - (a.sell ?? -Infinity),
  };

  // Tracking: targets hit first (furthest under target on top), then closest to
  // their target, then items tracked without a target, by name.
  function watchOrder(a, b) {
    const A = targetState(a), B = targetState(b);
    const rank = (st) => (!st ? 2 : st.hit ? 0 : 1);
    return rank(A) - rank(B) || (A && B ? A.pct - B.pct : 0) || a.name.localeCompare(b.name);
  }

  // Searching looks across every category; otherwise the tabs pick what to show.
  // The buy/sell lists keep their own ranking order.
  function render() {
    const q = search.value.trim().toLowerCase();
    const kindOk = (s) => view.kind === "all" || s.kind === view.kind;
    const sorter = sorters[sortSel.value] || sorters.name;
    let list;
    if (q) list = sets.filter((s) => s.name.toLowerCase().includes(q)).sort(sorter);
    else if (isPicks()) {
      list = picks[view.group].map((slug) => bySlug.get(slug)).filter((s) => s && kindOk(s));
    } else if (view.group === "owned") list = sets.filter((s) => owned[s.slug] && kindOk(s)).sort(sorter);
    else if (view.group === "watch") list = sets.filter((s) => isWatched(s.slug) && kindOk(s)).sort(watchOrder);
    else list = sets.filter((s) => s.group === view.group && kindOk(s)).sort(sorter);

    const showOwned = view.group === "owned" && !q;
    portfolioEl.hidden = !showOwned;
    if (showOwned) renderPortfolio(sets.filter((s) => owned[s.slug]));
    mineBar.hidden = !(MINE.has(view.group) && !q);
    document.getElementById("export-btn").disabled = !Object.keys(owned).length && !Object.keys(watch).length;
    const fixedOrder = (isPicks() || view.group === "watch") && !q;
    sortSel.disabled = fixedOrder;
    sortSel.title = fixedOrder ? "This list has its own order" : "";
    const note = q ? "" : view.group === "watch" ? WATCH_NOTE : PICK_NOTES[view.group] || "";
    pickNote.hidden = !note;
    pickNote.textContent = note;
    for (const [tabs, key] of [[groupTabs, "group"], [kindTabs, "kind"], [pickBtns, "group"], [mineTabs, "group"]]) {
      tabs.classList.toggle("off", !!q);
      for (const b of tabs.querySelectorAll("button")) {
        const on = b.dataset[key] === view[key] || (b.dataset.group === "mine" && MINE.has(view.group));
        b.setAttribute("aria-pressed", String(on));
      }
    }
    heading.textContent = q ? "Search results" : MINE.has(view.group) ? "My items" : GROUPS[view.group];
    count.textContent = q ? `${list.length} matches in all categories` : `${list.length} ${KINDS[view.kind]}`;
    const none = q ? "Nothing matches your search."
      : isPicks() ? "Nothing stands out right now. Check back after the next hourly update."
      : view.group === "owned" ? (Object.keys(owned).length ? "None of your owned items match this filter." : "")
      : view.group === "watch" ? (Object.keys(watch).length ? "None of your tracked items match this filter."
        : "Nothing tracked yet. Click the star next to any item to add it here.")
      : "Nothing here yet.";
    for (const b of layoutBtns.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.layout === layout));
    grid.classList.toggle("is-rows", layout === "rows");
    const content = !list.length ? (none ? [el("p", "empty", none)] : [])
      : layout === "rows" ? [rowsTable(list)] : list.map(card);
    grid.replaceChildren(...content);
  }

  function readHash() {
    const [group, kind] = location.hash.slice(1).split("/");
    if (GROUPS[group]) view.group = group;
    if (MINE.has(view.group)) mineTab = view.group;
    if (KINDS[kind]) view.kind = kind;
  }

  function pick(key, value) {
    if (key === "group" && value === "mine") value = mineTab;
    if (key === "group" && MINE.has(value)) mineTab = value;
    if (key === "group" && LISTS.has(value) && !LISTS.has(view.group)) view.kind = "all";
    view[key] = value;
    search.value = "";
    history.replaceState(null, "", `#${view.group}/${view.kind}`);
    render();
  }

  async function load() {
    try {
      const res = await fetch(`data/latest.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      sets = (data.sets || []).map((s) => ({ group: "warframe", kind: "set", ...s })); // pre-0.2 data had sets only
      picks = { buy: data.buy || [], sell: data.sell || [] };
      bySlug = new Map(sets.map((s) => [s.slug, s]));
      updateMineCount();
      sparkStart = new Date(`${data.spark_start}T00:00:00Z`).getTime();
      document.getElementById("version").textContent = `Version ${data.version}`;
      const platform = data.platform.toUpperCase();
      meta.textContent = data.snapshot ? `${platform} · updated ${ago(data.snapshot)}` : `${platform} · no snapshot yet`;
      if (data.snapshot) meta.title = new Date(data.snapshot).toLocaleString();
      const hoursOld = data.snapshot ? (Date.now() - new Date(data.snapshot).getTime()) / 3.6e6 : null;
      if (hoursOld != null && hoursOld > STALE_HOURS) {
        notice.textContent = `The last price check was ${ago(data.snapshot)}. The hourly job may be delayed or failing; check the Actions tab on GitHub.`;
        notice.hidden = false;
      }
      render();
    } catch (err) {
      grid.replaceChildren(el("p", "empty", "Couldn't load prices yet. If the tracker was just set up, wait for the first hourly run."));
      meta.textContent = "no data";
      console.error(err);
    }
  }

  groupTabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick("group", b.dataset.group); });
  pickBtns.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick("group", b.dataset.group); });
  kindTabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick("kind", b.dataset.kind); });
  mineTabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick("group", b.dataset.group); });
  document.getElementById("export-btn").addEventListener("click", exportMine);
  document.getElementById("import-btn").addEventListener("click", importMine);
  layoutBtns.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    layout = b.dataset.layout;
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* storage blocked */ }
    render();
  });
  sortSel.addEventListener("change", render);
  search.addEventListener("input", render);
  updateMineCount();
  readHash();
  load();
})();
