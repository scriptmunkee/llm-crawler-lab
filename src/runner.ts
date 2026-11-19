import { getCanaries } from './canaries';
import { callEngine, ENGINES, estimateCost, hasKey, isEnabled, type EngineName } from './engines';
import { detect, outcome, prompts } from './tests';
import type { Env } from './index';

const now = () => new Date().toISOString();

// Queue every prompt x engine x repeat. Engines without an API key are skipped.
export async function enqueue(env: Env, repeats?: number, only?: EngineName, tests?: string[]): Promise<{ batch: string; queued: number; skipped: string[] }> {
  const c = await getCanaries(env.DB);
  if (!c) throw new Error('Lab not initialised: run /admin/init first');
  const n = repeats ?? Math.max(1, parseInt(env.REPEATS || '3', 10));
  const batch = now();
  const engines = ENGINES.filter((e) => isEnabled(env, e) && hasKey(env, e) && (!only || e === only));
  const skipped = ENGINES.filter((e) => !engines.includes(e));
  const stmts: D1PreparedStatement[] = [];
  for (const p of prompts(c, env.SITE_ORIGIN).filter((x) => !tests || tests.includes(x.test))) {
    for (const e of engines) {
      for (let i = 0; i < n; i++) {
        stmts.push(env.DB.prepare('INSERT INTO jobs (created, batch, prompt_id, engine) VALUES (?, ?, ?, ?)').bind(batch, batch, p.id, e));
      }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { batch, queued: stmts.length, skipped };
}

// Estimated spend so far today (UTC), from stored run costs.
export async function spendToday(env: Env): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare('SELECT COALESCE(SUM(cost_usd), 0) s FROM runs WHERE ts >= ?').bind(day).first<{ s: number }>();
  return row?.s ?? 0;
}

// Work through pending jobs, a few at a time. Called by the frequent cron.
export async function processJobs(env: Env, limit?: number): Promise<number> {
  const cap = parseFloat(env.MAX_DAILY_USD || '0');
  if (cap > 0 && (await spendToday(env)) >= cap) {
    // Over today's budget: park the rest of the queue rather than spending more.
    await env.DB.prepare("UPDATE jobs SET status = 'capped' WHERE status = 'pending'").run();
    return 0;
  }
  const max = limit ?? Math.max(1, parseInt(env.BATCH_SIZE || '6', 10));
  const c = await getCanaries(env.DB);
  if (!c) return 0;
  const defs = new Map(prompts(c, env.SITE_ORIGIN).map((p) => [p.id, p]));

  const { results } = await env.DB.prepare(
    "SELECT id, batch, prompt_id, engine, attempts FROM jobs WHERE status = 'pending' ORDER BY id LIMIT ?",
  ).bind(max).all<{ id: number; batch: string; prompt_id: string; engine: EngineName; attempts: number }>();
  if (!results.length) return 0;

  await env.DB.batch(results.map((j) => env.DB.prepare("UPDATE jobs SET status = 'running', started = ?, attempts = attempts + 1 WHERE id = ?").bind(now(), j.id)));

  await Promise.allSettled(results.map(async (job) => {
    const p = defs.get(job.prompt_id);
    if (!p) {
      await env.DB.prepare("UPDATE jobs SET status = 'dropped' WHERE id = ?").bind(job.id).run();
      return;
    }
    const started = Date.now();
    try {
      const r = await callEngine(env, job.engine, p.text);
      const urls = [...r.citations, ...r.sources, ...r.fetched];
      const d = detect(p, r.answer, urls, r.fetched);
      // Gemini's URL fetcher sometimes fails on its side (URL_RETRIEVAL_STATUS_ERROR) even though
      // the lab served the page; those runs are labelled and left out of the rates.
      const fetchFailed = !d.found.length && /URL_RETRIEVAL_STATUS_ERROR/.test(r.note ?? '') && !/URL_RETRIEVAL_STATUS_SUCCESS/.test(r.note ?? '');
      const label = !r.answer.trim() ? 'blank answer' : fetchFailed ? 'fetch failed' : outcome(p, d);
      await env.DB.prepare(
        `INSERT INTO runs (ts, batch, test_id, prompt_id, engine, model, status, latency_ms, prompt, answer, queries, fetched, sources, citations, detected, outcome, error, input_tokens, output_tokens, search_calls, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        now(), job.batch, p.test, p.id, job.engine, r.model, Date.now() - started, p.text,
        r.answer.slice(0, 8000), JSON.stringify(r.queries), JSON.stringify(r.fetched),
        JSON.stringify(r.sources.slice(0, 50)), JSON.stringify(r.citations.slice(0, 50)),
        JSON.stringify(d), label, r.note ?? null,
        r.usage.input, r.usage.output, r.usage.searches, estimateCost(env, job.engine, r.usage),
      ).run();
      await env.DB.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").bind(job.id).run();
    } catch (err: any) {
      const msg = String(err?.message ?? err).slice(0, 1000);
      const retry = job.attempts + 1 < 3 && /^(429|5\d\d)/.test(msg);
      await env.DB.prepare('UPDATE jobs SET status = ? WHERE id = ?').bind(retry ? 'pending' : 'failed', job.id).run();
      if (!retry) {
        await env.DB.prepare(
          `INSERT INTO runs (ts, batch, test_id, prompt_id, engine, status, latency_ms, prompt, error)
           VALUES (?, ?, ?, ?, ?, 'error', ?, ?, ?)`,
        ).bind(now(), job.batch, p.test, p.id, job.engine, Date.now() - started, p.text, msg).run();
      }
    }
  }));

  // Jobs stuck in 'running' for over an hour (a crashed invocation) go back to the queue.
  await env.DB.prepare(
    "UPDATE jobs SET status = 'pending' WHERE status = 'running' AND attempts < 3 AND started < ?",
  ).bind(new Date(Date.now() - 3600_000).toISOString()).run();

  return results.length;
}

// Test 4 only means something once a search engine has crawled its pages.
export async function t4Ready(env: Env): Promise<boolean> {
  if ((env.T4_GATE ?? 'crawl') !== 'crawl') return true;
  const row = await env.DB.prepare(
    "SELECT MIN(ts) first FROM hits WHERE path LIKE '/lab/t4/%' AND bot IN ('Googlebot', 'Bingbot') AND status = 200",
  ).first<{ first: string | null }>();
  return !!row?.first;
}
