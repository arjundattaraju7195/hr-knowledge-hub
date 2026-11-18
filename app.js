// Tiny DOM helper: builds elements with textContent only (no innerHTML), so content can never inject markup.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const app = document.getElementById("app");
function render(...nodes) { app.replaceChildren(...nodes.flat().filter(n => n && n !== true)); }
const tabsEl = document.getElementById("tabs");
let DATA = null;

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function renderTabs(active) {
  tabsEl.replaceChildren(
    ...DATA.categories.map(c => h("a", { href: "#/c/" + c.id, class: active === c.id ? "on" : "" }, c.title)),
    h("a", { href: "#/updates", class: active === "updates" ? "on" : "" }, "Recent updates")
  );
}

const DASHBOARD_DAYS = 30;   // an update stays on the dashboard this long

function viewHome() {
  renderTabs(null);
  const cutoff = Date.now() - DASHBOARD_DAYS * 86400000;
  const items = [];
  for (const t of Object.values(DATA.topics))
    for (const c of t.changelog)
      if (c.type === "update" && new Date(c.date + "T00:00:00").getTime() >= cutoff) items.push({ ...c, topic: t });
  items.sort((a, b) => b.date.localeCompare(a.date));

  render(
    h("h1", {}, "Dashboard"),
    items.length
      ? h("div", {}, items.map(i => h("a", { class: "card update", href: "#/t/" + i.topic.id },
          h("strong", {}, (i.topic.shortName || i.topic.title) + " has been updated as of " + fmtDate(i.date) + "."),
          h("div", {}, i.note))))
      : null,
    h("h2", {}, "Browse"),
    ...DATA.categories.map(c => h("a", { class: "card", href: "#/c/" + c.id }, h("h3", {}, c.title), h("div", { class: "muted" }, c.blurb)))
  );
}

function viewCategory(id) {
  const c = DATA.categories.find(x => x.id === id);
  if (!c) return viewHome();
  renderTabs(id);
  render(
    h("h1", {}, c.title),
    h("p", { class: "muted" }, c.blurb),
    ...c.topics.map(t => DATA.topics[t]).filter(Boolean).map(t =>
      h("a", { class: "card", href: "#/t/" + t.id },
        h("h3", {}, t.title), h("div", { class: "muted" }, t.short),
        h("div", { class: "muted" }, "Last checked " + fmtDate(t.lastVerified))))
  );
}

function viewTopic(id) {
  const t = DATA.topics[id];
  if (!t) return viewHome();
  const cat = DATA.categories.find(c => c.topics.includes(id));
  renderTabs(cat && cat.id);
  const u = t.latestUpdate;
  const ex = t.example;

  render(
    h("div", { class: "crumbs" }, h("a", { href: "#/c/" + cat.id }, cat.title), " › ", t.title),
    h("h1", {}, t.title),
    h("p", { class: "muted" }, "Last checked " + fmtDate(t.lastVerified) + " · Last changed " + fmtDate(t.lastChanged)),

    u && h("div", { class: "card update" },
      h("span", { class: "badge" }, "Latest update · from " + fmtDate(u.effectiveDate)),
      h("h3", {}, u.headline),
      h("ul", {}, u.details.map(d => h("li", {}, d))),
      u.status && h("div", { class: "warn" }, u.status)),

    h("h2", {}, "What is it?"), h("p", {}, t.whatIsIt),
    h("h2", {}, "How does it save tax?"), h("p", {}, t.benefit),
    h("h2", {}, "Who can claim?"), h("ul", {}, t.whoCanClaim.map(x => h("li", {}, x))),

    h("h2", {}, t.calcHeading || "How the exempt amount is worked out"),
    h("p", {}, t.howCalculated.intro),
    h("ol", {}, t.howCalculated.steps.map(s => h("li", {}, s))),

    t.table && h("div", {},
      h("h2", {}, t.table.heading),
      h("div", { class: "scroll" },
        h("table", { class: "grid" },
          h("thead", {}, h("tr", {}, t.table.columns.map(c => h("th", {}, c)))),
          h("tbody", {}, t.table.rows.map(r => h("tr", {}, r.map(c => h("td", {}, c)))))))),

    t.metroCities && h("div", {},
      h("h2", {}, "Cities with the 50% limit"),
      h("div", { class: "chips" }, t.metroCities.fifty.map(c => h("span", { class: "chip" }, c))),
      h("p", { class: "muted" }, t.metroCities.note)),

    ex && h("div", {},
      h("h2", {}, "Worked example"),
      h("div", { class: "card" },
        h("p", {}, ex.scenario),
        h("table", {}, ex.rows.map(r => h("tr", {}, h("td", {}, r.label), h("td", {}, r.value)))),
        h("div", { class: "result" }, ex.result),
        h("p", { class: "muted", style: "margin-top:10px" }, ex.compare))),

    h("h2", {}, "Rules and clauses (tap to open)"),
    ...t.clauses.map(c => h("details", { class: "clause" }, h("summary", {}, c.title), h("p", {}, c.text))),

    h("h2", {}, "Documents to keep"), h("ul", {}, t.documents.map(x => h("li", {}, x))),
    h("h2", {}, "Watch out"), h("ul", {}, t.watchOut.map(x => h("li", {}, x))),

    h("h2", {}, "Change history"),
    h("ul", {}, t.changelog.map(c => h("li", {}, h("strong", {}, fmtDate(c.date) + ": "), c.note)))
  );
}

function viewUpdates() {
  renderTabs("updates");
  const all = [];
  for (const t of Object.values(DATA.topics)) for (const c of t.changelog) all.push({ ...c, topic: t });
  all.sort((a, b) => b.date.localeCompare(a.date));
  render(
    h("h1", {}, "Recent updates"),
    h("p", { class: "muted" }, "Every change made by you or the nightly bot, newest first."),
    ...all.map(c => h("a", { class: "card", href: "#/t/" + c.topic.id },
      h("div", { class: "muted" }, fmtDate(c.date) + " · " + c.topic.title), h("div", {}, c.note)))
  );
}

function route() {
  const [, kind, id] = location.hash.split("/");
  if (kind === "c") viewCategory(id);
  else if (kind === "t") viewTopic(id);
  else if (kind === "updates") viewUpdates();
  else viewHome();
  window.scrollTo(0, 0);
}

fetch("content/topics.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(d => { DATA = d; window.addEventListener("hashchange", route); route(); })
  .catch(e => render(h("p", {}, "Could not load content: " + e.message + ". Open this through a web server, not by double-clicking the file.")));
