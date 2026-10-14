// Prime Price Tracker (beta): renders data/latest.json as a wall of cards.
(() => {
  "use strict";

  const STALE_HOURS = 3;
  const SVG = "http://www.w3.org/2000/svg";
  const grid = document.getElementById("grid");
  const meta = document.getElementById("meta");
  const notice = document.getElementById("notice");
  const sortSel = document.getElementById("sort");
  const search = document.getElementById("search");
  const groupTabs = document.getElementById("groups");
  const kindTabs = document.getElementById("kinds");
  const heading = document.getElementById("heading");
  const count = document.getElementById("count");
  const GROUPS = { warframe: "Warframes", primary: "Primary weapons", secondary: "Secondary weapons", melee: "Melee weapons" };
  const SINGULAR = { warframe: "Warframe", primary: "Primary", secondary: "Secondary", melee: "Melee" };
  const KINDS = { set: "sets", part: "parts", all: "sets and parts" };
  let sets = [];
  let view = { group: "warframe", kind: "set" };

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
  const shortName = (name) => name.replace(/ Set$/, "");

  function ago(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }

  function sparkline(item) {
    const pts = item.spark.map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (pts.length < 2) {
      const since = item.tracked_since ? ` since ${item.tracked_since}` : "";
      return el("div", "chart-empty", `Collecting history${since}`);
    }
    const W = 240, H = 64, n = item.spark.length - 1;
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
    const stroke = { down: "#62A8E8", up: "#F08A4B", flat: "#9AA3AE" }[dir];
    const fill = { down: "rgba(98,168,232,0.14)", up: "rgba(240,138,75,0.12)", flat: "rgba(154,163,174,0.10)" }[dir];
    const label = `${item.name}, ${pts.length} days of prices` +
      (item.avg30 != null ? `, 30-day average ${plat(item.avg30)}` : "");

    const s = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": label });
    s.appendChild(svg("path", { d: area, fill }));
    if (item.avg30 != null) {
      const ay = y(item.avg30).toFixed(1);
      s.appendChild(svg("line", { x1: 0, x2: W, y1: ay, y2: ay, stroke: "#4A535E", "stroke-width": 1, "stroke-dasharray": "4 4", "vector-effect": "non-scaling-stroke" }));
    }
    s.appendChild(svg("path", { d, fill: "none", stroke, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    return s;
  }

  function card(item) {
    const a = el("a", "card");
    a.href = `https://warframe.market/items/${encodeURIComponent(item.slug)}`;
    a.target = "_blank";
    a.rel = "noopener";
    if (item.change_pct != null && item.change_pct < -4) a.classList.add("deal");

    const head = el("div", "card-head");
    const title = el("div", "card-title");
    const sub = `${SINGULAR[item.group] || ""} ${item.kind === "part" ? "part" : "set"}` +
      (item.ducats ? ` · ${item.ducats} ducats` : "");
    title.append(el("div", "card-sub", sub.trim()), el("div", "card-name", shortName(item.name)));
    head.appendChild(title);
    let badge;
    if (item.change_pct == null) badge = el("span", "badge", "New");
    else {
      const p = item.change_pct;
      const dir = p < -0.5 ? "down" : p > 0.5 ? "up" : "";
      badge = el("span", `badge ${dir}`.trim(), `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`);
      badge.title = "Lowest sell vs 30-day average";
    }
    head.appendChild(badge);

    const price = el("div", "price");
    price.appendChild(el("span", "price-num", item.sell == null ? "–" : String(Math.round(item.sell))));
    price.appendChild(el("span", "price-label", item.sell == null ? "no sellers right now" : "plat lowest sell"));

    const stats = el("div", "stats");
    for (const [label, value] of [["30d avg", plat(item.avg30)], ["7d avg", plat(item.avg7)], ["Top buy", plat(item.buy)]]) {
      const d = el("div", null, label);
      d.appendChild(el("b", null, value));
      stats.appendChild(d);
    }

    a.append(head, price, sparkline(item), stats);
    return a;
  }

  const sorters = {
    drop: (a, b) => (a.change_pct ?? Infinity) - (b.change_pct ?? Infinity),
    rise: (a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name),
    "price-low": (a, b) => (a.sell ?? Infinity) - (b.sell ?? Infinity),
    "price-high": (a, b) => (b.sell ?? -Infinity) - (a.sell ?? -Infinity),
  };

  // Searching looks across every category; otherwise the tabs pick what to show.
  function render() {
    const q = search.value.trim().toLowerCase();
    const list = sets
      .filter((s) => (q ? s.name.toLowerCase().includes(q)
        : s.group === view.group && (view.kind === "all" || s.kind === view.kind)))
      .sort(sorters[sortSel.value] || sorters.name);
    for (const [tabs, key] of [[groupTabs, "group"], [kindTabs, "kind"]]) {
      tabs.classList.toggle("off", !!q);
      for (const b of tabs.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset[key] === view[key]));
    }
    heading.textContent = q ? "Search results" : GROUPS[view.group];
    count.textContent = q ? `${list.length} matches in all categories` : `${list.length} ${KINDS[view.kind]}`;
    grid.replaceChildren(...(list.length ? list.map(card) : [el("p", "empty", "Nothing matches your search.")]));
  }

  function readHash() {
    const [group, kind] = location.hash.slice(1).split("/");
    if (GROUPS[group]) view.group = group;
    if (KINDS[kind]) view.kind = kind;
  }

  function pick(key, value) {
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
      document.getElementById("version").textContent = `v${data.version}`;
      meta.textContent = data.snapshot
        ? `warframe.market · ${data.platform.toUpperCase()} · updated ${ago(data.snapshot)}`
        : `warframe.market · ${data.platform.toUpperCase()} · no snapshot yet`;
      if (data.snapshot) meta.title = new Date(data.snapshot).toLocaleString();
      const hoursOld = data.snapshot ? (Date.now() - new Date(data.snapshot).getTime()) / 3.6e6 : null;
      if (hoursOld != null && hoursOld > STALE_HOURS) {
        notice.textContent = `The last price check was ${ago(data.snapshot)}. The hourly job may be delayed or failing; check the Actions tab on GitHub.`;
        notice.hidden = false;
      }
      render();
    } catch (err) {
      grid.replaceChildren(el("p", "empty", "Couldn't load prices yet. If the tracker was just set up, wait for the first hourly run."));
      meta.textContent = "warframe.market · no data";
      console.error(err);
    }
  }

  groupTabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick("group", b.dataset.group); });
  kindTabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick("kind", b.dataset.kind); });
  sortSel.addEventListener("change", render);
  search.addEventListener("input", render);
  readHash();
  load();
})();
