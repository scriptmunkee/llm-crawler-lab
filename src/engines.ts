// One caller per engine. Each returns the answer text plus every URL signal it exposes.

export interface EngineResult {
  model: string;
  answer: string;
  queries: string[];    // search queries the engine ran
  fetched: string[];    // URLs the engine says it opened or retrieved
  sources: string[];    // URLs it was shown (search results)
  citations: string[];  // URLs cited in the answer
  note?: string;
  usage: { input: number; output: number; searches: number };
}

export type EngineName = 'openai' | 'gemini' | 'perplexity' | 'claude';
export const ENGINES: EngineName[] = ['openai', 'gemini', 'perplexity', 'claude'];

export interface EngineEnv {
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_MODEL: string;
  GEMINI_MODEL: string;
  PERPLEXITY_MODEL: string;
  CLAUDE_MODEL: string;
  ENABLED_ENGINES?: string;   // comma-separated, e.g. "openai,gemini"
  // Prices for the cost estimate (USD). Token prices per 1M tokens, search per 1k calls.
  OPENAI_PRICE_IN?: string; OPENAI_PRICE_OUT?: string; OPENAI_SEARCH_PER_1K?: string;
  GEMINI_PRICE_IN?: string; GEMINI_PRICE_OUT?: string; GEMINI_SEARCH_PER_1K?: string;
}

export function estimateCost(env: EngineEnv, engine: EngineName, u: EngineResult['usage']): number | null {
  const n = (v?: string) => (v === undefined || v === '' ? NaN : parseFloat(v));
  const [pi, po, ps] = engine === 'openai'
    ? [n(env.OPENAI_PRICE_IN), n(env.OPENAI_PRICE_OUT), n(env.OPENAI_SEARCH_PER_1K)]
    : engine === 'gemini'
      ? [n(env.GEMINI_PRICE_IN), n(env.GEMINI_PRICE_OUT), n(env.GEMINI_SEARCH_PER_1K)]
      : [NaN, NaN, NaN];
  if ([pi, po, ps].some(Number.isNaN)) return null;
  return (u.input / 1e6) * pi + (u.output / 1e6) * po + (u.searches / 1000) * ps;
}

export function isEnabled(env: EngineEnv, e: EngineName): boolean {
  const list = (env.ENABLED_ENGINES ?? ENGINES.join(',')).split(',').map((s) => s.trim());
  return list.includes(e);
}

export function hasKey(env: EngineEnv, e: EngineName): boolean {
  return !!(e === 'openai' ? env.OPENAI_API_KEY :
    e === 'gemini' ? env.GEMINI_API_KEY :
    e === 'perplexity' ? env.PERPLEXITY_API_KEY : env.ANTHROPIC_API_KEY);
}

const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

export async function callEngine(env: EngineEnv, engine: EngineName, prompt: string): Promise<EngineResult> {
  switch (engine) {
    case 'openai': return openai(env, prompt);
    case 'gemini': return gemini(env, prompt);
    case 'perplexity': return perplexity(env, prompt);
    case 'claude': return claude(env, prompt);
  }
}

async function openai(env: EngineEnv, prompt: string): Promise<EngineResult> {
  const model = env.OPENAI_MODEL;
  const j = await postJson('https://api.openai.com/v1/responses', { authorization: `Bearer ${env.OPENAI_API_KEY}` }, {
    model,
    input: prompt,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
  });
  const queries: string[] = [], fetched: string[] = [], sources: string[] = [], citations: string[] = [];
  let answer = '';
  for (const item of j.output ?? []) {
    if (item.type === 'web_search_call') {
      const a = item.action ?? {};
      if (a.query) queries.push(a.query);
      for (const q of a.queries ?? []) queries.push(q);
      if (a.url) fetched.push(a.url);
      for (const s of a.sources ?? []) if (s.url) sources.push(s.url);
    }
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') {
          answer += part.text;
          for (const an of part.annotations ?? []) if (an.url) citations.push(an.url);
        }
      }
    }
  }
  const searches = (j.output ?? []).filter((i: any) => i.type === 'web_search_call').length;
  return {
    model: j.model ?? model, answer, queries: uniq(queries), fetched: uniq(fetched), sources: uniq(sources), citations: uniq(citations),
    usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0, searches },
  };
}

async function gemini(env: EngineEnv, prompt: string): Promise<EngineResult> {
  const model = env.GEMINI_MODEL;
  const j = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': env.GEMINI_API_KEY! },
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ url_context: {} }, { google_search: {} }] },
  );
  const cand = j.candidates?.[0] ?? {};
  const answer = (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  const gm = cand.groundingMetadata ?? {};
  const um = cand.urlContextMetadata ?? cand.url_context_metadata ?? {};
  const fetched: string[] = [];
  const statuses: string[] = [];
  for (const m of um.urlMetadata ?? um.url_metadata ?? []) {
    const u = m.retrievedUrl ?? m.retrieved_url;
    const st = m.urlRetrievalStatus ?? m.url_retrieval_status;
    if (u) fetched.push(u);
    if (u && st) statuses.push(`${u} → ${st}`);
  }
  // Grounding chunks carry Google redirect URLs; keep the title (usually the domain) alongside.
  const citations = (gm.groundingChunks ?? []).map((c: any) => c.web?.uri ? `${c.web.title ?? ''} ${c.web.uri}`.trim() : '').filter(Boolean);
  const um2 = j.usageMetadata ?? {};
  return {
    model, answer,
    queries: uniq(gm.webSearchQueries ?? []),
    fetched: uniq(fetched), sources: [], citations: uniq(citations),
    note: statuses.length ? statuses.join('\n') : undefined,
    usage: {
      input: (um2.promptTokenCount ?? 0) + (um2.toolUsePromptTokenCount ?? 0),
      output: (um2.candidatesTokenCount ?? 0) + (um2.thoughtsTokenCount ?? 0),
      searches: (gm.webSearchQueries ?? []).length,
    },
  };
}

async function perplexity(env: EngineEnv, prompt: string): Promise<EngineResult> {
  const model = env.PERPLEXITY_MODEL;
  const j = await postJson('https://api.perplexity.ai/chat/completions', { authorization: `Bearer ${env.PERPLEXITY_API_KEY}` }, {
    model, messages: [{ role: 'user', content: prompt }],
  });
  const answer = j.choices?.[0]?.message?.content ?? '';
  const sources = (j.search_results ?? []).map((s: any) => s.url).filter(Boolean);
  return {
    model: j.model ?? model, answer, queries: [], fetched: [], sources: uniq(sources), citations: uniq(j.citations ?? []),
    usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, searches: 1 },
  };
}

async function claude(env: EngineEnv, prompt: string): Promise<EngineResult> {
  const model = env.CLAUDE_MODEL;
  const j = await postJson('https://api.anthropic.com/v1/messages', {
    'x-api-key': env.ANTHROPIC_API_KEY!,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'web-fetch-2025-09-10',
  }, {
    model, max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 },
    ],
  });
  const queries: string[] = [], fetched: string[] = [], sources: string[] = [], citations: string[] = [], notes: string[] = [];
  let answer = '';
  for (const b of j.content ?? []) {
    if (b.type === 'text') {
      answer += b.text;
      for (const c of b.citations ?? []) if (c.url) citations.push(c.url);
    } else if (b.type === 'server_tool_use') {
      if (b.name === 'web_search' && b.input?.query) queries.push(b.input.query);
      if (b.name === 'web_fetch' && b.input?.url) fetched.push(b.input.url);
    } else if (b.type === 'web_search_tool_result') {
      if (Array.isArray(b.content)) {
        for (const r of b.content) if (r.url) sources.push(r.url);
      } else if (b.content?.error_code) {
        notes.push(`web_search error: ${b.content.error_code}`);
      }
    } else if (b.type === 'web_fetch_tool_result') {
      const c = b.content ?? {};
      if (c.error_code) notes.push(`web_fetch error: ${c.error_code}`);
      else if (c.url) notes.push(`web_fetch ok: ${c.url}`);
    }
  }
  if (j.stop_reason && j.stop_reason !== 'end_turn') notes.push(`stop_reason: ${j.stop_reason}`);
  return {
    model: j.model ?? model, answer,
    queries: uniq(queries), fetched: uniq(fetched), sources: uniq(sources), citations: uniq(citations),
    note: notes.length ? notes.join('\n') : undefined,
    usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0, searches: j.usage?.server_tool_use?.web_search_requests ?? queries.length },
  };
}
