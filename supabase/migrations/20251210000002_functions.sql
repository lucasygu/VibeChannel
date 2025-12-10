-- =============================================================================
-- VibeChannel Database Functions
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

-- -----------------------------------------------------------------------------
-- Enable pg_net extension for HTTP calls from triggers
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;

-- -----------------------------------------------------------------------------
-- Function: Notify sync-to-github Edge Function
-- Note: This requires app.settings.supabase_url and app.settings.service_role_key
-- to be set in the database configuration
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_sync_to_github()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Get settings (these need to be configured in database settings)
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);

  -- Only proceed if settings are configured
  IF supabase_url IS NOT NULL AND service_role_key IS NOT NULL THEN
    -- Call the Edge Function
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/sync-to-github',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object(
        'type', TG_OP,
        'record', row_to_json(NEW)
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_sync_to_github
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.github_synced = FALSE)
  EXECUTE FUNCTION notify_sync_to_github();
