import { handleAdmin } from './admin';
import { classify } from './bots';
import { getCanaries, type Canaries } from './canaries';
import type { EngineEnv } from './engines';
import { indexPage, sitemap, t1Page, t1Script, t2Destination, t2JsSource, t2MetaSource, t4Page } from './pages';
import { enqueue, processJobs, t4Ready } from './runner';

export interface Env extends EngineEnv {
  DB: D1Database;
  SITE_ORIGIN: string;
  REPEATS: string;
  BATCH_SIZE: string;
  DAILY_CRON: string;
  ADMIN_TOKEN?: string;
  MAX_DAILY_USD?: string;
  DAILY_TESTS?: string;   // tests queued every day, e.g. "t4"
  WEEKLY_TESTS?: string;  // tests queued once a week, e.g. "t1,t2"
  WEEKLY_DAY?: string;    // UTC day for weekly tests, 0 = Sunday, 1 = Monday
  T4_GATE?: string;       // "crawl": hold test 4 until Googlebot or Bingbot has fetched a test 4 page
}

const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' };

function logHit(env: Env, ctx: ExecutionContext, req: Request, status: number) {
  const url = new URL(req.url);
  const ua = req.headers.get('user-agent');
  const { bot, group } = classify(ua);
  const cf = (req as any).cf ?? {};
  ctx.waitUntil(
    env.DB.prepare(
      `INSERT INTO hits (ts, path, query, method, status, ua, bot, bot_group, verified_category, ip, asn, as_org, country, referer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      new Date().toISOString(), url.pathname, url.search || null, req.method, status,
      ua, bot, group, cf.verifiedBotCategory ?? null,
      req.headers.get('cf-connecting-ip'), cf.asn ?? null, cf.asOrganization ?? null,
      cf.country ?? req.headers.get('cf-ipcountry'), req.headers.get('referer'),
    ).run().catch(() => {}),
  );
}

async function labResponse(req: Request, env: Env, c: Canaries | null): Promise<Response> {
  const o = env.SITE_ORIGIN;
  const path = new URL(req.url).pathname;

  if (path === '/lab') return Response.redirect(`${o}/lab/`, 301);
  if (path === '/lab/') return new Response(indexPage(o), { headers: HTML });
  if (path === '/lab/sitemap.xml') return new Response(sitemap(o), { headers: { 'content-type': 'application/xml; charset=utf-8' } });

  if (!c) return new Response('Lab not initialised yet.', { status: 503, headers: { 'retry-after': '3600' } });

  if (path === `/lab/${c.indexnowKey}.txt`) return new Response(c.indexnowKey, { headers: { 'content-type': 'text/plain; charset=utf-8' } });

  // Test 1
  if (path === '/lab/t1/render/') return new Response(t1Page(o, c), { headers: HTML });
  if (path === '/lab/t1/render.js') return new Response(t1Script(o, c), { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
  if (path === '/lab/t1/data.json') return new Response(JSON.stringify({ code: c.t1.fetched }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } });

  // Test 2
  if (path === '/lab/t2/s301/') return Response.redirect(`${o}/lab/t2/d301/`, 301);
  if (path === '/lab/t2/s302/') return Response.redirect(`${o}/lab/t2/d302/`, 302);
  if (path === '/lab/t2/sjs/') return new Response(t2JsSource(o, c), { headers: HTML });
  if (path === '/lab/t2/smeta/') return new Response(t2MetaSource(o, c), { headers: HTML });
  const dest: Record<string, [string, string]> = {
    '/lab/t2/d301/': ['d301', '301 Redirect'], '/lab/t2/d302/': ['d302', '302 Redirect'],
    '/lab/t2/djs/': ['djs', 'JavaScript Redirect'], '/lab/t2/dmeta/': ['dmeta', 'Meta Refresh Redirect'],
  };
  if (dest[path]) {
    const [slug, label] = dest[path];
    return new Response(t2Destination(o, slug, label, (c.t2 as any)[slug]), { headers: HTML });
  }

  // Test 4
  const m = /^\/lab\/t4\/([abc])\/$/.exec(path);
  if (m) {
    const html = t4Page(o, c, m[1]);
    if (html) return new Response(html, { headers: HTML });
  }

  // Add the trailing slash the main site uses everywhere
  if (!path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) return Response.redirect(`${o}${path}/`, 301);

  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return handleAdmin(req, env);
    if (url.pathname === '/lab' || url.pathname.startsWith('/lab/')) {
      const c = await getCanaries(env.DB).catch(() => null);
      const res = await labResponse(req, env, c);
      logHit(env, ctx, req, res.status);
      return res;
    }
    if (url.pathname === '/') return new Response(null, { status: 302, headers: { location: '/admin' } });
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === env.DAILY_CRON) {
      const list = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const tests = list(env.DAILY_TESTS || 't1,t2,t4');
      if (new Date(event.scheduledTime).getUTCDay() === parseInt(env.WEEKLY_DAY || '1', 10)) tests.push(...list(env.WEEKLY_TESTS));
      ctx.waitUntil(t4Ready(env).then((ready) => {
        const run = [...new Set(tests)].filter((t) => t !== 't4' || ready);
        return run.length ? enqueue(env, undefined, undefined, run) : null;
      }).then(() => processJobs(env)).catch(() => {}));
    } else {
      ctx.waitUntil(processJobs(env).catch(() => {}));
    }
  },
};
