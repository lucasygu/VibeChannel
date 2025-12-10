// =============================================================================
// Supabase Realtime Service for VibeChannel VS Code Extension
// =============================================================================

import * as vscode from 'vscode';
import { getSupabaseClient, isSupabaseConfigured } from './client';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { Message, Presence } from './types';

/**
 * Callbacks for realtime events
 */
export interface RealtimeCallbacks {
  onMessage: (message: Message) => void;
  onMessageUpdate?: (message: Message) => void;
  onMessageDelete?: (messageId: string) => void;
  onPresence?: (presenceList: Presence[]) => void;
}

/**
 * Service for managing Supabase Realtime subscriptions
 */
export class RealtimeService implements vscode.Disposable {
  private static instance: RealtimeService | undefined;
  private channels: Map<string, RealtimeChannel> = new Map();
  private callbacks: Map<string, RealtimeCallbacks> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): RealtimeService {
    if (!RealtimeService.instance) {
      RealtimeService.instance = new RealtimeService();
    }
    return RealtimeService.instance;
  }

  /**
   * Subscribe to real-time updates for a channel
   */
  subscribeToChannel(channelId: string, callbacks: RealtimeCallbacks): void {
    if (!isSupabaseConfigured()) {
      console.log('RealtimeService: Supabase not configured, skipping subscription');
      return;
    }

    // Unsubscribe from existing if any
    this.unsubscribeFromChannel(channelId);

    const supabase = getSupabaseClient();

    // Create realtime channel
    const channel = supabase
      .channel(`channel:${channelId}`)
      // Listen for new messages (INSERT)
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
            console.log('RealtimeService: New message received');
            callbacks.onMessage(payload.new as Message);
          }
        }
      )
      // Listen for message updates
      .on<Message>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload: RealtimePostgresChangesPayload<Message>) => {
          if (payload.new && callbacks.onMessageUpdate) {
            console.log('RealtimeService: Message updated');
            callbacks.onMessageUpdate(payload.new as Message);
          }
        }
      )
      // Listen for message deletes
      .on<Message>(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload: RealtimePostgresChangesPayload<Message>) => {
          if (payload.old && callbacks.onMessageDelete) {
            console.log('RealtimeService: Message deleted');
            callbacks.onMessageDelete((payload.old as Message).id);
          }
        }
      )
      .subscribe((status) => {
        console.log(`RealtimeService: Channel ${channelId} subscription status:`, status);
      });

    this.channels.set(channelId, channel);
    this.callbacks.set(channelId, callbacks);
  }

  /**
   * Subscribe to presence updates for a channel
   */
  async subscribeToPresence(channelId: string, userId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    const channel = this.channels.get(channelId);
    if (!channel) {
      console.warn('RealtimeService: Cannot subscribe to presence - channel not subscribed');
      return;
    }

    // Track our own presence
    await channel.track({
      user_id: userId,
      channel_id: channelId,
      status: 'online',
      online_at: new Date().toISOString(),
    });
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribeFromChannel(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.unsubscribe();
      this.channels.delete(channelId);
      this.callbacks.delete(channelId);
      console.log(`RealtimeService: Unsubscribed from channel ${channelId}`);
    }
  }

  /**
   * Update presence status
   */
  async updatePresence(
    channelId: string,
    status: 'online' | 'away' | 'typing'
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    const channel = this.channels.get(channelId);
    if (channel) {
      await channel.track({
        status,
        channel_id: channelId,
        updated_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Get current presence state for a channel
   */
  getPresenceState(channelId: string): Record<string, unknown>[] {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return [];
    }

    const state = channel.presenceState();
    return Object.values(state).flat();
  }

  /**
   * Unsubscribe from all channels
   */
  unsubscribeAll(): void {
    for (const channelId of this.channels.keys()) {
      this.unsubscribeFromChannel(channelId);
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.unsubscribeAll();
    RealtimeService.instance = undefined;
  }
}
