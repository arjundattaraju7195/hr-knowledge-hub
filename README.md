# HR Knowledge Hub

Static site (no build step). Content lives in `content/topics.json`.

- Run locally: `python -m http.server 8123` then open http://localhost:8123
- Add a topic: add an entry under `topics`, and its id to a category's `topics` list.
- Nightly bot: `scripts/nightly-update.mjs`, run by `.github/workflows/nightly-update.yml`.
  Needs the GitHub secret `ANTHROPIC_API_KEY`.
- Test the bot without writing: `ANTHROPIC_API_KEY=... node scripts/nightly-update.mjs hra --dry`
