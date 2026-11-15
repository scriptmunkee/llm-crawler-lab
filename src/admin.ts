import { getCanaries, initCanaries } from './canaries';
import { ENGINES, hasKey, isEnabled } from './engines';
import { LAB_URL_PATHS } from './pages';
import { enqueue, processJobs } from './runner';
import { prompts } from './tests';
import type { Env } from './index';
import SCHEMA from '../schema.sql';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function authed(req: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const url = new URL(req.url);
  const cookie = req.headers.get('cookie') ?? '';
  const fromCookie = /(?:^|;\s*)lab_admin=([^;]+)/.exec(cookie)?.[1];
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const q = url.searchParams.get('token');
  return [fromCookie, bearer, q].some((t) => t && t === env.ADMIN_TOKEN);
}

async function ensureSchema(env: Env) {
  const stmts = SCHEMA.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
  await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
}

export async function handleAdmin(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (!env.ADMIN_TOKEN) return new Response('Set the ADMIN_TOKEN secret first.', { status: 503 });
  if (!authed(req, env)) return new Response('Not authorised. Add ?token=YOUR_ADMIN_TOKEN once.', { status: 401 });

  const headers: Record<string, string> = { 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' };
  const q = url.searchParams.get('token');
  if (q) headers['set-cookie'] = `lab_admin=${q}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`;

  const path = url.pathname.replace(/\/+$/, '') || '/admin';
  const isPost = req.method === 'POST';
  const back = (msg: string) => new Response(null, { status: 303, headers: { ...headers, location: `/admin?msg=${encodeURIComponent(msg)}` } });

  try {
    if (path === '/admin/init' && isPost) {
      await ensureSchema(env);
      const r = await initCanaries(env.DB);
      return back(r.created ? 'Lab initialised: schema ready and canaries created.' : 'Schema checked. Canaries already existed, left unchanged.');
    }
    if (path === '/admin/run' && isPost) {
      const form = await req.formData().catch(() => null);
      const repeats = parseInt(String(form?.get('repeats') ?? '1'), 10) || 1;
      const r = await enqueue(env, repeats);
      return back(`Queued ${r.queued} jobs.${r.skipped.length ? ` Not run (switched off or no key): ${r.skipped.join(', ')}.` : ''}`);
    }
    if (path === '/admin/process' && isPost) {
      const n = await processJobs(env);
      return back(`Processed ${n} jobs.`);
    }
    if (path === '/admin/indexnow' && isPost) {
      const c = await getCanaries(env.DB);
      if (!c) return back('Initialise the lab first.');
      const host = new URL(env.SITE_ORIGIN).host;
      const res = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          host, key: c.indexnowKey,
          keyLocation: `${env.SITE_ORIGIN}/lab/${c.indexnowKey}.txt`,
          urlList: LAB_URL_PATHS.map((p) => env.SITE_ORIGIN + p),
        }),
      });
      return back(`IndexNow responded ${res.status} ${res.statusText}`);
    }
    if (path === '/admin/export.csv') return exportCsv(env, url.searchParams.get('table') ?? 'runs', headers);
    if (path === '/admin') return new Response(await dashboard(env, url.searchParams.get('msg')), { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  } catch (err: any) {
    return new Response(`Error: ${esc(err?.message ?? err)}`, { status: 500, headers });
  }
  return new Response('Not found', { status: 404, headers });
}

async function exportCsv(env: Env, table: string, headers: Record<string, string>): Promise<Response> {
  if (!['runs', 'hits'].includes(table)) return new Response('Unknown table', { status: 400 });
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 20000`).all<Record<string, unknown>>();
  const cols = results.length ? Object.keys(results[0]) : [];
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...results.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  return new Response(csv, { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="lab-${table}.csv"` } });
}

function table(head: string[], rows: (string | number)[][]): string {
  if (!rows.length) return '<p class="muted">No data yet.</p>';
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'number' ? c : c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}% <span class="muted">(${n}/${d})</span>` : '<span class="muted">n/a</span>';
}

async function dashboard(env: Env, msg: string | null): Promise<string> {
  const c = await getCanaries(env.DB).catch(() => null);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  let body = '';

  if (!c) {
    body = `<p>The lab isn't initialised yet. This creates the tables and generates the canary codes (they live only in D1, never in GitHub).</p>
<form method="post" action="/admin/init"><button>Initialise lab</button></form>`;
    return page(body, msg);
  }

  const pending = await env.DB.prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY status").all<{ status: string; n: number }>();
  const engineRows = ENGINES.map((e) => [e, !isEnabled(env, e) ? '⏸ switched off' : hasKey(env, e) ? '✅ key set' : '⚠️ no key', esc(modelFor(env, e))]);

  const runs = await env.DB.prepare('SELECT prompt_id, engine, status, outcome, detected FROM runs WHERE ts > ?').bind(since).all<{ prompt_id: string; engine: string; status: string; outcome: string | null; detected: string | null }>();
  const R = runs.results;
  const ON = ENGINES.filter((e) => isEnabled(env, e));
  const defs = prompts(c, env.SITE_ORIGIN);

  // Test 1: per engine, share of OK runs that saw each code
  const t1Labels = ['html', 'js', 'jsDelayed', 'fetched'];
  const t1Rows = ON.map((e) => {
    const rs = R.filter((r) => r.prompt_id === 't1-render' && r.engine === e && r.status === 'ok');
    const errs = R.filter((r) => r.prompt_id === 't1-render' && r.engine === e && r.status === 'error').length;
    return [e, ...t1Labels.map((l) => pct(rs.filter((r) => (JSON.parse(r.detected || '{}').found ?? []).includes(l)).length, rs.length)), errs];
  });

  // Test 2: per engine and redirect type, outcome distribution
  const t2Ids = ['t2-301', 't2-302', 't2-js', 't2-meta'];
  const t2Rows = ON.map((e) => [e, ...t2Ids.map((id) => {
    const rs = R.filter((r) => r.prompt_id === id && r.engine === e && r.status === 'ok');
    if (!rs.length) return '<span class="muted">n/a</span>';
    const f = rs.filter((r) => r.outcome === 'followed').length;
    const s = rs.filter((r) => r.outcome === 'read source only').length;
    return `followed ${pct(f, rs.length)}<br>source only ${s}<br>no code ${rs.length - f - s}`;
  })]);

  // Test 4: per engine and page arm, found rate
  const t4Ids = ['t4-a', 't4-b', 't4-c'];
  const t4Rows = ON.map((e) => [e, ...t4Ids.map((id) => {
    const rs = R.filter((r) => r.prompt_id === id && r.engine === e && r.status === 'ok');
    return pct(rs.filter((r) => (r.outcome ?? '').startsWith('found')).length, rs.length);
  })]);

  // Bot hits
  const hitsByBot = await env.DB.prepare(
    `SELECT bot, bot_group, COUNT(*) n, MAX(ts) last FROM hits WHERE ts > ? GROUP BY bot, bot_group ORDER BY n DESC`,
  ).bind(since).all<{ bot: string; bot_group: string; n: number; last: string }>();
  const hitsByPath = await env.DB.prepare(
    `SELECT path, bot, COUNT(*) n, MAX(ts) last FROM hits WHERE ts > ? AND bot_group != 'human' GROUP BY path, bot ORDER BY path, n DESC`,
  ).bind(since).all<{ path: string; bot: string; n: number; last: string }>();
  const recentHits = await env.DB.prepare('SELECT ts, path, status, bot, verified_category, as_org, ua FROM hits ORDER BY id DESC LIMIT 40').all<any>();
  const recentRuns = await env.DB.prepare('SELECT ts, prompt_id, engine, model, status, outcome, latency_ms, answer, queries, fetched, citations, sources, error FROM runs ORDER BY id DESC LIMIT 30').all<any>();

  const codeRows: (string | number)[][] = [
    ['T1 HTML', `<code>${c.t1.html}</code>`], ['T1 JS', `<code>${c.t1.js}</code>`], ['T1 JS delayed', `<code>${c.t1.jsDelayed}</code>`], ['T1 fetched', `<code>${c.t1.fetched}</code>`],
    ...Object.entries(c.t2).map(([k, v]) => [`T2 ${k}`, `<code>${v}</code>`] as (string | number)[]),
    ...c.t4.map((p) => [`T4 ${p.slug} (${esc(p.arm)})`, `${esc(p.term)} ${esc(p.thing)} · <code>${p.code}</code>`] as (string | number)[]),
  ];

  body = `
<section><h2>Status</h2>
${table(['Engine', 'Status', 'Model'], engineRows)}
<p>Jobs: ${pending.results.map((r) => `${esc(r.status)} ${r.n}`).join(' · ') || 'none yet'}. Daily batch: ${esc(env.REPEATS)} repeats per prompt and engine.</p>
<div class="actions">
<form method="post" action="/admin/run"><input type="hidden" name="repeats" value="1"><button>Queue one run of every prompt</button></form>
<form method="post" action="/admin/process"><button class="secondary">Process queue now</button></form>
<form method="post" action="/admin/indexnow"><button class="secondary">Ping IndexNow</button></form>
<a class="btn secondary" href="/admin/export.csv?table=runs">Export runs CSV</a>
<a class="btn secondary" href="/admin/export.csv?table=hits">Export hits CSV</a>
</div></section>

<section><h2>Test 1: JavaScript Rendering</h2><p class="muted">Share of successful runs (last 30 days) where the answer contained each code.</p>
${table(['Engine', 'HTML code', 'JS code', 'Delayed JS code', 'Fetched-data code', 'Errors'], t1Rows)}</section>

<section><h2>Test 2: Redirect Following</h2><p class="muted">"Followed" means the answer gave the destination page's code.</p>
${table(['Engine', '301', '302', 'JavaScript', 'Meta refresh'], t2Rows)}</section>

<section><h2>Test 4: Index Dependency</h2><p class="muted">Share of runs where the engine found the page with no URL given.</p>
${table(['Engine', 'A: Bing noindex', 'B: Google noindex', 'C: control'], t4Rows)}</section>

<section><h2>Bot Hits (Last 30 Days)</h2>
${table(['Bot', 'Group', 'Hits', 'Last seen'], hitsByBot.results.map((h) => [esc(h.bot), esc(h.bot_group), h.n, esc(h.last)]))}
<h3>By page</h3>
${table(['Path', 'Bot', 'Hits', 'Last seen'], hitsByPath.results.map((h) => [esc(h.path), esc(h.bot), h.n, esc(h.last)]))}
<h3>Latest 40 requests</h3>
${table(['Time', 'Path', 'Status', 'Bot', 'Verified', 'Network', 'User agent'], recentHits.results.map((h: any) => [esc(h.ts), esc(h.path), h.status, esc(h.bot), esc(h.verified_category), esc(h.as_org), `<span class="ua">${esc(h.ua)}</span>`]))}
</section>

<section><h2>Latest Runs</h2>
${recentRuns.results.map((r: any) => `<details><summary><b>${esc(r.engine)}</b> · ${esc(r.prompt_id)} · ${esc(r.status === 'ok' ? r.outcome : 'error')} <span class="muted">${esc(r.ts)} · ${r.latency_ms ?? ''} ms · ${esc(r.model ?? '')}</span></summary>
<pre>${esc(r.status === 'ok' ? r.answer : r.error)}</pre>
${r.status === 'ok' ? `<p><b>Queries</b> ${esc(r.queries)}</p><p><b>Fetched</b> ${esc(r.fetched)}</p><p><b>Citations</b> ${esc(r.citations)}</p><p><b>Sources</b> ${esc(r.sources)}</p>${r.error ? `<p><b>Notes</b> ${esc(r.error)}</p>` : ''}` : ''}
</details>`).join('') || '<p class="muted">No runs yet.</p>'}
</section>

<section><h2>Canary Codes</h2><p class="muted">Generated ${esc(c.created)}. Kept in D1 only.</p>
${table(['Slot', 'Value'], codeRows)}
<p class="muted">${defs.length} prompts are defined. IndexNow key file: <code>/lab/${esc(c.indexnowKey)}.txt</code></p></section>`;
  return page(body, msg);
}

function modelFor(env: Env, e: string): string {
  return e === 'openai' ? env.OPENAI_MODEL : e === 'gemini' ? env.GEMINI_MODEL : e === 'perplexity' ? env.PERPLEXITY_MODEL : env.CLAUDE_MODEL;
}

function page(body: string, msg: string | null): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>LLM Crawler Lab</title>
<style>
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:#1A1F2B;background:#F5F2EC;margin:0}
main{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:1.8rem;margin:0 0 1rem;color:#0B0F1A}
h2{font-size:1.2rem;margin:0 0 .5rem;color:#0B0F1A}
section{background:#fff;border:1px solid rgba(0,0,0,.07);padding:1.25rem 1.5rem;margin:0 0 1.25rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;margin:.5rem 0}
th,td{border-bottom:1px solid rgba(0,0,0,.07);text-align:left;padding:.45rem .6rem;vertical-align:top}
th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:#6E6E6E}
.muted{color:#6B6B6B;font-size:.85rem}
.msg{background:#F3FCD6;border:1px solid #C6F432;padding:.6rem 1rem;margin:0 0 1rem}
.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem}
button,.btn{font:inherit;font-weight:700;border:0;border-radius:8px;padding:.55rem .9rem;background:#C6F432;color:#1A1F2B;cursor:pointer;text-decoration:none;box-shadow:0 3px 0 #8FB315}
.secondary{background:#ECEBFF;box-shadow:0 3px 0 #c9c8ff}
pre{white-space:pre-wrap;background:#FAF8F3;padding:.75rem;font-size:.85rem}
details{border-bottom:1px solid rgba(0,0,0,.07);padding:.5rem 0}
code{font-family:ui-monospace,Menlo,monospace;font-size:.85rem}
.ua{font-size:.75rem;color:#6B6B6B;word-break:break-all}
</style></head><body><main><h1>LLM Crawler Lab</h1>${msg ? `<p class="msg">${esc(msg)}</p>` : ''}${body}</main></body></html>`;
}
