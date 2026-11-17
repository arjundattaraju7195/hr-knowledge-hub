// Free nightly watcher (no AI, no API key). For each topic it reads Google News RSS feeds for the topic's
// search queries, keeps only headlines that sound like a rule change, and opens ONE GitHub issue per topic
// when there are new ones. GitHub emails the repo owner. You then bring the issue to Claude in chat.
//
// Local test (nothing is written or posted):  node scripts/watch.mjs --dry
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const TOPICS = path.join(ROOT, "topics.json");
const STATE = path.join(ROOT, "watch-state.json");
const DRY = process.argv.includes("--dry");
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;   // "owner/name", set automatically in GitHub Actions

// A headline must contain one of these to count as "possible rule change".
const CHANGE_WORDS = /(notif|amend|\brules\b|budget|cbdt|raise[sd]?|hike[sd]?|increase[sd]?|revis|circular|chang(e|es|ed|ing)\b|scrap|abolish|expand|extend)/i;

const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

async function fetchItems(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:3d")}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (hr-knowledge-watcher)" } });
  if (!res.ok) throw new Error(`News feed ${res.status} for "${query}"`);
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = tag => { const r = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return r ? decode(r[1]) : ""; };
    items.push({ title: pick("title"), link: pick("link"), date: pick("pubDate"), source: pick("source") });
  }
  return items;
}

async function openIssue(title, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({ title, body })
  });
  if (!res.ok) throw new Error(`GitHub issue ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).html_url;
}

const topics = JSON.parse(await readFile(TOPICS, "utf8")).topics;
let state = {};
try { state = JSON.parse(await readFile(STATE, "utf8")); } catch { /* first run */ }
if (!DRY && (!TOKEN || !REPO)) { console.error("GITHUB_TOKEN / GITHUB_REPOSITORY missing."); process.exit(1); }

let failed = false;
for (const [id, topic] of Object.entries(topics)) {
  const queries = topic.watch?.queries || [];
  const firstRun = !state[id];
  const seen = new Set(state[id] || []);
  const fresh = new Map();                         // title -> item, de-duplicated
  try {
    for (const q of queries) {
      for (const it of await fetchItems(q)) {
        if (!it.title || seen.has(it.title)) continue;
        seen.add(it.title);                        // remember everything, relevant or not
        const onTopic = new RegExp(topic.watch.mustMention || ".", "i").test(it.title);
        if (onTopic && CHANGE_WORDS.test(it.title)) fresh.set(it.title, it);
      }
    }
  } catch (e) { failed = true; console.log(`${id}: FAILED ${e.message}`); continue; }

  state[id] = [...seen].slice(-500);               // keep the file small
  if (firstRun) { console.log(`${id}: first run, remembered ${seen.size} headlines, no issue opened.`); continue; }
  if (!fresh.size) { console.log(`${id}: nothing new.`); continue; }

  const lines = [...fresh.values()].map(i => `- [${i.title}](${i.link}) (${i.source}, ${i.date})`);
  const title = `Possible update: ${topic.shortName || topic.title} (${fresh.size} new headline${fresh.size > 1 ? "s" : ""})`;
  const body = `New headlines that may mean the rules changed:\n\n${lines.join("\n")}\n\n` +
    `Next step: bring this issue to Claude in chat. Confirm the change against the official text, then ask Claude to update the page.`;
  if (DRY) console.log(`${id}: WOULD OPEN ISSUE "${title}"\n${lines.join("\n")}`);
  else console.log(`${id}: opened ${await openIssue(title, body)}`);
}

if (!DRY) await writeFile(STATE, JSON.stringify(state, null, 2) + "\n");
if (failed) process.exit(1);
