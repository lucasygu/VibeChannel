-- =============================================================================
-- VibeChannel Row Level Security Policies
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
