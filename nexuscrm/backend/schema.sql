-- ════════════════════════════════════════════════════════════
-- NexusCRM — D1 schema (V4.1 hardened + V5/V6 cycle columns)
-- Reconstructed from backend/src/index.js's actual queries.
-- Idempotent: every statement is CREATE ... IF NOT EXISTS, so
-- re-running `wrangler d1 execute --file=./schema.sql` is safe.
--
-- TIMESTAMP RULE (V4.1 fix): every timestamp is ISO-8601 UTC
-- ("2026-08-27T12:34:56.789Z") — schema defaults here match the
-- JS `new Date().toISOString()` writes exactly, so string
-- comparisons like `fire_at <= ?` and `expires_at < ?` work.
-- ════════════════════════════════════════════════════════════

-- ── Workspaces & auth ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Workspace',
  public_token TEXT DEFAULT '',                 -- webchat widget + public webhook token
  ai_provider TEXT DEFAULT 'nvidia',
  ai_model TEXT DEFAULT '',
  ai_temperature REAL DEFAULT 0.7,
  ai_max_tokens INTEGER DEFAULT 2048,
  ai_system_prompt TEXT DEFAULT '',
  ai_custom_base_url TEXT DEFAULT '',
  ai_custom_key TEXT DEFAULT '',                -- encrypted at rest (AES-256-GCM)
  ai_openai_key TEXT DEFAULT '',                -- encrypted at rest
  ai_nvidia_key TEXT DEFAULT '',                -- encrypted at rest
  ai_nvidia_base_url TEXT DEFAULT '',
  ai_daily_call_cap INTEGER DEFAULT 0,          -- 0 = unlimited
  ai_auto_score_new_contacts INTEGER DEFAULT 0,
  ai_daily_digest_enabled INTEGER DEFAULT 0,
  ai_daily_digest_hour_utc INTEGER DEFAULT 13,
  ai_brand_voice TEXT DEFAULT '',               -- V5 cycle 3
  ai_memory_summary TEXT DEFAULT '',            -- long-term AI memory (runtime-written)
  agent_facts TEXT DEFAULT '[]',                -- V6: facts the agent was told to remember
  resend_api_key TEXT DEFAULT '',               -- encrypted at rest
  resend_from_email TEXT DEFAULT '',
  resend_from_name TEXT DEFAULT '',
  digest_sent_date TEXT DEFAULT '',             -- once-per-day daily digest guard
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_ws ON users(workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,                     -- ISO-8601 UTC; purged by cron when past
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── Rate limiting & login throttling ────────────────────────
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,                         -- e.g. "reg:<ip>" / "wc:<ws>:<ip>"
  count INTEGER DEFAULT 0,
  window_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_throttle (
  email TEXT PRIMARY KEY,
  fail_count INTEGER DEFAULT 0,
  first_fail_at TEXT DEFAULT '',
  locked_until TEXT DEFAULT ''
);

-- ── CRM core ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  company TEXT DEFAULT '',
  stage TEXT DEFAULT 'lead',                    -- lead|prospect|qualified|proposal|negotiation|won|lost|customer|churned
  source TEXT DEFAULT 'manual',
  notes TEXT DEFAULT '',
  tags TEXT DEFAULT '',                         -- comma-separated
  custom_fields TEXT DEFAULT '{}',              -- JSON {label: value}
  ai_score INTEGER DEFAULT 0,
  ai_score_reason TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_ws ON contacts(workspace_id);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  contact_id INTEGER,
  title TEXT NOT NULL,
  value REAL DEFAULT 0,
  stage TEXT DEFAULT 'lead',
  probability INTEGER DEFAULT 20,
  close_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_ws ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  contact_id INTEGER,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium',
  due_date TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',                -- pending|done
  reminder_sent INTEGER DEFAULT 0,              -- once-per-task overdue reminder guard
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_ws ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  contact_id INTEGER,                           -- NULL for webchat (visitor subject used)
  channel TEXT DEFAULT 'email',                 -- email|whatsapp|sms|webchat
  subject TEXT DEFAULT '',                      -- webchat: "__v_<visitorId>"
  body TEXT DEFAULT '',
  direction TEXT DEFAULT 'outbound',            -- inbound|outbound
  ai_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_ws ON messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  contact_id INTEGER,
  title TEXT NOT NULL,
  date TEXT NOT NULL,                           -- YYYY-MM-DD
  time TEXT DEFAULT '',                         -- HH:MM
  duration INTEGER DEFAULT 30,
  type TEXT DEFAULT 'meeting',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'scheduled',              -- scheduled|completed|cancelled
  reminder_sent INTEGER DEFAULT 0,              -- 24h-before reminder guard
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_appts_ws ON appointments(workspace_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  contact_id INTEGER,
  platform TEXT DEFAULT 'google',
  rating INTEGER DEFAULT 5,
  text TEXT DEFAULT '',
  ai_reply TEXT DEFAULT '',                     -- persisted review reply (PATCH /reviews/:id)
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_ws ON reviews(workspace_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  contact_id INTEGER,
  number TEXT NOT NULL,                         -- "INV-1001"… monotonic per workspace
  items TEXT DEFAULT '[]',                      -- JSON [{desc, qty, price}]
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',                  -- draft|paid
  due_date TEXT DEFAULT '',
  paid_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, number)                  -- numbers can never collide
);
CREATE INDEX IF NOT EXISTS idx_invoices_ws ON invoices(workspace_id);

-- ── Automations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,                        -- new_contact|stage_change|appointment|invoice_paid|form_submitted|trigger_link|webhook
  status TEXT DEFAULT 'active',                 -- active|paused
  steps TEXT DEFAULT '[]',                      -- JSON step array
  run_count INTEGER DEFAULT 0,
  last_run TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_workflows_ws ON workflows(workspace_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  contact_id INTEGER,
  payload TEXT DEFAULT '{}',                    -- JSON
  fire_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- delayed steps queue here
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_queue ON events(processed, fire_at);
CREATE INDEX IF NOT EXISTS idx_events_ws ON events(workspace_id);

CREATE TABLE IF NOT EXISTS workflow_runs (      -- V5 cycle 4: per-workflow run history
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  event_type TEXT DEFAULT '',
  status TEXT DEFAULT 'ok',                     -- ok|error
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_wfruns_ws ON workflow_runs(workspace_id);

CREATE TABLE IF NOT EXISTS trigger_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,                    -- public /api/public/link/:slug
  redirect_url TEXT DEFAULT '',
  clicks INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Lead capture & marketing ────────────────────────────────
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,                    -- public embed + submit endpoints
  fields TEXT DEFAULT '[]',                     -- JSON field defs
  success_message TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  contact_id INTEGER,                           -- auto-created contact
  data TEXT DEFAULT '{}',                       -- JSON answers
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_formsubs_ws ON form_submissions(workspace_id);

CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  platform TEXT DEFAULT 'linkedin',
  content TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',                  -- draft|scheduled|published
  ai_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_social_ws ON social_posts(workspace_id);

CREATE TABLE IF NOT EXISTS funnels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  goal TEXT DEFAULT '',
  stages TEXT DEFAULT '[]',                     -- JSON
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',                  -- draft|published
  modules TEXT DEFAULT '[]',                    -- JSON (AI outlines stored here)
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Affiliates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  rate REAL DEFAULT 10,                         -- commission %
  token TEXT NOT NULL UNIQUE,                   -- /api/public/affiliate/go?token=…
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  ref TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Agency ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sub_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  plan TEXT DEFAULT 'free',
  mrr REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── AI websites ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,                    -- /api/public/site/:slug
  html TEXT DEFAULT '',
  published INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sites_ws ON sites(workspace_id);

CREATE TABLE IF NOT EXISTS site_meta (          -- V6 (+ theme/custom_css columns)
  site_id INTEGER PRIMARY KEY,                  -- ON CONFLICT(site_id) upsert
  design_id TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  content_plan TEXT DEFAULT '{}',               -- JSON (scene/spline/concept live here)
  theme TEXT DEFAULT '{}',                      -- JSON theme overrides
  custom_css TEXT DEFAULT ''
);

-- ── AI memory, usage & feedback ─────────────────────────────
CREATE TABLE IF NOT EXISTS chat_memory (        -- V5 cycle 2: persistent chat history
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  role TEXT NOT NULL,                           -- user|assistant
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chatmem_ws ON chat_memory(workspace_id);

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  op TEXT NOT NULL,                             -- chat|complete|generate|score|workflow_email…
  provider TEXT DEFAULT '',
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_aiusage_ws ON ai_usage_log(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS ai_feedback (        -- V6: 👍/👎 on chat replies
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,                      -- 1 | -1
  op TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  model TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Audit trail ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  actor TEXT DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
