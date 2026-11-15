import { getCanaries } from './canaries';
import { callEngine, ENGINES, hasKey, isEnabled, type EngineName } from './engines';
import { detect, outcome, prompts } from './tests';
import type { Env } from './index';

const now = () => new Date().toISOString();

// Queue every prompt x engine x repeat. Engines without an API key are skipped.
export async function enqueue(env: Env, repeats?: number): Promise<{ batch: string; queued: number; skipped: string[] }> {
  const c = await getCanaries(env.DB);
  if (!c) throw new Error('Lab not initialised: run /admin/init first');
  const n = repeats ?? Math.max(1, parseInt(env.REPEATS || '3', 10));
  const batch = now();
  const engines = ENGINES.filter((e) => isEnabled(env, e) && hasKey(env, e));
  const skipped = ENGINES.filter((e) => !engines.includes(e));
  const stmts: D1PreparedStatement[] = [];
  for (const p of prompts(c, env.SITE_ORIGIN)) {
    for (const e of engines) {
      for (let i = 0; i < n; i++) {
        stmts.push(env.DB.prepare('INSERT INTO jobs (created, batch, prompt_id, engine) VALUES (?, ?, ?, ?)').bind(batch, batch, p.id, e));
      }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { batch, queued: stmts.length, skipped };
}

// Work through pending jobs, a few at a time. Called by the frequent cron.
export async function processJobs(env: Env, limit?: number): Promise<number> {
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
      await env.DB.prepare(
        `INSERT INTO runs (ts, batch, test_id, prompt_id, engine, model, status, latency_ms, prompt, answer, queries, fetched, sources, citations, detected, outcome, error)
         VALUES (?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        now(), job.batch, p.test, p.id, job.engine, r.model, Date.now() - started, p.text,
        r.answer.slice(0, 8000), JSON.stringify(r.queries), JSON.stringify(r.fetched),
        JSON.stringify(r.sources.slice(0, 50)), JSON.stringify(r.citations.slice(0, 50)),
        JSON.stringify(d), outcome(p, d), r.note ?? null,
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
