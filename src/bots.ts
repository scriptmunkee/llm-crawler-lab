// User-agent classification. Order matters: the first match wins.
// group: search (classic search crawler), ai-search (AI search index / retrieval),
// ai-user (live fetch on behalf of a user), ai-training, seo-tool, other-bot, human.

const RULES: Array<[RegExp, string, string]> = [
  [/OAI-SearchBot/i, 'OAI-SearchBot', 'ai-search'],
  [/ChatGPT-User/i, 'ChatGPT-User', 'ai-user'],
  [/GPTBot/i, 'GPTBot', 'ai-training'],
  [/Claude-SearchBot/i, 'Claude-SearchBot', 'ai-search'],
  [/Claude-User/i, 'Claude-User', 'ai-user'],
  [/ClaudeBot/i, 'ClaudeBot', 'ai-training'],
  [/anthropic-ai/i, 'anthropic-ai', 'ai-training'],
  [/Perplexity-User/i, 'Perplexity-User', 'ai-user'],
  [/PerplexityBot/i, 'PerplexityBot', 'ai-search'],
  [/Google-Extended/i, 'Google-Extended', 'ai-training'],
  [/Google-CloudVertexBot/i, 'Google-CloudVertexBot', 'ai-user'],
  [/GoogleOther/i, 'GoogleOther', 'other-bot'],
  [/Google-InspectionTool/i, 'Google-InspectionTool', 'search'],
  [/Googlebot/i, 'Googlebot', 'search'],
  [/Google-Read-Aloud|Google-Site-Verification|Storebot-Google|AdsBot-Google/i, 'Google (other)', 'other-bot'],
  [/bingbot/i, 'Bingbot', 'search'],
  [/BingPreview|MicrosoftPreview/i, 'BingPreview', 'other-bot'],
  [/DuckAssistBot/i, 'DuckAssistBot', 'ai-user'],
  [/DuckDuckBot/i, 'DuckDuckBot', 'search'],
  [/Applebot-Extended/i, 'Applebot-Extended', 'ai-training'],
  [/Applebot/i, 'Applebot', 'search'],
  [/meta-externalagent|meta-externalfetcher/i, 'Meta AI', 'ai-training'],
  [/facebookexternalhit/i, 'facebookexternalhit', 'other-bot'],
  [/Bytespider/i, 'Bytespider', 'ai-training'],
  [/CCBot/i, 'CCBot', 'ai-training'],
  [/MistralAI-User/i, 'MistralAI-User', 'ai-user'],
  [/YouBot/i, 'YouBot', 'ai-search'],
  [/cohere-ai|cohere-training/i, 'Cohere', 'ai-training'],
  [/Amazonbot/i, 'Amazonbot', 'ai-training'],
  [/YandexBot/i, 'YandexBot', 'search'],
  [/Baiduspider/i, 'Baiduspider', 'search'],
  [/AhrefsBot|AhrefsSiteAudit/i, 'AhrefsBot', 'seo-tool'],
  [/SemrushBot/i, 'SemrushBot', 'seo-tool'],
  [/MJ12bot/i, 'MJ12bot (Majestic)', 'seo-tool'],
  [/DotBot|rogerbot/i, 'Moz', 'seo-tool'],
  [/Screaming Frog/i, 'Screaming Frog', 'seo-tool'],
  [/bot|crawl|spider|slurp|fetch|python-requests|curl|wget|httpx|axios|node-fetch|Go-http-client|HeadlessChrome/i, 'Other bot', 'other-bot'],
];

export function classify(ua: string | null): { bot: string; group: string } {
  if (!ua) return { bot: 'No user agent', group: 'other-bot' };
  for (const [re, bot, group] of RULES) if (re.test(ua)) return { bot, group };
  return { bot: 'Browser', group: 'human' };
}
