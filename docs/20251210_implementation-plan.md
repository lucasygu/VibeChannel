# VibeChannel Implementation Plan: Supabase Backend Integration

**Created:** December 2025
**Status:** Planning
**Related:** [Git-Based Messaging Architecture](./20251207_git-based-messaging-architecture.md)

---

## Executive Summary

This document details the implementation plan for adding a Supabase backend to VibeChannel. The goal is to transform the current git-polling architecture into a real-time system while maintaining Git as the source of truth.

**Key Changes:**
- Replace 10-second git polling with WebSocket real-time
- Add Supabase as ephemeral cache (Git remains source of truth)
- Use GitHub App for repo access (not user tokens)
- Enable presence, typing indicators, and instant messaging

**Timeline Estimate:** Not provided (user decides scheduling)

---

## Table of Contents

1. [Architecture Decisions](#part-1-architecture-decisions)
2. [GitHub App Setup](#part-2-github-app-setup)
3. [Supabase Project Setup](#part-3-supabase-project-setup)
4. [Database Schema](#part-4-database-schema)
5. [Edge Functions](#part-5-edge-functions)
6. [VS Code Extension Changes](#part-6-vs-code-extension-changes)
7. [Data Flows](#part-7-data-flows)
8. [Migration Strategy](#part-8-migration-strategy)
9. [Testing Plan](#part-9-testing-plan)
10. [Security Considerations](#part-10-security-considerations)
11. [Future: iOS App Integration](#part-11-future-ios-app-integration)
12. [Checklist](#part-12-implementation-checklist)

---

## Part 1: Architecture Decisions

### Settled Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Local Worktree** | Keep, but secondary | AI agents need filesystem access; Supabase primary for real-time |
| **Authentication** | Supabase Auth (GitHub OAuth) | Single auth system, enables web/mobile later |
| **Repo Registration** | GitHub App installation | Like Vercel/CodeCov; user installs app on repos |
| **GitHub Write Access** | GitHub App tokens | Per-repo access, no user token storage |
| **Source of Truth** | Git (GitHub) | Database is ephemeral cache, rebuildable |
| **Transient Data** | Supabase only | Typing, presence, unread counts not in Git |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      PRODUCTION ARCHITECTURE                         │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    VS CODE EXTENSION                           │  │
│  │                                                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │ chatPanel   │  │ supabase    │  │ gitService          │   │  │
│  │  │ (UI)        │  │ Client      │  │ (local worktree)    │   │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │  │
│  │         │                │                     │              │  │
│  └─────────┼────────────────┼─────────────────────┼──────────────┘  │
│            │                │                     │                  │
│            │ UI Events      │ WebSocket           │ git pull         │
│            │                │                     │ (background)     │
│            ▼                ▼                     ▼                  │
│  ┌─────────────────────────────────────┐  ┌─────────────────────┐  │
│  │         SUPABASE BACKEND            │  │   LOCAL WORKTREE    │  │
│  │                                     │  │                     │  │
│  │  ┌─────────────────────────────┐   │  │  .git/vibechannel-  │  │
│  │  │        Realtime             │   │  │  worktree/          │  │
│  │  │  • WebSocket connections    │   │  │  ├── general/*.md   │  │
│  │  │  • Broadcasts new messages  │   │  │  ├── schema.md      │  │
│  │  │  • Presence updates         │   │  │  └── agent.md       │  │
│  │  └─────────────────────────────┘   │  │                     │  │
│  │                                     │  │  (AI agents read    │  │
│  │  ┌─────────────────────────────┐   │  │   from here)        │  │
│  │  │        Postgres             │   │  └─────────────────────┘  │
│  │  │  • messages (cache)         │   │            ▲               │
│  │  │  • channels                 │   │            │               │
│  │  │  • repos                    │   │            │ git pull      │
│  │  │  • users                    │   │            │               │
│  │  │  • presence (transient)     │   │  ┌────────┴────────────┐  │
│  │  └─────────────────────────────┘   │  │                     │  │
│  │                                     │  │   GITHUB REPO       │  │
│  │  ┌─────────────────────────────┐   │  │   (SOURCE OF TRUTH) │  │
│  │  │      Edge Functions         │   │  │                     │  │
│  │  │  • sync-to-github           │◄──┼──┤   vibechannel       │  │
│  │  │  • webhook-handler          │───┼──►   branch            │  │
│  │  │  • rebuild-cache            │   │  │                     │  │
│  │  └─────────────────────────────┘   │  └─────────────────────┘  │
│  │                                     │            ▲               │
│  │  ┌─────────────────────────────┐   │            │               │
│  │  │         Auth                │   │            │ Webhooks      │
│  │  │  • GitHub OAuth             │   │            │               │
│  │  │  • Session management       │   │  ┌────────┴────────────┐  │
│  │  └─────────────────────────────┘   │  │                     │  │
│  │                                     │  │   GITHUB APP        │  │
│  └─────────────────────────────────────┘  │   (Installation     │  │
│                                            │    Tokens)          │  │
│                                            └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **VS Code Extension** | UI, local worktree management, Supabase client |
| **Supabase Realtime** | WebSocket connections, instant message delivery |
| **Supabase Postgres** | Message cache, user data, repo registry |
| **Supabase Edge Functions** | GitHub API operations, webhook handling |
| **Supabase Auth** | User authentication via GitHub OAuth |
| **GitHub App** | Repo access tokens, webhook events |
| **GitHub Repo** | Source of truth (vibechannel branch) |
| **Local Worktree** | AI agent filesystem access, offline fallback |

---

## Part 2: GitHub App Setup

### 2.1 Create GitHub App

**Location:** https://github.com/settings/apps/new

**App Settings:**

| Setting | Value |
|---------|-------|
| **GitHub App name** | VibeChannel |
| **Homepage URL** | https://vibechannel.dev (or your domain) |
| **Webhook URL** | `https://<project-ref>.supabase.co/functions/v1/webhook-handler` |
| **Webhook secret** | Generate secure random string |

**Permissions:**

| Permission | Access | Why |
|------------|--------|-----|
| **Repository: Contents** | Read & Write | Create/read .md files |
| **Repository: Metadata** | Read | Required for all apps |

**Subscribe to Events:**

- [x] Installation
- [x] Push

**Where can this GitHub App be installed?**
- [x] Any account

### 2.2 After Creation

**Save these values securely:**

```env
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxx
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

### 2.3 App Installation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                 GITHUB APP INSTALLATION                      │
│                                                              │
│  1. User clicks "Connect Repository" in VibeChannel          │
│                                                              │
│  2. Opens: github.com/apps/vibechannel/installations/new     │
│                                                              │
│  3. User selects:                                            │
│     ○ All repositories                                       │
│     ● Only select repositories                               │
│       [x] lucasygu/my-project                                │
│       [x] lucasygu/another-repo                              │
│                                                              │
│  4. User clicks "Install"                                    │
│                                                              │
│  5. GitHub sends webhook to our endpoint:                    │
│     POST /functions/v1/webhook-handler                       │
│     {                                                        │
│       "action": "created",                                   │
│       "installation": { "id": 12345678 },                    │
│       "repositories": [                                      │
│         { "id": 111, "full_name": "lucasygu/my-project" },   │
│         { "id": 222, "full_name": "lucasygu/another-repo" }  │
│       ]                                                      │
│     }                                                        │
│                                                              │
│  6. Our webhook handler:                                     │
│     - Creates rows in `repos` table                          │
│     - Links to user via `user_repos` table                   │
│     - Initializes vibechannel branch if needed               │
│                                                              │
│  7. User returns to VibeChannel, repos appear in list        │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Installation Token Generation

```typescript
// How to get a token for repo operations

import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      installationId: installationId,
    },
  });

  return octokit;
}

// Usage:
const octokit = await getInstallationOctokit(12345678);
await octokit.repos.createOrUpdateFileContents({
  owner: 'lucasygu',
  repo: 'my-project',
  path: 'general/message.md',
  message: 'New message',
  content: Buffer.from('message content').toString('base64'),
  branch: 'vibechannel',
});
```

---

## Part 3: Supabase Project Setup

### 3.1 Create Supabase Project

1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Settings:
   - **Name:** vibechannel-prod (or vibechannel-dev for development)
   - **Database Password:** Generate strong password
   - **Region:** Choose closest to target users
   - **Plan:** Free tier for development, Pro for production

### 3.2 Configure Authentication

**Dashboard → Authentication → Providers → GitHub**

| Setting | Value |
|---------|-------|
| **Client ID** | From GitHub OAuth App (NOT GitHub App) |
| **Client Secret** | From GitHub OAuth App |

**Note:** This is a separate OAuth App for user authentication, not the GitHub App for repo access.

**Create OAuth App at:** https://github.com/settings/applications/new

| Setting | Value |
|---------|-------|
| **Application name** | VibeChannel Auth |
| **Homepage URL** | https://vibechannel.dev |
| **Authorization callback URL** | `https://<project-ref>.supabase.co/auth/v1/callback` |

### 3.3 Environment Variables

**Dashboard → Settings → Edge Functions → Secrets**

Add these secrets:

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

### 3.4 Enable Realtime

**Dashboard → Database → Replication**

Enable replication for tables:
- [x] messages
- [x] channels
- [x] presence

### 3.5 Project Structure

```
supabase/
├── config.toml                 # Supabase config
├── migrations/
│   ├── 20251210000000_initial_schema.sql
│   ├── 20251210000001_rls_policies.sql
│   └── 20251210000002_functions.sql
├── functions/
│   ├── sync-to-github/
│   │   └── index.ts
│   ├── webhook-handler/
│   │   └── index.ts
│   ├── rebuild-cache/
│   │   └── index.ts
│   └── _shared/
│       ├── github.ts           # GitHub API helpers
│       ├── markdown.ts         # Message parsing
│       └── supabase.ts         # Supabase client
└── seed.sql                    # Development seed data
```

---

## Part 4: Database Schema

### 4.1 Tables

```sql
-- =============================================================================
-- FILE: supabase/migrations/20251210000000_initial_schema.sql
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
```

### 4.2 Row Level Security

```sql
-- =============================================================================
-- FILE: supabase/migrations/20251210000001_rls_policies.sql
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE unread_counts ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- USERS policies
-- -----------------------------------------------------------------------------

-- Users can read all users (for @mentions, avatars)
CREATE POLICY "Users are viewable by authenticated users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

-- -----------------------------------------------------------------------------
-- REPOS policies
-- -----------------------------------------------------------------------------

-- Users can view repos they have access to
CREATE POLICY "Users can view their repos"
  ON repos FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT repo_id FROM user_repos WHERE user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- USER_REPOS policies
-- -----------------------------------------------------------------------------

-- Users can view their own memberships
CREATE POLICY "Users can view own memberships"
  ON user_repos FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- CHANNELS policies
-- -----------------------------------------------------------------------------

-- Users can view channels in their repos
CREATE POLICY "Users can view channels in their repos"
  ON channels FOR SELECT
  TO authenticated
  USING (
    repo_id IN (
      SELECT repo_id FROM user_repos WHERE user_id = auth.uid()
    )
  );

-- Users can create channels in their repos
CREATE POLICY "Users can create channels in their repos"
  ON channels FOR INSERT
  TO authenticated
  WITH CHECK (
    repo_id IN (
      SELECT repo_id FROM user_repos WHERE user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- MESSAGES policies
-- -----------------------------------------------------------------------------

-- Users can view messages in their repos
CREATE POLICY "Users can view messages in their repos"
  ON messages FOR SELECT
  TO authenticated
  USING (
    channel_id IN (
      SELECT c.id FROM channels c
      JOIN user_repos ur ON ur.repo_id = c.repo_id
      WHERE ur.user_id = auth.uid()
    )
  );

-- Users can send messages to their repos
CREATE POLICY "Users can send messages to their repos"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    channel_id IN (
      SELECT c.id FROM channels c
      JOIN user_repos ur ON ur.repo_id = c.repo_id
      WHERE ur.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- PRESENCE policies
-- -----------------------------------------------------------------------------

-- Users can view presence in their repos
CREATE POLICY "Users can view presence in their repos"
  ON presence FOR SELECT
  TO authenticated
  USING (
    channel_id IN (
      SELECT c.id FROM channels c
      JOIN user_repos ur ON ur.repo_id = c.repo_id
      WHERE ur.user_id = auth.uid()
    )
    OR channel_id IS NULL
  );

-- Users can update their own presence
CREATE POLICY "Users can update own presence"
  ON presence FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- UNREAD_COUNTS policies
-- -----------------------------------------------------------------------------

-- Users can manage their own unread counts
CREATE POLICY "Users can manage own unread counts"
  ON unread_counts FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- SERVICE ROLE bypass (for Edge Functions)
-- -----------------------------------------------------------------------------
-- Edge Functions use service_role key which bypasses RLS
```

### 4.3 Database Functions

```sql
-- =============================================================================
-- FILE: supabase/migrations/20251210000002_functions.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function: Handle new user signup
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, github_id, github_login, github_name, avatar_url, email)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data->>'provider_id')::BIGINT,
    NEW.raw_user_meta_data->>'user_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- -----------------------------------------------------------------------------
-- Function: Increment unread count
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_unread_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- Increment unread count for all users in this channel except sender
  UPDATE unread_counts
  SET unread_count = unread_count + 1
  WHERE channel_id = NEW.channel_id
    AND user_id != NEW.sender_user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION increment_unread_counts();

-- -----------------------------------------------------------------------------
-- Function: Mark channel as read
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_channel_read(p_channel_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO unread_counts (user_id, channel_id, last_read_at, unread_count)
  VALUES (auth.uid(), p_channel_id, NOW(), 0)
  ON CONFLICT (user_id, channel_id)
  DO UPDATE SET
    last_read_at = NOW(),
    unread_count = 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- Function: Update presence
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_presence(
  p_repo_id UUID DEFAULT NULL,
  p_channel_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'online'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO presence (user_id, repo_id, channel_id, status, last_seen)
  VALUES (auth.uid(), p_repo_id, p_channel_id, p_status, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    repo_id = p_repo_id,
    channel_id = p_channel_id,
    status = p_status,
    last_seen = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- Function: Clean up stale presence (run periodically)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM presence
    WHERE last_seen < NOW() - INTERVAL '5 minutes'
    RETURNING *
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Part 5: Edge Functions

### 5.1 Shared Utilities

```typescript
// =============================================================================
// FILE: supabase/functions/_shared/github.ts
// =============================================================================

import { createAppAuth } from 'https://esm.sh/@octokit/auth-app@6.0.0';
import { Octokit } from 'https://esm.sh/@octokit/rest@20.0.0';

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const privateKey = Deno.env.get('GITHUB_APP_PRIVATE_KEY')!.replace(/\\n/g, '\n');

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: Deno.env.get('GITHUB_APP_ID'),
      privateKey: privateKey,
      installationId: installationId,
    },
  });

  return octokit;
}

export function generateMessageFilename(sender: string, createdAt: Date): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');

  const randomId = Array.from({ length: 6 }, () =>
    '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('');

  return `${timestamp}-${sender}-${randomId}.md`;
}

export function generateMessageContent(message: {
  sender: string;
  content: string;
  createdAt: string;
  replyTo?: string;
  tags?: string[];
}): string {
  const frontmatterLines = [
    '---',
    `from: ${message.sender}`,
    `date: ${message.createdAt}`,
  ];

  if (message.replyTo) {
    frontmatterLines.push(`reply_to: ${message.replyTo}`);
  }

  if (message.tags && message.tags.length > 0) {
    frontmatterLines.push(`tags: [${message.tags.join(', ')}]`);
  }

  frontmatterLines.push('---');

  return `${frontmatterLines.join('\n')}\n\n${message.content}\n`;
}
```

```typescript
// =============================================================================
// FILE: supabase/functions/_shared/markdown.ts
// =============================================================================

import { parse as parseYaml } from 'https://deno.land/std@0.208.0/yaml/mod.ts';

export interface ParsedMessage {
  frontmatter: {
    from: string;
    date: string;
    reply_to?: string;
    tags?: string[];
  };
  content: string;
}

export function parseMessageFile(fileContent: string): ParsedMessage | null {
  const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return null;
  }

  try {
    const frontmatter = parseYaml(frontmatterMatch[1]) as ParsedMessage['frontmatter'];
    const content = frontmatterMatch[2].trim();

    return { frontmatter, content };
  } catch {
    return null;
  }
}
```

```typescript
// =============================================================================
// FILE: supabase/functions/_shared/supabase.ts
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

export function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

export function getUserClient(authHeader: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );
}
```

### 5.2 sync-to-github Function

```typescript
// =============================================================================
// FILE: supabase/functions/sync-to-github/index.ts
// =============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { getInstallationOctokit, generateMessageFilename, generateMessageContent } from '../_shared/github.ts';

interface MessageRecord {
  id: string;
  channel_id: string;
  sender: string;
  content: string;
  created_at: string;
  reply_to_path?: string;
  tags?: string[];
}

serve(async (req: Request) => {
  try {
    const { record, type } = await req.json();

    // Only process inserts
    if (type !== 'INSERT') {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const message: MessageRecord = record;
    const supabase = getServiceClient();

    // Get channel and repo info
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select(`
        name,
        repo:repos (
          id,
          owner,
          name,
          vibechannel_branch,
          github_installation_id
        )
      `)
      .eq('id', message.channel_id)
      .single();

    if (channelError || !channel) {
      throw new Error(`Channel not found: ${channelError?.message}`);
    }

    const repo = channel.repo as any;

    // Get GitHub client for this installation
    const octokit = await getInstallationOctokit(repo.github_installation_id);

    // Generate filename and path
    const filename = generateMessageFilename(message.sender, new Date(message.created_at));
    const filepath = `${channel.name}/${filename}`;

    // Generate markdown content
    const content = generateMessageContent({
      sender: message.sender,
      content: message.content,
      createdAt: message.created_at,
      replyTo: message.reply_to_path,
      tags: message.tags,
    });

    // Create file in GitHub
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: repo.owner,
      repo: repo.name,
      path: filepath,
      message: `Message in #${channel.name}`,
      content: btoa(content),
      branch: repo.vibechannel_branch,
    });

    // Update message with GitHub info
    await supabase
      .from('messages')
      .update({
        github_path: filepath,
        github_sha: response.data.content?.sha,
        github_synced: true,
        synced_at: new Date().toISOString(),
      })
      .eq('id', message.id);

    return new Response(
      JSON.stringify({ success: true, path: filepath }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('sync-to-github error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

### 5.3 webhook-handler Function

```typescript
// =============================================================================
// FILE: supabase/functions/webhook-handler/index.ts
// =============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { verify } from 'https://esm.sh/@octokit/webhooks-methods@4.0.0';
import { getServiceClient } from '../_shared/supabase.ts';
import { getInstallationOctokit } from '../_shared/github.ts';
import { parseMessageFile } from '../_shared/markdown.ts';

serve(async (req: Request) => {
  const signature = req.headers.get('x-hub-signature-256');
  const event = req.headers.get('x-github-event');
  const body = await req.text();

  // Verify webhook signature
  const secret = Deno.env.get('GITHUB_WEBHOOK_SECRET')!;
  const isValid = await verify(secret, body, signature || '');

  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(body);
  const supabase = getServiceClient();

  try {
    switch (event) {
      case 'installation':
        await handleInstallation(supabase, payload);
        break;
      case 'installation_repositories':
        await handleInstallationRepositories(supabase, payload);
        break;
      case 'push':
        await handlePush(supabase, payload);
        break;
      default:
        console.log(`Unhandled event: ${event}`);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (error) {
    console.error(`Webhook error (${event}):`, error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// -----------------------------------------------------------------------------
// Installation handlers
// -----------------------------------------------------------------------------

async function handleInstallation(supabase: any, payload: any) {
  const { action, installation, repositories } = payload;

  if (action === 'created') {
    // New installation - add all repos
    for (const repo of repositories || []) {
      await upsertRepo(supabase, installation.id, repo);
    }
  } else if (action === 'deleted') {
    // Installation removed - delete all repos for this installation
    await supabase
      .from('repos')
      .delete()
      .eq('github_installation_id', installation.id);
  }
}

async function handleInstallationRepositories(supabase: any, payload: any) {
  const { action, installation, repositories_added, repositories_removed } = payload;

  if (action === 'added') {
    for (const repo of repositories_added || []) {
      await upsertRepo(supabase, installation.id, repo);
    }
  } else if (action === 'removed') {
    for (const repo of repositories_removed || []) {
      await supabase
        .from('repos')
        .delete()
        .eq('github_repo_id', repo.id);
    }
  }
}

async function upsertRepo(supabase: any, installationId: number, repo: any) {
  const [owner, name] = repo.full_name.split('/');

  await supabase.from('repos').upsert({
    github_installation_id: installationId,
    github_repo_id: repo.id,
    owner,
    name,
    full_name: repo.full_name,
    default_branch: repo.default_branch || 'main',
  }, {
    onConflict: 'github_repo_id',
  });
}

// -----------------------------------------------------------------------------
// Push handler (external commits)
// -----------------------------------------------------------------------------

async function handlePush(supabase: any, payload: any) {
  const branch = payload.ref.replace('refs/heads/', '');
  const repoId = payload.repository.id;

  // Get repo from database
  const { data: repo, error } = await supabase
    .from('repos')
    .select('*')
    .eq('github_repo_id', repoId)
    .single();

  if (error || !repo) {
    console.log(`Repo not found for push: ${repoId}`);
    return;
  }

  // Only process vibechannel branch
  if (branch !== repo.vibechannel_branch) {
    return;
  }

  const octokit = await getInstallationOctokit(repo.github_installation_id);

  // Process each commit
  for (const commit of payload.commits) {
    const files = [...(commit.added || []), ...(commit.modified || [])];

    for (const filepath of files) {
      // Only process .md files in channel folders
      if (!filepath.endsWith('.md')) continue;
      if (!filepath.includes('/')) continue; // Skip root files
      if (filepath.startsWith('.')) continue; // Skip hidden files

      const channelName = filepath.split('/')[0];

      // Skip schema.md, agent.md, README.md
      if (['schema.md', 'agent.md', 'README.md'].includes(filepath.split('/').pop()!)) {
        continue;
      }

      // Get or create channel
      let { data: channel } = await supabase
        .from('channels')
        .select('id')
        .eq('repo_id', repo.id)
        .eq('name', channelName)
        .single();

      if (!channel) {
        const { data: newChannel } = await supabase
          .from('channels')
          .insert({ repo_id: repo.id, name: channelName })
          .select('id')
          .single();
        channel = newChannel;
      }

      // Fetch file content from GitHub
      const { data: fileData } = await octokit.repos.getContent({
        owner: repo.owner,
        repo: repo.name,
        path: filepath,
        ref: branch,
      });

      if (!('content' in fileData)) continue;

      const content = atob(fileData.content);
      const parsed = parseMessageFile(content);

      if (!parsed) {
        console.log(`Could not parse message: ${filepath}`);
        continue;
      }

      // Upsert message
      await supabase.from('messages').upsert({
        channel_id: channel.id,
        sender: parsed.frontmatter.from,
        content: parsed.content,
        created_at: parsed.frontmatter.date,
        reply_to_path: parsed.frontmatter.reply_to,
        tags: parsed.frontmatter.tags,
        github_path: filepath,
        github_sha: fileData.sha,
        github_synced: true,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'channel_id,github_path',
      });
    }

    // Handle deleted files
    for (const filepath of commit.removed || []) {
      if (!filepath.endsWith('.md')) continue;

      await supabase
        .from('messages')
        .delete()
        .eq('github_path', filepath);
    }
  }
}
```

### 5.4 rebuild-cache Function

```typescript
// =============================================================================
// FILE: supabase/functions/rebuild-cache/index.ts
// =============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { getInstallationOctokit } from '../_shared/github.ts';
import { parseMessageFile } from '../_shared/markdown.ts';

serve(async (req: Request) => {
  try {
    const { repo_id } = await req.json();

    if (!repo_id) {
      return new Response(
        JSON.stringify({ error: 'repo_id required' }),
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Get repo info
    const { data: repo, error: repoError } = await supabase
      .from('repos')
      .select('*')
      .eq('id', repo_id)
      .single();

    if (repoError || !repo) {
      return new Response(
        JSON.stringify({ error: 'Repo not found' }),
        { status: 404 }
      );
    }

    const octokit = await getInstallationOctokit(repo.github_installation_id);

    // List all files in vibechannel branch
    let tree;
    try {
      const { data: treeData } = await octokit.git.getTree({
        owner: repo.owner,
        repo: repo.name,
        tree_sha: repo.vibechannel_branch,
        recursive: 'true',
      });
      tree = treeData.tree;
    } catch (error) {
      // Branch doesn't exist yet
      return new Response(
        JSON.stringify({ success: true, message: 'Branch not initialized' }),
        { status: 200 }
      );
    }

    const results = {
      channels_created: 0,
      messages_synced: 0,
      messages_deleted: 0,
      errors: [] as string[],
    };

    // Track which github_paths we see
    const seenPaths = new Set<string>();

    // Process each file
    for (const item of tree) {
      if (item.type !== 'blob') continue;
      if (!item.path?.endsWith('.md')) continue;
      if (!item.path.includes('/')) continue;
      if (item.path.startsWith('.')) continue;

      const parts = item.path.split('/');
      if (parts.length !== 2) continue;

      const [channelName, filename] = parts;

      // Skip special files
      if (['schema.md', 'agent.md', 'README.md', '.gitkeep'].includes(filename)) {
        continue;
      }

      seenPaths.add(item.path);

      try {
        // Get or create channel
        let { data: channel } = await supabase
          .from('channels')
          .select('id')
          .eq('repo_id', repo.id)
          .eq('name', channelName)
          .single();

        if (!channel) {
          const { data: newChannel } = await supabase
            .from('channels')
            .insert({ repo_id: repo.id, name: channelName })
            .select('id')
            .single();
          channel = newChannel;
          results.channels_created++;
        }

        // Fetch file content
        const { data: fileData } = await octokit.repos.getContent({
          owner: repo.owner,
          repo: repo.name,
          path: item.path,
          ref: repo.vibechannel_branch,
        });

        if (!('content' in fileData)) continue;

        const content = atob(fileData.content);
        const parsed = parseMessageFile(content);

        if (!parsed) {
          results.errors.push(`Could not parse: ${item.path}`);
          continue;
        }

        // Upsert message
        await supabase.from('messages').upsert({
          channel_id: channel.id,
          sender: parsed.frontmatter.from,
          content: parsed.content,
          created_at: parsed.frontmatter.date,
          reply_to_path: parsed.frontmatter.reply_to,
          tags: parsed.frontmatter.tags,
          github_path: item.path,
          github_sha: item.sha,
          github_synced: true,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: 'channel_id,github_path',
        });

        results.messages_synced++;

      } catch (error) {
        results.errors.push(`Error processing ${item.path}: ${error.message}`);
      }
    }

    // Delete messages that no longer exist in GitHub
    const { data: allMessages } = await supabase
      .from('messages')
      .select('id, github_path, channel:channels!inner(repo_id)')
      .eq('channel.repo_id', repo.id);

    for (const msg of allMessages || []) {
      if (!seenPaths.has(msg.github_path)) {
        await supabase.from('messages').delete().eq('id', msg.id);
        results.messages_deleted++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200 }
    );

  } catch (error) {
    console.error('rebuild-cache error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }
});
```

### 5.5 Database Trigger for sync-to-github

```sql
-- =============================================================================
-- Add to: supabase/migrations/20251210000002_functions.sql
-- =============================================================================

-- Create a trigger to call sync-to-github Edge Function on new messages
-- Note: This uses pg_net extension for HTTP calls

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION notify_sync_to_github()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the Edge Function
  PERFORM net.http_post(
    url := CONCAT(
      current_setting('app.settings.supabase_url'),
      '/functions/v1/sync-to-github'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', CONCAT('Bearer ', current_setting('app.settings.service_role_key'))
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'record', row_to_json(NEW)
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_sync_to_github
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.github_synced = FALSE)
  EXECUTE FUNCTION notify_sync_to_github();
```

---

## Part 6: VS Code Extension Changes

### 6.1 New Files

```
extension/src/
├── supabase/
│   ├── client.ts           # Supabase client initialization
│   ├── auth.ts             # Authentication handling
│   ├── realtime.ts         # WebSocket subscriptions
│   └── types.ts            # TypeScript types for database
├── services/
│   ├── messageService.ts   # Send/receive messages via Supabase
│   ├── presenceService.ts  # Presence updates
│   └── repoService.ts      # Repo management
└── ...existing files...
```

### 6.2 Supabase Client

```typescript
// =============================================================================
// FILE: extension/src/supabase/client.ts
// =============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as vscode from 'vscode';
import { Database } from './types';

const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

let supabaseClient: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseClient) {
    supabaseClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        storage: {
          getItem: (key) => {
            // Use VS Code's secure storage
            return vscode.workspace.getConfiguration('vibechannel').get(key) || null;
          },
          setItem: (key, value) => {
            vscode.workspace.getConfiguration('vibechannel').update(key, value, true);
          },
          removeItem: (key) => {
            vscode.workspace.getConfiguration('vibechannel').update(key, undefined, true);
          },
        },
      },
    });
  }
  return supabaseClient;
}

export function resetSupabaseClient(): void {
  supabaseClient = null;
}
```

### 6.3 Authentication Service

```typescript
// =============================================================================
// FILE: extension/src/supabase/auth.ts
// =============================================================================

import * as vscode from 'vscode';
import { getSupabaseClient } from './client';
import { User } from '@supabase/supabase-js';

export class SupabaseAuthService implements vscode.Disposable {
  private static instance: SupabaseAuthService | undefined;
  private readonly _onAuthStateChange = new vscode.EventEmitter<User | null>();
  readonly onAuthStateChange = this._onAuthStateChange.event;

  private currentUser: User | null = null;
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    this.initialize();
  }

  static getInstance(): SupabaseAuthService {
    if (!SupabaseAuthService.instance) {
      SupabaseAuthService.instance = new SupabaseAuthService();
    }
    return SupabaseAuthService.instance;
  }

  private async initialize(): Promise<void> {
    const supabase = getSupabaseClient();

    // Check for existing session
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      this.currentUser = session.user;
      this._onAuthStateChange.fire(session.user);
    }

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        this.currentUser = session?.user || null;
        this._onAuthStateChange.fire(this.currentUser);
      }
    );

    // Store subscription for cleanup
    this.disposables.push({
      dispose: () => subscription.unsubscribe(),
    });
  }

  async signIn(): Promise<User | null> {
    const supabase = getSupabaseClient();

    // Start OAuth flow
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: 'vscode://lucasygu.vibechannel/auth/callback',
        scopes: 'read:user',
      },
    });

    if (error) {
      vscode.window.showErrorMessage(`Sign in failed: ${error.message}`);
      return null;
    }

    // Open browser for OAuth
    if (data.url) {
      await vscode.env.openExternal(vscode.Uri.parse(data.url));
    }

    // Note: The actual session will be established via the callback URI handler
    return this.currentUser;
  }

  async signOut(): Promise<void> {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    this.currentUser = null;
    this._onAuthStateChange.fire(null);
  }

  getUser(): User | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this._onAuthStateChange.dispose();
    SupabaseAuthService.instance = undefined;
  }
}
```

### 6.4 Realtime Service

```typescript
// =============================================================================
// FILE: extension/src/supabase/realtime.ts
// =============================================================================

import * as vscode from 'vscode';
import { getSupabaseClient } from './client';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { Database } from './types';

type Message = Database['public']['Tables']['messages']['Row'];
type Presence = Database['public']['Tables']['presence']['Row'];

export interface RealtimeEvents {
  onMessage: (message: Message) => void;
  onPresence: (presence: Presence[]) => void;
}

export class RealtimeService implements vscode.Disposable {
  private static instance: RealtimeService | undefined;
  private channels: Map<string, RealtimeChannel> = new Map();

  private constructor() {}

  static getInstance(): RealtimeService {
    if (!RealtimeService.instance) {
      RealtimeService.instance = new RealtimeService();
    }
    return RealtimeService.instance;
  }

  subscribeToChannel(
    channelId: string,
    callbacks: RealtimeEvents
  ): void {
    const supabase = getSupabaseClient();

    // Unsubscribe from existing if any
    this.unsubscribeFromChannel(channelId);

    const channel = supabase
      .channel(`channel:${channelId}`)
      // Listen for new messages
      .on<Message>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload: RealtimePostgresChangesPayload<Message>) => {
          if (payload.new) {
            callbacks.onMessage(payload.new as Message);
          }
        }
      )
      // Listen for presence updates
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const presenceList = Object.values(state).flat() as Presence[];
        callbacks.onPresence(presenceList);
      })
      .subscribe();

    this.channels.set(channelId, channel);
  }

  unsubscribeFromChannel(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.unsubscribe();
      this.channels.delete(channelId);
    }
  }

  async updatePresence(
    channelId: string,
    status: 'online' | 'away' | 'typing'
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (channel) {
      await channel.track({ status, channel_id: channelId });
    }
  }

  dispose(): void {
    for (const channel of this.channels.values()) {
      channel.unsubscribe();
    }
    this.channels.clear();
    RealtimeService.instance = undefined;
  }
}
```

### 6.5 Message Service

```typescript
// =============================================================================
// FILE: extension/src/services/messageService.ts
// =============================================================================

import { getSupabaseClient } from '../supabase/client';
import { SupabaseAuthService } from '../supabase/auth';
import { Database } from '../supabase/types';

type Message = Database['public']['Tables']['messages']['Row'];
type MessageInsert = Database['public']['Tables']['messages']['Insert'];

export class MessageService {
  private static instance: MessageService | undefined;

  static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  async sendMessage(
    channelId: string,
    content: string,
    replyToId?: string
  ): Promise<Message | null> {
    const supabase = getSupabaseClient();
    const auth = SupabaseAuthService.getInstance();
    const user = auth.getUser();

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Get user's github_login from users table
    const { data: userData } = await supabase
      .from('users')
      .select('github_login')
      .eq('id', user.id)
      .single();

    if (!userData) {
      throw new Error('User profile not found');
    }

    const messageData: MessageInsert = {
      channel_id: channelId,
      sender: userData.github_login,
      sender_user_id: user.id,
      content,
      created_at: new Date().toISOString(),
      github_path: '', // Will be set by Edge Function
      github_synced: false,
    };

    if (replyToId) {
      messageData.reply_to_id = replyToId;
    }

    const { data, error } = await supabase
      .from('messages')
      .insert(messageData)
      .select()
      .single();

    if (error) {
      console.error('Failed to send message:', error);
      throw error;
    }

    return data;
  }

  async getMessages(
    channelId: string,
    limit = 50,
    before?: string
  ): Promise<Message[]> {
    const supabase = getSupabaseClient();

    let query = supabase
      .from('messages')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to get messages:', error);
      return [];
    }

    return data?.reverse() || [];
  }

  async searchMessages(
    repoId: string,
    query: string
  ): Promise<Message[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        channel:channels!inner(repo_id)
      `)
      .eq('channel.repo_id', repoId)
      .textSearch('content', query)
      .limit(50);

    if (error) {
      console.error('Failed to search messages:', error);
      return [];
    }

    return data || [];
  }
}
```

### 6.6 Modified syncService.ts

```typescript
// =============================================================================
// FILE: extension/src/syncService.ts (MODIFIED)
// =============================================================================

import * as vscode from 'vscode';
import { GitService } from './gitService';
import { RealtimeService } from './supabase/realtime';
import { SupabaseAuthService } from './supabase/auth';

export type SyncEventType =
  | 'newMessages'
  | 'syncStart'
  | 'syncComplete'
  | 'syncError'
  | 'connected'
  | 'disconnected';

export interface SyncEvent {
  type: SyncEventType;
  data?: unknown;
}

export class SyncService implements vscode.Disposable {
  private static instance: SyncService | undefined;
  private gitService: GitService;
  private realtimeService: RealtimeService;
  private gitPollInterval: NodeJS.Timeout | null = null;
  private gitPollIntervalMs = 30000; // 30 seconds for background git sync

  private readonly _onSync = new vscode.EventEmitter<SyncEvent>();
  readonly onSync = this._onSync.event;

  private constructor() {
    this.gitService = GitService.getInstance();
    this.realtimeService = RealtimeService.getInstance();
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  /**
   * Start syncing for a channel
   * - Subscribe to Supabase Realtime for instant updates
   * - Start background git pull for AI agent worktree
   */
  async start(channelId: string): Promise<void> {
    const auth = SupabaseAuthService.getInstance();

    if (!auth.isAuthenticated()) {
      console.log('SyncService: Not authenticated, skipping Realtime');
      return;
    }

    // Subscribe to Realtime for instant updates
    this.realtimeService.subscribeToChannel(channelId, {
      onMessage: (message) => {
        this._onSync.fire({ type: 'newMessages', data: message });
      },
      onPresence: (presence) => {
        // Handle presence updates
      },
    });

    this._onSync.fire({ type: 'connected' });

    // Start background git sync (for AI agent worktree)
    this.startGitSync();
  }

  /**
   * Background git sync to keep local worktree updated
   * This is for AI agents, not for the UI
   */
  private startGitSync(): void {
    if (this.gitPollInterval) return;

    this.gitPollInterval = setInterval(async () => {
      if (!this.gitService.isInitialized()) return;
      if (!this.gitService.hasRemote()) return;

      try {
        const fetched = await this.gitService.fetch();
        if (fetched) {
          const hasChanges = await this.gitService.hasRemoteChanges();
          if (hasChanges) {
            await this.gitService.pull();
            console.log('SyncService: Git worktree updated for AI agents');
          }
        }
      } catch (error) {
        console.error('SyncService: Git sync error:', error);
      }
    }, this.gitPollIntervalMs);
  }

  stop(): void {
    if (this.gitPollInterval) {
      clearInterval(this.gitPollInterval);
      this.gitPollInterval = null;
    }
    this._onSync.fire({ type: 'disconnected' });
  }

  reset(): void {
    this.stop();
  }

  dispose(): void {
    this.stop();
    this._onSync.dispose();
    SyncService.instance = undefined;
  }
}
```

### 6.7 TypeScript Types

```typescript
// =============================================================================
// FILE: extension/src/supabase/types.ts
// =============================================================================

export interface Database {
  public: {
    Tables: {
      repos: {
        Row: {
          id: string;
          github_installation_id: number;
          github_repo_id: number;
          owner: string;
          name: string;
          full_name: string;
          default_branch: string;
          vibechannel_branch: string;
          vibechannel_initialized: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['repos']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['repos']['Insert']>;
      };
      users: {
        Row: {
          id: string;
          github_id: number;
          github_login: string;
          github_name: string | null;
          avatar_url: string | null;
          email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      user_repos: {
        Row: {
          user_id: string;
          repo_id: string;
          role: 'admin' | 'member' | 'viewer';
          joined_at: string;
        };
        Insert: Omit<Database['public']['Tables']['user_repos']['Row'], 'joined_at'>;
        Update: Partial<Database['public']['Tables']['user_repos']['Insert']>;
      };
      channels: {
        Row: {
          id: string;
          repo_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['channels']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['channels']['Insert']>;
      };
      messages: {
        Row: {
          id: string;
          channel_id: string;
          sender: string;
          sender_user_id: string | null;
          content: string;
          reply_to_id: string | null;
          reply_to_path: string | null;
          tags: string[] | null;
          github_path: string;
          github_sha: string | null;
          github_synced: boolean;
          synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['messages']['Row'], 'id' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
      };
      presence: {
        Row: {
          user_id: string;
          repo_id: string | null;
          channel_id: string | null;
          status: 'online' | 'away' | 'typing' | 'offline';
          last_seen: string;
        };
        Insert: Database['public']['Tables']['presence']['Row'];
        Update: Partial<Database['public']['Tables']['presence']['Insert']>;
      };
      unread_counts: {
        Row: {
          user_id: string;
          channel_id: string;
          last_read_message_id: string | null;
          last_read_at: string | null;
          unread_count: number;
        };
        Insert: Omit<Database['public']['Tables']['unread_counts']['Row'], 'unread_count'>;
        Update: Partial<Database['public']['Tables']['unread_counts']['Insert']>;
      };
    };
  };
}
```

---

## Part 7: Data Flows

### 7.1 User Sign In Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      USER SIGN IN                            │
│                                                              │
│  1. User clicks "Sign In" in VS Code                         │
│     └─► Opens browser: supabase.auth.signInWithOAuth         │
│                                                              │
│  2. Browser shows GitHub OAuth consent                       │
│     └─► User clicks "Authorize"                              │
│                                                              │
│  3. GitHub redirects to Supabase callback                    │
│     └─► Supabase creates session, redirects to VS Code URI   │
│                                                              │
│  4. VS Code handles URI: vscode://lucasygu.vibechannel/...   │
│     └─► Extension extracts session tokens                    │
│                                                              │
│  5. Supabase Auth trigger creates user in users table        │
│     └─► handle_new_user() copies GitHub profile              │
│                                                              │
│  6. User is now authenticated                                │
│     └─► Extension shows user's repos                         │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Repository Connection Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   CONNECT REPOSITORY                         │
│                                                              │
│  1. User opens workspace with a git repo                     │
│     └─► Extension detects repo, shows "Connect to VC"        │
│                                                              │
│  2. User clicks "Connect Repository"                         │
│     └─► Opens: github.com/apps/vibechannel/installations     │
│                                                              │
│  3. User selects this repo and installs                      │
│     └─► GitHub sends webhook: installation.created           │
│                                                              │
│  4. webhook-handler processes installation                   │
│     └─► Creates row in repos table                           │
│     └─► Creates row in user_repos (links user to repo)       │
│                                                              │
│  5. Extension polls for repo availability                    │
│     └─► Sees repo in user's repo list                        │
│                                                              │
│  6. Extension initializes vibechannel branch (if needed)     │
│     └─► Edge Function creates branch via GitHub API          │
│                                                              │
│  7. User can now send/receive messages                       │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Send Message Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     SEND MESSAGE                             │
│                                                              │
│  1. User types message, clicks Send                          │
│     └─► chatPanel.ts calls messageService.sendMessage()      │
│                                                              │
│  2. MessageService inserts to Supabase                       │
│     └─► INSERT INTO messages (...) VALUES (...)              │
│     └─► github_synced = FALSE                                │
│                                                              │
│  3. Supabase Realtime broadcasts INSERT                      │
│     └─► All connected clients receive message (<100ms)       │
│                                                              │
│  4. Database trigger fires notify_sync_to_github()           │
│     └─► Calls sync-to-github Edge Function                   │
│                                                              │
│  5. sync-to-github Edge Function                             │
│     a. Gets installation token for repo                      │
│     b. Generates filename: {timestamp}-{sender}-{id}.md      │
│     c. Creates markdown content with frontmatter             │
│     d. GitHub API: createOrUpdateFileContents                │
│     e. Updates message: github_synced = TRUE                 │
│                                                              │
│  6. GitHub now has the .md file (source of truth)            │
│                                                              │
│  7. Background: Extension does git pull (for AI agents)      │
│     └─► Local worktree updated                               │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 Receive Message Flow (Real-time)

```
┌─────────────────────────────────────────────────────────────┐
│                   RECEIVE MESSAGE (Real-time)                │
│                                                              │
│  1. Another user sends message                               │
│     └─► INSERT to Supabase messages table                    │
│                                                              │
│  2. Supabase Realtime broadcasts to all subscribers          │
│     └─► WebSocket message to your extension                  │
│                                                              │
│  3. RealtimeService receives message                         │
│     └─► Fires callback: onMessage(message)                   │
│                                                              │
│  4. SyncService fires event                                  │
│     └─► _onSync.fire({ type: 'newMessages', data: message }) │
│                                                              │
│  5. ChatPanel receives event                                 │
│     └─► Updates webview with new message                     │
│                                                              │
│  Total latency: <100ms                                       │
└─────────────────────────────────────────────────────────────┘
```

### 7.5 AI Agent Writes Message Flow

```
┌─────────────────────────────────────────────────────────────┐
│                AI AGENT WRITES MESSAGE                       │
│                                                              │
│  1. AI agent (Claude Code, Cursor) in user's workspace       │
│     └─► Creates .md file in local worktree                   │
│     └─► git add, git commit, git push                        │
│                                                              │
│  2. GitHub receives push                                     │
│     └─► Sends webhook: push event                            │
│                                                              │
│  3. webhook-handler Edge Function                            │
│     a. Verifies webhook signature                            │
│     b. Filters: only vibechannel branch                      │
│     c. For each new .md file:                                │
│        - Fetches content from GitHub API                     │
│        - Parses frontmatter + body                           │
│        - Upserts to messages table                           │
│                                                              │
│  4. Supabase Realtime broadcasts INSERT/UPDATE               │
│     └─► All connected clients receive message                │
│                                                              │
│  5. Result: AI agent's message appears for all users         │
│     └─► No special integration needed                        │
│     └─► Just write .md file and push                         │
└─────────────────────────────────────────────────────────────┘
```

### 7.6 Cache Rebuild Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    CACHE REBUILD                             │
│                                                              │
│  Trigger: Manual or drift detected                           │
│                                                              │
│  1. Admin/system calls rebuild-cache(repo_id)                │
│                                                              │
│  2. Edge Function processes                                  │
│     a. Gets all files from GitHub (git tree API)             │
│     b. For each .md file in channels:                        │
│        - Fetches content                                     │
│        - Parses frontmatter                                  │
│        - Upserts to messages table                           │
│     c. Deletes messages not in GitHub                        │
│                                                              │
│  3. Result: Database 100% matches GitHub                     │
│     └─► Git remains source of truth                          │
│     └─► Any drift is corrected                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 8: Migration Strategy

### 8.1 Overview

The migration from current git-only architecture to Supabase backend should be:
- **Non-breaking**: Existing users can continue using current version
- **Gradual**: Features added incrementally
- **Reversible**: Can fall back to git-only if needed

### 8.2 Migration Phases

```
Phase 0: Preparation (Current)
├── Create GitHub App
├── Set up Supabase project
├── Deploy Edge Functions
└── Test in isolation

Phase 1: Parallel Mode
├── Extension connects to Supabase for real-time
├── Still uses git for sending (writes to local, pushes)
├── Webhook imports git commits to Supabase
├── UI reads from both (Supabase primary, git fallback)
└── No user-facing changes required

Phase 2: Supabase Primary
├── Sending goes through Supabase first
├── Edge Function syncs to GitHub
├── Git becomes background sync only
├── Local worktree maintained for AI agents
└── Can disable git UI indicators

Phase 3: Full Migration
├── Remove git-based sync code
├── Authentication fully via Supabase
├── All features via Supabase (presence, typing, etc.)
└── Git is only for persistence + AI agents
```

### 8.3 Version Strategy

| Version | Architecture | Notes |
|---------|--------------|-------|
| 0.6.x | Current (git-only) | No changes |
| 0.7.0 | Phase 1 (Parallel) | Supabase optional, experimental |
| 0.8.0 | Phase 2 (Supabase Primary) | Supabase required, git background |
| 1.0.0 | Phase 3 (Full) | Production ready |

### 8.4 Data Migration

**Existing repos:** When user connects via GitHub App:
1. webhook-handler creates repo in Supabase
2. User triggers "Import History" (optional)
3. rebuild-cache reads all existing messages from GitHub
4. Messages appear in Supabase cache

**No data loss:** GitHub remains source of truth throughout.

---

## Part 9: Testing Plan

### 9.1 Unit Tests

```
tests/
├── supabase/
│   ├── client.test.ts
│   ├── auth.test.ts
│   └── realtime.test.ts
├── services/
│   ├── messageService.test.ts
│   └── presenceService.test.ts
└── edge-functions/
    ├── sync-to-github.test.ts
    ├── webhook-handler.test.ts
    └── rebuild-cache.test.ts
```

### 9.2 Integration Tests

| Test | Description |
|------|-------------|
| **Auth Flow** | Sign in via GitHub, verify user created |
| **Repo Connection** | Install GitHub App, verify repo in database |
| **Send Message** | Send via extension, verify in Supabase + GitHub |
| **Receive Real-time** | Two clients, one sends, other receives instantly |
| **AI Agent Push** | Push .md via git, verify appears in Supabase |
| **Cache Rebuild** | Add messages to GitHub, rebuild, verify in database |
| **Offline Fallback** | Disconnect Supabase, verify local reads work |

### 9.3 Load Tests

| Scenario | Target |
|----------|--------|
| Concurrent users per channel | 50 |
| Messages per minute per channel | 100 |
| Total repos in system | 1000 |
| Messages per repo | 10,000 |

### 9.4 Security Tests

| Test | Description |
|------|-------------|
| **RLS Bypass** | Verify users can't access other repos' messages |
| **Webhook Verification** | Verify invalid signatures rejected |
| **Token Expiry** | Verify expired tokens handled gracefully |
| **Rate Limiting** | Verify abuse protection works |

---

## Part 10: Security Considerations

### 10.1 Authentication

- **Supabase Auth** handles OAuth securely
- **No user tokens stored** by us (Supabase manages sessions)
- **GitHub App tokens** are short-lived (1 hour)
- **Private key** stored in Supabase secrets (encrypted)

### 10.2 Authorization

- **Row Level Security (RLS)** on all tables
- Users can only access repos they're members of
- Membership determined by GitHub App installation
- Service role key only used in Edge Functions

### 10.3 Data Security

- **Transit:** All connections use HTTPS/WSS
- **At Rest:** Supabase encrypts data at rest
- **Messages:** Not encrypted (intentional - AI agents need to read)
- **Credentials:** Never stored in messages or database

### 10.4 Webhook Security

- **Signature verification** on all GitHub webhooks
- **Webhook secret** stored securely
- **Payload validation** before processing

### 10.5 Rate Limiting

- Supabase has built-in rate limiting
- GitHub App has 5000 requests/hr per installation
- Consider adding application-level rate limiting

---

## Part 11: Future - iOS App Integration

### 11.1 Overview

The iOS app can integrate with the same Supabase backend:

```
┌─────────────────────────────────────────────────────────────┐
│                    MULTI-PLATFORM                            │
│                                                              │
│  VS Code Extension ──┐                                       │
│                      │                                       │
│  iOS App ────────────┼──► Supabase Backend ──► GitHub        │
│                      │                                       │
│  Web App (future) ───┘                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 iOS Changes

| Component | Current | With Supabase |
|-----------|---------|---------------|
| Auth | GitHub OAuth (custom) | Supabase Auth |
| Messages | GitHub API directly | Supabase client |
| Real-time | None | Supabase Realtime |
| Local storage | None | Offline cache |

### 11.3 Shared Code

```
shared/
├── types/           # TypeScript/Swift shared types
├── markdown/        # Message parsing (can port to Swift)
└── api-contracts/   # API response shapes
```

### 11.4 iOS Implementation Notes

```swift
// iOS uses Supabase Swift SDK
import Supabase

let supabase = SupabaseClient(
  supabaseURL: URL(string: "https://your-project.supabase.co")!,
  supabaseKey: "your-anon-key"
)

// Auth
try await supabase.auth.signInWithOAuth(provider: .github)

// Real-time
let channel = supabase.realtime.channel("channel:\(channelId)")
channel.on("postgres_changes", filter: ...)

// Messages
let messages = try await supabase.database
  .from("messages")
  .select()
  .eq("channel_id", channelId)
  .execute()
```

---

## Part 12: Implementation Checklist

### Phase 0: Preparation

- [ ] **GitHub App**
  - [ ] Create GitHub App in GitHub settings
  - [ ] Configure permissions (Contents: Read & Write)
  - [ ] Set webhook URL
  - [ ] Generate and save private key
  - [ ] Save App ID, Client ID, Client Secret

- [ ] **Supabase Project**
  - [ ] Create Supabase project
  - [ ] Configure GitHub OAuth provider
  - [ ] Add secrets (GitHub App credentials)
  - [ ] Enable Realtime for tables

- [ ] **Database**
  - [ ] Run initial schema migration
  - [ ] Run RLS policies migration
  - [ ] Run functions migration
  - [ ] Test RLS policies

- [ ] **Edge Functions**
  - [ ] Deploy sync-to-github
  - [ ] Deploy webhook-handler
  - [ ] Deploy rebuild-cache
  - [ ] Test each function manually

### Phase 1: Parallel Mode

- [ ] **Extension: Supabase Client**
  - [ ] Add @supabase/supabase-js dependency
  - [ ] Create supabase/client.ts
  - [ ] Create supabase/types.ts (generate from Supabase)

- [ ] **Extension: Authentication**
  - [ ] Create supabase/auth.ts
  - [ ] Add URI handler for OAuth callback
  - [ ] Update githubAuth.ts to use Supabase
  - [ ] Add "Sign In with VibeChannel" UI

- [ ] **Extension: Real-time**
  - [ ] Create supabase/realtime.ts
  - [ ] Subscribe to message changes
  - [ ] Update chatPanel to receive real-time updates

- [ ] **Extension: Message Reading**
  - [ ] Create services/messageService.ts
  - [ ] Read messages from Supabase
  - [ ] Fallback to local filesystem

- [ ] **Testing**
  - [ ] Test sign in flow
  - [ ] Test repo connection
  - [ ] Test real-time message receiving
  - [ ] Test fallback to git

### Phase 2: Supabase Primary

- [ ] **Extension: Message Sending**
  - [ ] Send messages via Supabase
  - [ ] Remove direct git commit for messages
  - [ ] Verify sync-to-github works

- [ ] **Extension: Sync Service**
  - [ ] Replace polling with WebSocket
  - [ ] Background git sync for AI agents
  - [ ] Update sync indicators

- [ ] **Extension: Presence**
  - [ ] Create services/presenceService.ts
  - [ ] Track user presence
  - [ ] Show typing indicators

- [ ] **Testing**
  - [ ] Test message send → GitHub sync
  - [ ] Test AI agent push → Supabase sync
  - [ ] Test presence updates
  - [ ] Load test with multiple users

### Phase 3: Full Migration

- [ ] **Cleanup**
  - [ ] Remove old git sync code
  - [ ] Remove old auth code
  - [ ] Update all UI components

- [ ] **Documentation**
  - [ ] Update README
  - [ ] Update CLAUDE.md
  - [ ] Create user documentation

- [ ] **Release**
  - [ ] Version bump to 1.0.0
  - [ ] Publish to marketplace
  - [ ] Announce to users

---

## Appendix: Environment Variables

### Extension (.env or VS Code settings)

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### Supabase Edge Functions (Secrets)

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

### Local Development

```env
# .env.local (git-ignored)
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-local-service-key
```

---

## Appendix: Useful Commands

### Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push

# Generate TypeScript types
supabase gen types typescript --project-id your-project-ref > extension/src/supabase/types.ts

# Deploy Edge Functions
supabase functions deploy sync-to-github
supabase functions deploy webhook-handler
supabase functions deploy rebuild-cache

# View logs
supabase functions logs sync-to-github
```

### Testing webhooks locally

```bash
# Use smee.io for webhook forwarding
npx smee -u https://smee.io/your-channel -t http://localhost:54321/functions/v1/webhook-handler
```

---

*End of Implementation Plan*
