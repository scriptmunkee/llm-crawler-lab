-- LLM crawler lab schema (D1)

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Every request that reaches /lab/
CREATE TABLE IF NOT EXISTS hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  path TEXT NOT NULL,
  query TEXT,
  method TEXT,
  status INTEGER,
  ua TEXT,
  bot TEXT,
  bot_group TEXT,
  verified_category TEXT,
  ip TEXT,
  asn INTEGER,
  as_org TEXT,
  country TEXT,
  referer TEXT
);
CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts);
CREATE INDEX IF NOT EXISTS hits_path ON hits(path);
CREATE INDEX IF NOT EXISTS hits_bot ON hits(bot);

-- Queue of prompt runs
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  batch TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

-- Results of prompt runs
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  batch TEXT,
  test_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  prompt TEXT,
  answer TEXT,
  queries TEXT,
  fetched TEXT,
  sources TEXT,
  citations TEXT,
  detected TEXT,
  outcome TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS runs_ts ON runs(ts);
CREATE INDEX IF NOT EXISTS runs_prompt ON runs(prompt_id, engine);
