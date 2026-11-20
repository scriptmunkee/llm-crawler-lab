// Canary values are generated once, stored in D1 and never committed to the repo.
// That keeps them out of GitHub, so a search engine or LLM can only learn them from the lab pages.

export interface T4Page {
  slug: 'a' | 'b' | 'c';
  arm: string;          // what the page tests
  robots: string;       // meta robots tags placed on the page
  term: string;         // invented name, e.g. "Quorvane"
  thing: string;        // e.g. "pond clarity index"
  code: string;         // unique reference code
  figure: string;       // a made-up number quoted on the page
  publisher: string;    // invented publisher name
}

export interface T5Page {
  slug: 'd' | 'e' | 'f';
  path: string;         // random, unlinked path under /lab/t5/
  seedEngine: 'openai' | 'gemini' | null;   // the one engine that is shown the URL, once
  term: string; thing: string; code: string; figure: string; publisher: string;
}

export interface Canaries {
  created: string;
  indexnowKey: string;
  t1: { html: string; js: string; jsDelayed: string; fetched: string };
  t2: Record<'d301' | 'd302' | 'djs' | 'dmeta' | 'sjs' | 'smeta', string>;
  t4: T4Page[];
  t5?: T5Page[];
}

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function rand(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALNUM[b % ALNUM.length]).join('');
}

function hex(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function pick<T>(arr: T[]): T {
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  return arr[b[0] % arr.length];
}

const START = ['qu', 'br', 'v', 'th', 'gl', 'm', 'z', 'sk', 'dr', 'f', 'h', 'pl'];
const VOWEL = ['a', 'e', 'i', 'o', 'u', 'ae', 'ou', 'y'];
const MID = ['rv', 'nd', 'lm', 'st', 'rk', 'nt', 'ss', 'lv', 'mb', 'rr', 'th', 'sk'];
const END = ['ane', 'ore', 'ith', 'el', 'ux', 'eth', 'ara', 'ond', 'ix', 'ume'];

function inventWord(): string {
  const w = pick(START) + pick(VOWEL) + pick(MID) + pick(END);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const THINGS = ['pond clarity index', 'hedgerow density scale', 'garden soil warmth rating', 'allotment rainfall ratio'];

export function code(kind: string): string {
  return `LAB-${kind}-${rand(6)}`;
}

export function generateCanaries(): Canaries {
  const things = [...THINGS];
  const t4: T4Page[] = (['a', 'b', 'c'] as const).map((slug, i) => {
    const arm =
      slug === 'a' ? 'Google can index, Bing told noindex' :
      slug === 'b' ? 'Bing can index, Google told noindex' :
      'Both can index (control)';
    const robots =
      slug === 'a' ? '<meta name="bingbot" content="noindex">' :
      slug === 'b' ? '<meta name="googlebot" content="noindex">' :
      '';
    return {
      slug,
      arm,
      robots,
      term: inventWord(),
      thing: things[i],
      code: code('T4' + slug.toUpperCase()),
      figure: String(100 + Math.floor(Math.random() * 800)),
      publisher: `${inventWord()} Field Society`,
    };
  });
  return {
    created: new Date().toISOString(),
    indexnowKey: hex(16),
    t1: { html: code('HTML'), js: code('JS'), jsDelayed: code('JSDELAY'), fetched: code('FETCH') },
    t2: {
      d301: code('D301'), d302: code('D302'), djs: code('DJS'), dmeta: code('DMETA'),
      sjs: code('SJS'), smeta: code('SMETA'),
    },
    t4,
    t5: generateT5(),
  };
}

const T5_THINGS = ['beehive humidity score', 'orchard frost index', 'compost heat grade'];

export function generateT5(): T5Page[] {
  return (['d', 'e', 'f'] as const).map((slug, i) => ({
    slug,
    path: `/lab/t5/${hex(8)}/`,
    seedEngine: slug === 'd' ? 'openai' : slug === 'e' ? 'gemini' : null,
    term: inventWord(),
    thing: T5_THINGS[i],
    code: code('T5' + slug.toUpperCase()),
    figure: String(100 + Math.floor(Math.random() * 800)),
    publisher: `${inventWord()} Growers Circle`,
  }));
}

// Adds test 5 canaries to an existing lab without touching the others.
export async function ensureT5(db: D1Database): Promise<boolean> {
  const c = await getCanaries(db);
  if (!c || c.t5) return false;
  c.t5 = generateT5();
  await db.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(JSON.stringify(c), 'canaries').run();
  return true;
}

export async function getCanaries(db: D1Database): Promise<Canaries | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('canaries').first<{ value: string }>();
  return row ? (JSON.parse(row.value) as Canaries) : null;
}

export async function initCanaries(db: D1Database): Promise<{ created: boolean; canaries: Canaries }> {
  const existing = await getCanaries(db);
  if (existing) return { created: false, canaries: existing };
  const c = generateCanaries();
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('canaries', JSON.stringify(c)).run();
  return { created: true, canaries: c };
}

// Normalise for matching: uppercase, letters and digits only.
export function norm(s: string): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
