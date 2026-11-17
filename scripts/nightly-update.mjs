// Nightly bot: for each topic, asks Claude (with live web search) whether the law has changed
// since the page was written. If yes, it rewrites ONLY the affected fields and logs the change.
// Run locally:  ANTHROPIC_API_KEY=... node scripts/nightly-update.mjs [topicId] [--dry]
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "topics.json");
const MODEL = process.env.BOT_MODEL || "claude-sonnet-5-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ONLY = args.find(a => !a.startsWith("--"));
const today = new Date().toISOString().slice(0, 10);

if (!API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }

// Fields the bot may change. Anything else it returns is ignored.
const EDITABLE = ["whatIsIt", "benefit", "whoCanClaim", "howCalculated", "clauses", "latestUpdate",
  "metroCities", "example", "documents", "watchOut", "sources"];

const SYSTEM = `You are a fact-checker for an Indian HR / payroll tax knowledge app. Today is ${today}.
You receive one topic page as JSON. Use web search to check whether anything on it is now outdated or wrong
because of a NEW law, rule, notification, circular or Finance Act change (India). Prefer official sources:
incometaxindia.gov.in, egazette.gov.in, indiabudget.gov.in, pib.gov.in, cbic/cbdt notifications.
Reputable tax publications may confirm, but a change must not rest on one blog alone.

Rules:
- Do NOT change anything for wording, style or opinion. Only for real factual/legal changes.
- If unsure or sources conflict, set "changed": false and describe the doubt in "note".
- Keep language plain and simple, as the existing page does. Keep all rupee figures and the worked example consistent.
- If a change applies from a FUTURE date, update latestUpdate with that effectiveDate and say it is upcoming.
- If the status of a previously uncertain item has been confirmed (or disproved), update latestUpdate.status.
Reply with ONLY one JSON object, no prose, no code fence:
{"changed": boolean, "note": "one sentence for the change log", "fields": { <only the changed top-level fields, full replacement values> }, "sources": [{"title": "...", "url": "https://..."}]}`;

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000, system: SYSTEM, messages,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }]
    })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

async function checkTopic(topic) {
  const { changelog, lastVerified, lastChanged, ...page } = topic;
  const messages = [{ role: "user", content: "Check this page for outdated information:\n" + JSON.stringify(page) }];
  let resp;
  for (let i = 0; i < 4; i++) {                     // continue if the server paused a long search turn
    resp = await callClaude(messages);
    if (resp.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: resp.content });
  }
  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

const data = JSON.parse(await readFile(FILE, "utf8"));
let anyChange = false;
const failures = [];

for (const [id, topic] of Object.entries(data.topics)) {
  if (ONLY && ONLY !== id) continue;
  process.stdout.write(`Checking ${id} ... `);
  try {
    const r = await checkTopic(topic);
    topic.lastVerified = today;
    const good = r.changed && r.fields && Array.isArray(r.sources) && r.sources.length > 0
      && r.sources.every(s => /^https:\/\//.test(s.url || ""));
    if (r.changed && !good) { console.log("model proposed a change without valid sources; ignored."); continue; }
    if (!r.changed) { console.log("no change. " + (r.note || "")); continue; }

    const applied = Object.keys(r.fields).filter(k => EDITABLE.includes(k));
    if (!applied.length) { console.log("no editable fields; ignored."); continue; }
    for (const k of applied) topic[k] = r.fields[k];
    // keep a trail of what backed the change
    const known = new Set(topic.sources.map(s => s.url));
    for (const s of r.sources) if (!known.has(s.url)) topic.sources.push({ title: s.title, url: s.url });
    topic.lastChanged = today;
    topic.changelog.unshift({ date: today, type: "update", note: r.note, fields: applied });
    anyChange = true;
    console.log("CHANGED: " + r.note);
  } catch (e) {
    failures.push(id);
    console.log("FAILED: " + e.message);
  }
}

if (DRY) console.log("Dry run, nothing written.");
else await writeFile(FILE, JSON.stringify(data, null, 2) + "\n");
console.log(anyChange ? "Result: content updated." : "Result: no content changes.");
if (failures.length) process.exit(1);
