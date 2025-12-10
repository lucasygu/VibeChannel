// =============================================================================
// Message Service for VibeChannel VS Code Extension
// Handles sending and receiving messages via Supabase
// =============================================================================

import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client';
import { SupabaseAuthService } from '../supabase/auth';
import { Message, MessageInsert, Channel } from '../supabase/types';

/**
 * Service for message operations via Supabase
 */
export class MessageService {
  private static instance: MessageService | undefined;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  /**
   * Send a message to a channel
   * Returns the created message or null on error
   */
  async sendMessage(
    channelId: string,
    content: string,
    replyToId?: string
  ): Promise<Message | null> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase not configured');
    }

    const supabase = getSupabaseClient();
    const auth = SupabaseAuthService.getInstance();
    const user = auth.getUser();

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Get user's github_login from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('github_login')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      throw new Error('User profile not found');
    }

    const messageData: MessageInsert = {
      channel_id: channelId,
      sender: (userData as { github_login: string }).github_login,
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
      .insert(messageData as never)
      .select()
      .single();

    if (error) {
      console.error('Failed to send message:', error);
      throw error;
    }

    return data as Message | null;
  }

  /**
   * Get messages for a channel
   * Returns messages in chronological order (oldest first)
   */
  async getMessages(
    channelId: string,
    limit: number = 50,
    before?: string
  ): Promise<Message[]> {
    if (!isSupabaseConfigured()) {
      return [];
    }

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

    // Return in chronological order (oldest first)
    return ((data as Message[] | null) || []).reverse();
  }

  /**
   * Get a single message by ID
   */
  async getMessage(messageId: string): Promise<Message | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (error) {
      console.error('Failed to get message:', error);
      return null;
    }

    return data as Message | null;
  }

  /**
   * Search messages in a repo
   */
  async searchMessages(
    repoId: string,
    query: string,
    limit: number = 50
  ): Promise<Message[]> {
    if (!isSupabaseConfigured()) {
      return [];
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        channel:channels!inner(repo_id)
      `)
      .eq('channel.repo_id', repoId)
      .textSearch('content', query)
      .limit(limit);

    if (error) {
      console.error('Failed to search messages:', error);
      return [];
    }

    return (data as Message[]) || [];
  }

  /**
   * Get channels for a repo
   */
  async getChannels(repoId: string): Promise<Pick<Channel, 'id' | 'name' | 'description'>[]> {
    if (!isSupabaseConfigured()) {
      return [];
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('channels')
      .select('id, name, description')
      .eq('repo_id', repoId)
      .order('name');

    if (error) {
      console.error('Failed to get channels:', error);
      return [];
    }

    return (data as Pick<Channel, 'id' | 'name' | 'description'>[]) || [];
  }

  /**
   * Create a new channel
   */
  async createChannel(
    repoId: string,
    name: string,
    description?: string
  ): Promise<Pick<Channel, 'id' | 'name'> | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('channels')
      .insert({ repo_id: repoId, name, description } as never)
      .select('id, name')
      .single();

    if (error) {
      console.error('Failed to create channel:', error);
      throw error;
    }

    return data as Pick<Channel, 'id' | 'name'> | null;
  }

  /**
   * Mark a channel as read for the current user
   */
  async markChannelAsRead(channelId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    const supabase = getSupabaseClient();

    // Use raw query since rpc typing is complex
    const { error } = await supabase.rpc('mark_channel_read', {
      p_channel_id: channelId,
    } as never);

    if (error) {
      console.error('Failed to mark channel as read:', error);
    }
  }

  /**
   * Get unread counts for all channels in a repo
   */
  async getUnreadCounts(repoId: string): Promise<Map<string, number>> {
    if (!isSupabaseConfigured()) {
      return new Map();
    }

    const supabase = getSupabaseClient();
    const auth = SupabaseAuthService.getInstance();
    const user = auth.getUser();

    if (!user) {
      return new Map();
    }

    const { data, error } = await supabase
      .from('unread_counts')
      .select(`
        channel_id,
        unread_count,
        channel:channels!inner(repo_id)
      `)
      .eq('user_id', user.id)
      .eq('channel.repo_id', repoId);

    if (error) {
      console.error('Failed to get unread counts:', error);
      return new Map();
    }

    const counts = new Map<string, number>();
    for (const row of (data as Array<{ channel_id: string; unread_count: number }>) || []) {
      counts.set(row.channel_id, row.unread_count);
    }

    return counts;
  }
}
