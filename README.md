# LLM Crawler Lab

Controlled tests of how search engines and AI assistants crawl, render, follow redirects and find pages. The test pages are public at **https://christopher-kelly.co.uk/lab/**. The results dashboard is private, at `/admin` on this Worker's workers.dev URL.

## Tests

| Test | Question | Pages | Prompt |
|---|---|---|---|
| 1. JS rendering | Which engines see content that only exists after JavaScript runs? | `/lab/t1/render/` shows four codes: plain HTML, JS on load, JS after 2.5s, and JS that fetches `data.json` | Engine is given the URL and asked to list every code |
| 2. Redirect following | Do engines follow 301, 302, JavaScript and meta refresh redirects? | `/lab/t2/s301/`, `s302/`, `sjs/`, `smeta/` lead to `d301/`, `d302/`, `djs/`, `dmeta/`. JS and meta sources carry their own code too | Engine is given the source URL and asked for the code on the page it lands on |
| 4. Index dependency | Which index does each engine rely on? | `/lab/t4/a/` noindex for Bingbot only; `/lab/t4/b/` noindex for Googlebot only; `/lab/t4/c/` control | Engine is asked about the page's invented topic, with no URL |

Every page says it is part of an experiment and that its names and codes are fictional. Content is identical for every visitor: no user-agent conditions.

## How it works

- **Worker** `llm-crawler-lab` serves the pages and logs every request to D1 (`hits`): path, status, user agent, bot classification, Cloudflare verified-bot category, ASN and network.
- **Main site** `christopher-kelly-site` passes `/lab/*` to this Worker through a service binding (`LAB`), so the pages sit on the real domain.
- **Canaries** (codes and invented terms) are generated once by `/admin/init` and stored only in D1, never in this repo, so the only place an engine can learn them is the lab pages.
- **Runner**: a daily cron (06:23 UTC) queues every prompt × engine × `REPEATS`. A cron every 10 minutes works through `BATCH_SIZE` jobs at a time and stores each answer, the search queries, fetched URLs, sources, citations, which codes were found and an outcome label in `runs`.
- **Engines**: OpenAI Responses API with `web_search`; Gemini with `url_context` and `google_search`; Perplexity Sonar; Claude with `web_search` and `web_fetch`. Only the engines in `ENABLED_ENGINES` run (currently `openai,gemini`; Perplexity and Claude are off to keep costs down). Models are set in `wrangler.jsonc` vars.

## Setup

1. Deploy (Workers Builds from this repo; D1 is provisioned automatically from `wrangler.jsonc`).
2. Add secrets in the Worker's Settings → Variables and secrets: `ADMIN_TOKEN` (any long random string), `OPENAI_API_KEY`, `GEMINI_API_KEY`. To switch Perplexity or Claude on, add it to `ENABLED_ENGINES` and add `PERPLEXITY_API_KEY` or `ANTHROPIC_API_KEY` (Claude's web search must also be enabled for the organisation in the Anthropic Console). An engine without a key is skipped.
3. Open `https://llm-crawler-lab.<subdomain>.workers.dev/admin?token=ADMIN_TOKEN` and press **Initialise lab**.
4. Submit `https://christopher-kelly.co.uk/lab/sitemap.xml` in Search Console and Bing Webmaster Tools, then press **Ping IndexNow**.

## Costs

Every run stores the token and search-call counts the API returns and an estimated cost, priced with the `*_PRICE_*` and `*_SEARCH_PER_1K` Worker variables. The dashboard shows spend today, over 7 and 30 days, per run and projected per month. `MAX_DAILY_USD` (default $1.00) stops runs for the rest of the UTC day once the estimate reaches it; parked jobs show as `capped`. The provider billing pages remain the real figures.

## Reading results

- Test 1: compare the HTML code rate with the JS code rates per engine. HTML seen but JS missing means no rendering.
- Test 2: "followed" means the destination code came back; "read source only" means the engine read the JS or meta page without running the redirect.
- Test 4: expect nothing until the pages are indexed (days to weeks). Then compare A (only Google may index) with B (only Bing may index) for each engine. Check Search Console and Bing Webmaster Tools that the noindex rules took effect as intended.
- Cross-check outcomes against the `hits` log: an engine that "found" a page should usually have a matching bot fetch, unless it answered from an index cache.

Answers vary run to run, so read rates across many runs, not single answers. Log model versions with every run (stored in `runs.model`).

## Local development

```bash
npm install
echo 'ADMIN_TOKEN=localtest' > .dev.vars
npx wrangler dev --local
# then POST http://localhost:8787/admin/init?token=localtest
```
