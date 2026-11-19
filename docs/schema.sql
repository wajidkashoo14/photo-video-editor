-- CreateStudio: planned server schema for accounts and cloud sync (PostgreSQL 15+).
--
-- STATUS: PLANNED. Nothing in the current build reads or writes this database. Today every
-- project, asset, export and brand setting lives in the browser (IndexedDB, see README.md →
-- "Data model"). This file is the agreed target for the accounts + sync phase, so the local
-- records were shaped to map onto it one to one:
--   IndexedDB projects  -> projects       (ids are the same 16-hex client ids)
--   IndexedDB assets    -> assets         (blob moves to object storage, row keeps the key)
--   IndexedDB exports   -> exports
--   IndexedDB kv        -> user_settings  (brand colours, fonts, logo, adjustment presets)
--
-- Apply with:  psql "$DATABASE_URL" -f docs/schema.sql

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  password_hash  text,                                  -- argon2id; NULL for OAuth-only accounts
  display_name   text NOT NULL DEFAULT '',
  email_verified boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Opaque session tokens live only in an HttpOnly, Secure, SameSite=Lax cookie.
-- The database stores their SHA-256, so a leaked table cannot be replayed.
CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_agent  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE oauth_accounts (
  provider          text NOT NULL,                      -- 'google', 'github', ...
  provider_user_id  text NOT NULL,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE TYPE project_kind AS ENUM ('photo', 'video');

CREATE TABLE projects (
  id            text PRIMARY KEY,                       -- client-generated, same as IndexedDB
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          project_kind NOT NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  width         integer NOT NULL CHECK (width BETWEEN 1 AND 16384),
  height        integer NOT NULL CHECK (height BETWEEN 1 AND 16384),
  data          jsonb NOT NULL,                         -- PhotoDoc or VideoProject: edit instructions only
  thumbnail_key text,                                   -- object-storage key of a small WebP
  revision      integer NOT NULL DEFAULT 1,             -- optimistic concurrency for sync
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz                             -- in the trash; purged after 30 days
);
CREATE INDEX projects_owner_recent_idx ON projects (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX projects_owner_trash_idx  ON projects (owner_id, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TYPE asset_kind AS ENUM ('image', 'video', 'audio', 'bitmap', 'font', 'lut');

-- Original media is never modified; edits reference assets by id.
CREATE TABLE assets (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        asset_kind NOT NULL,
  name        text NOT NULL,
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  sha256      bytea NOT NULL,                           -- integrity check and de-duplication
  storage_key text NOT NULL UNIQUE,                     -- private bucket; read through short-lived signed URLs
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,       -- dimensions, duration, peaks, ...
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_project_idx ON assets (project_id);
CREATE INDEX assets_owner_idx   ON assets (owner_id);

CREATE TABLE exports (
  id           text PRIMARY KEY,
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   text REFERENCES projects(id) ON DELETE SET NULL,
  project_name text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('photo', 'video', 'product')),
  filename     text NOT NULL,
  mime         text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  size_bytes   bigint NOT NULL,
  storage_key  text,                                    -- NULL when the file was not kept
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exports_owner_recent_idx ON exports (owner_id, created_at DESC);

-- Brand kit and editor preferences. Binary values (the logo, font files) go to object storage and
-- are referenced by storage_key, because rows in assets always belong to a project.
CREATE TABLE user_settings (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         text NOT NULL,                            -- 'brand-colors', 'photo-presets', 'brand-logo', ...
  value       jsonb,
  storage_key text,                                     -- for binary values such as the logo or fonts
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Every cloud AI call, for per-user quotas, rate limits shared across server instances and cost reports.
CREATE TABLE ai_requests (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability  text NOT NULL,                            -- 'text-to-image', 'image-edit', 'transcribe'
  provider    text NOT NULL,
  status      smallint NOT NULL,                        -- HTTP status returned to the client
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_requests_user_recent_idx ON ai_requests (user_id, created_at DESC);
