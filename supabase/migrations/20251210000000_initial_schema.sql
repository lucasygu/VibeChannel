-- =============================================================================
-- VibeChannel Database Schema
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- REPOS: Repositories connected via GitHub App
-- -----------------------------------------------------------------------------
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- GitHub identifiers
  github_installation_id BIGINT NOT NULL,
  github_repo_id BIGINT NOT NULL UNIQUE,

  -- Repo info
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',

  -- VibeChannel config
  vibechannel_branch TEXT NOT NULL DEFAULT 'vibechannel',
  vibechannel_initialized BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_full_name UNIQUE (full_name)
);

CREATE INDEX idx_repos_installation ON repos(github_installation_id);
CREATE INDEX idx_repos_full_name ON repos(full_name);

-- -----------------------------------------------------------------------------
-- USERS: From Supabase Auth + GitHub profile
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- GitHub profile
  github_id BIGINT UNIQUE,
  github_login TEXT NOT NULL,
  github_name TEXT,
  avatar_url TEXT,
  email TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_github_login ON users(github_login);

-- -----------------------------------------------------------------------------
-- USER_REPOS: Which repos can a user access?
-- -----------------------------------------------------------------------------
CREATE TABLE user_repos (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,

  -- Access level
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),

  -- Timestamps
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, repo_id)
);

CREATE INDEX idx_user_repos_user ON user_repos(user_id);
CREATE INDEX idx_user_repos_repo ON user_repos(repo_id);

-- -----------------------------------------------------------------------------
-- CHANNELS: Subfolders within repos
-- -----------------------------------------------------------------------------
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,

  -- Channel info
  name TEXT NOT NULL,
  description TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_channel_per_repo UNIQUE (repo_id, name)
);

CREATE INDEX idx_channels_repo ON channels(repo_id);

-- -----------------------------------------------------------------------------
-- MESSAGES: Cache of .md files (SOURCE OF TRUTH IS GITHUB)
-- -----------------------------------------------------------------------------
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,

  -- Message content (from .md file)
  sender TEXT NOT NULL,
  sender_user_id UUID REFERENCES users(id),
  content TEXT NOT NULL,

  -- Threading
  reply_to_id UUID REFERENCES messages(id),
  reply_to_path TEXT,

  -- Metadata
  tags TEXT[],

  -- GitHub sync info
  github_path TEXT NOT NULL,          -- 'general/20250115T103045-lucas-a3f8c2.md'
  github_sha TEXT,                     -- File SHA for verification
  github_synced BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL,    -- From frontmatter 'date'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_message_path UNIQUE (channel_id, github_path)
);

CREATE INDEX idx_messages_channel_created ON messages(channel_id, created_at);
CREATE INDEX idx_messages_sender ON messages(sender);
CREATE INDEX idx_messages_github_path ON messages(github_path);
CREATE INDEX idx_messages_reply_to ON messages(reply_to_id);

-- -----------------------------------------------------------------------------
-- PRESENCE: Transient (NOT synced to GitHub)
-- -----------------------------------------------------------------------------
CREATE TABLE presence (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Current location
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'away', 'typing', 'offline')),

  -- Timestamps
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_presence_channel ON presence(channel_id);

-- -----------------------------------------------------------------------------
-- UNREAD_COUNTS: Per-user read state (NOT synced to GitHub)
-- -----------------------------------------------------------------------------
CREATE TABLE unread_counts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,

  -- Read state
  last_read_message_id UUID REFERENCES messages(id),
  last_read_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (user_id, channel_id)
);

-- -----------------------------------------------------------------------------
-- UPDATED_AT TRIGGER
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repos_updated_at
  BEFORE UPDATE ON repos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
