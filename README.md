# HR Knowledge Hub

Static site (no build step). Content lives in `content/topics.json`.

- Run locally: `python -m http.server 8123` then open http://localhost:8123
- Add a topic: add an entry under `topics`, and its id to a category's `topics` list.
  Give it a `watch` block: `queries` (news searches) and `mustMention` (regex a headline must match).
- Nightly watcher: `scripts/watch.mjs`, run by `.github/workflows/nightly-update.yml`. Free: no AI, no API key.
  It reads Google News feeds and opens a GitHub issue ("Possible update: ...") when new headlines look like a rule change.
  Bring the issue to Claude in chat, confirm against the official text, then update the page.
- Test without posting anything: `node scripts/watch.mjs --dry`
