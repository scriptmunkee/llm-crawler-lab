import type { Canaries } from './canaries';

const NOTICE =
  'This page is part of a search and AI crawler experiment run by Christopher Kelly. ' +
  'The names, codes and figures on it are fictional and exist only for this test.';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function layout(opts: {
  origin: string; path: string; title: string; description: string; body: string;
  head?: string; scripts?: string;
}): string {
  const url = `${opts.origin}${opts.path}`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${url}">
${opts.head ?? ''}
<style>
  body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:#1A1F2B;background:#F5F2EC;margin:0}
  main{max-width:760px;margin:0 auto;padding:3rem 1.5rem}
  h1{font-size:1.9rem;line-height:1.15;color:#0B0F1A;margin:0 0 1rem}
  .notice{background:#ECEBFF;border:1px solid rgba(0,0,0,.07);padding:.75rem 1rem;font-size:.9rem;color:#444;margin:0 0 2rem}
  .code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;background:#fff;border:1px solid rgba(0,0,0,.07);padding:.15rem .4rem}
  a{color:#3D3BFF}
  ul{padding-left:1.2rem}
</style>
</head>
<body>
<main>
<p class="notice">${NOTICE} <a href="${opts.origin}/lab/">About the lab</a>.</p>
${opts.body}
</main>
${opts.scripts ?? ''}
</body>
</html>`;
}

export function indexPage(origin: string): string {
  return layout({
    origin, path: '/lab/',
    title: 'Crawler and AI Search Lab | Christopher Kelly',
    description: 'Test pages used to measure how search engines and AI assistants crawl, render, follow redirects and cite web pages.',
    body: `<h1>Crawler and AI Search Lab</h1>
<p>These pages measure how search engines and AI assistants handle the web: whether they run JavaScript, whether they follow different kinds of redirect, and which search index each assistant relies on. Each page carries made-up reference codes so that results can be traced back to the exact page an engine read.</p>
<h2>Rendering</h2>
<ul><li><a href="${origin}/lab/t1/render/">Rendering test page</a></li></ul>
<h2>Redirects</h2>
<ul>
<li><a href="${origin}/lab/t2/s301/">301 redirect source</a></li>
<li><a href="${origin}/lab/t2/s302/">302 redirect source</a></li>
<li><a href="${origin}/lab/t2/sjs/">JavaScript redirect source</a></li>
<li><a href="${origin}/lab/t2/smeta/">Meta refresh redirect source</a></li>
</ul>
<h2>Indexing</h2>
<ul>
<li><a href="${origin}/lab/t4/a/">Index test page A</a></li>
<li><a href="${origin}/lab/t4/b/">Index test page B</a></li>
<li><a href="${origin}/lab/t4/c/">Index test page C</a></li>
</ul>`,
  });
}

export function t1Page(origin: string, c: Canaries): string {
  return layout({
    origin, path: '/lab/t1/render/',
    title: 'Rendering Test Page | Crawler and AI Search Lab',
    description: 'A test page that shows reference codes in plain HTML and through JavaScript.',
    body: `<h1>Rendering Test Page</h1>
<p>This page shows several reference codes. Some are in the page's HTML. Others only appear after JavaScript runs.</p>
<p>Reference code (HTML): <span class="code">${c.t1.html}</span></p>
<p id="js-slot"></p>
<p id="jsd-slot"></p>
<p id="fetch-slot"></p>`,
    scripts: `<script src="${origin}/lab/t1/render.js"></script>`,
  });
}

export function t1Script(origin: string, c: Canaries): string {
  return `(function(){
  function put(id, label, code){var el=document.getElementById(id);if(el){el.innerHTML=label+': <span class="code">'+code+'</span>';}}
  put('js-slot','Reference code (JavaScript)', '${c.t1.js}');
  setTimeout(function(){put('jsd-slot','Reference code (JavaScript, delayed)', '${c.t1.jsDelayed}');}, 2500);
  fetch('${origin}/lab/t1/data.json').then(function(r){return r.json();}).then(function(d){put('fetch-slot','Reference code (fetched data)', d.code);}).catch(function(){});
})();`;
}

export function t2Destination(origin: string, slug: string, label: string, codeValue: string): string {
  return layout({
    origin, path: `/lab/t2/${slug}/`,
    title: `${label} Destination | Crawler and AI Search Lab`,
    description: `The destination page for the ${label.toLowerCase()} test.`,
    body: `<h1>${label} Destination</h1>
<p>You have reached the destination page for the ${label.toLowerCase()} test.</p>
<p>Reference code: <span class="code">${codeValue}</span></p>`,
  });
}

export function t2JsSource(origin: string, c: Canaries): string {
  return layout({
    origin, path: '/lab/t2/sjs/',
    title: 'JavaScript Redirect Source | Crawler and AI Search Lab',
    description: 'A page that redirects with JavaScript.',
    head: `<script>location.replace(${JSON.stringify(origin + '/lab/t2/djs/')});</script>`,
    body: `<h1>JavaScript Redirect Source</h1>
<p>This page redirects with JavaScript. If you can read this, the redirect did not run.</p>
<p>Reference code (source page): <span class="code">${c.t2.sjs}</span></p>`,
  });
}

export function t2MetaSource(origin: string, c: Canaries): string {
  return layout({
    origin, path: '/lab/t2/smeta/',
    title: 'Meta Refresh Redirect Source | Crawler and AI Search Lab',
    description: 'A page that redirects with a meta refresh.',
    head: `<meta http-equiv="refresh" content="0; url=${origin}/lab/t2/dmeta/">`,
    body: `<h1>Meta Refresh Redirect Source</h1>
<p>This page redirects with a meta refresh. If you can read this, the redirect did not run.</p>
<p>Reference code (source page): <span class="code">${c.t2.smeta}</span></p>`,
  });
}

export function t4Page(origin: string, c: Canaries, slug: string): string | null {
  const p = c.t4.find((x) => x.slug === slug);
  if (!p) return null;
  return layout({
    origin, path: `/lab/t4/${slug}/`,
    title: `The ${p.term} ${titleCase(p.thing)} | Crawler and AI Search Lab`,
    description: `What the ${p.term} ${p.thing} is, who publishes it and the reference code it uses. A fictional test topic.`,
    head: p.robots,
    body: `<h1>The ${p.term} ${titleCase(p.thing)}</h1>
<p>The ${p.term} ${p.thing} is a fictional measure invented for this experiment. It is published by the ${p.publisher}, another invented name, and it uses the reference code <span class="code">${p.code}</span>.</p>
<p>On the ${p.term} ${p.thing}, a typical reading is ${p.figure}. None of this describes a real index, society or measurement.</p>`,
  });
}

export function t5Page(origin: string, c: Canaries, path: string): string | null {
  const p = c.t5?.find((x) => x.path === path);
  if (!p) return null;
  return layout({
    origin, path: p.path,
    title: `The ${p.term} ${titleCase(p.thing)} | Crawler and AI Search Lab`,
    description: `What the ${p.term} ${p.thing} is, who publishes it and the reference code it uses. A fictional test topic.`,
    body: `<h1>The ${p.term} ${titleCase(p.thing)}</h1>
<p>The ${p.term} ${p.thing} is a fictional measure invented for this experiment. It is published by the ${p.publisher}, another invented name, and it uses the reference code <span class="code">${p.code}</span>.</p>
<p>On the ${p.term} ${p.thing}, a typical reading is ${p.figure}. None of this describes a real score, group or measurement.</p>`,
  });
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

export function sitemap(origin: string): string {
  const paths = [
    '/lab/', '/lab/t1/render/',
    '/lab/t2/s301/', '/lab/t2/s302/', '/lab/t2/sjs/', '/lab/t2/smeta/',
    '/lab/t2/d301/', '/lab/t2/d302/', '/lab/t2/djs/', '/lab/t2/dmeta/',
    '/lab/t4/a/', '/lab/t4/b/', '/lab/t4/c/',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join('\n')}
</urlset>`;
}

export const LAB_URL_PATHS = [
  '/lab/', '/lab/t1/render/',
  '/lab/t2/s301/', '/lab/t2/s302/', '/lab/t2/sjs/', '/lab/t2/smeta/',
  '/lab/t2/d301/', '/lab/t2/d302/', '/lab/t2/djs/', '/lab/t2/dmeta/',
  '/lab/t4/a/', '/lab/t4/b/', '/lab/t4/c/',
];
