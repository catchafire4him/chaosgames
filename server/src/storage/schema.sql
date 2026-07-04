-- Campaign module schema (Neon Postgres). Idempotent: safe to run repeatedly.
-- Source of truth for both migrate.mjs and PostgresStorage.init().

CREATE TABLE IF NOT EXISTS schema_version (
  version int PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  player_key uuid PRIMARY KEY,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code text UNIQUE NOT NULL,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  chapter_num int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  campaign_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_key uuid NOT NULL REFERENCES players(player_key),
  name text NOT NULL,
  class text NOT NULL,
  avatar text NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  hp int NOT NULL DEFAULT 0,
  max_hp int NOT NULL DEFAULT 0,
  level int NOT NULL DEFAULT 1,
  abilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  inventory jsonb NOT NULL DEFAULT '[]'::jsonb,
  quirks jsonb NOT NULL DEFAULT '{}'::jsonb,
  portrait_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, player_key)
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  kind text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  style_key text NOT NULL DEFAULT '',
  prompt text NOT NULL DEFAULT '',
  image bytea,
  mime text NOT NULL DEFAULT 'image/png',
  times_used int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_scope_kind_idx ON assets (scope, kind);
CREATE INDEX IF NOT EXISTS assets_tags_idx ON assets USING gin (tags);

CREATE TABLE IF NOT EXISTS snapshots (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  chapter int NOT NULL DEFAULT 0,
  scene text NOT NULL DEFAULT '',
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_version (version) VALUES (1) ON CONFLICT DO NOTHING;
