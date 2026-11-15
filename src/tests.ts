import type { Canaries } from './canaries';
import { norm } from './canaries';

export type TestId = 't1' | 't2' | 't4';

export interface PromptDef {
  id: string;
  test: TestId;
  label: string;
  text: string;
  url?: string;                       // URL given in the prompt, if any
  expect: Record<string, string>;     // label -> canary code to look for
}

export function prompts(c: Canaries, origin: string): PromptDef[] {
  const lab = `${origin}/lab`;
  const list: PromptDef[] = [];

  list.push({
    id: 't1-render',
    test: 't1',
    label: 'JS rendering: which codes does the engine see?',
    url: `${lab}/t1/render/`,
    text: `Open ${lab}/t1/render/ and list every reference code shown on that page, exactly as written. The codes start with "LAB-". If you cannot open the page, say so plainly.`,
    expect: { html: c.t1.html, js: c.t1.js, jsDelayed: c.t1.jsDelayed, fetched: c.t1.fetched },
  });

  const t2: Array<[string, string, string, Record<string, string>]> = [
    ['t2-301', '301 redirect', 's301', { destination: c.t2.d301 }],
    ['t2-302', '302 redirect', 's302', { destination: c.t2.d302 }],
    ['t2-js', 'JavaScript redirect', 'sjs', { destination: c.t2.djs, source: c.t2.sjs }],
    ['t2-meta', 'Meta refresh redirect', 'smeta', { destination: c.t2.dmeta, source: c.t2.smeta }],
  ];
  for (const [id, label, slug, expect] of t2) {
    list.push({
      id,
      test: 't2',
      label: `Redirect following: ${label}`,
      url: `${lab}/t2/${slug}/`,
      text: `Open ${lab}/t2/${slug}/ and tell me the reference code shown on the page you end up on. The code starts with "LAB-". If you cannot open the page, say so plainly.`,
      expect,
    });
  }

  for (const p of c.t4) {
    list.push({
      id: `t4-${p.slug}`,
      test: 't4',
      label: `Index dependency: ${p.arm}`,
      text: `What is the ${p.term} ${p.thing}? Who publishes it, and what reference code does it use?`,
      expect: { code: p.code, term: p.term },
    });
  }
  return list;
}

export interface Detection {
  found: string[];          // expect labels found in the answer
  citedLab: boolean;        // a /lab/ URL appears in citations or sources
  fetchedLab: boolean;      // the engine reports fetching a /lab/ URL
}

export function detect(p: PromptDef, answer: string, urls: string[], fetched: string[]): Detection {
  const a = norm(answer);
  const found = Object.entries(p.expect)
    .filter(([label, value]) => label !== 'term' && a.includes(norm(value)))
    .map(([label]) => label);
  // Gemini citations are Google redirect URLs titled with the domain only, so a bare domain title counts too.
  const isLab = (u: string) => /christopher-kelly\.co\.uk\/lab\//.test(u) || /\/lab\/t\d/.test(u) || /^christopher-kelly\.co\.uk\s/.test(u);
  return { found, citedLab: urls.some(isLab), fetchedLab: fetched.some(isLab) };
}

export function outcome(p: PromptDef, d: Detection): string {
  if (p.test === 't1') {
    return d.found.length ? `saw: ${d.found.join(', ')}` : 'saw none';
  }
  if (p.test === 't2') {
    if (d.found.includes('destination')) return 'followed';
    if (d.found.includes('source')) return 'read source only';
    return 'no code';
  }
  // t4
  if (d.found.includes('code')) return 'found (code)';
  if (d.citedLab) return 'found (cited)';
  return 'not found';
}
