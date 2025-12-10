import * as vscode from 'vscode';
import { GitService, PushResult } from './gitService';
import { isSupabaseConfigured } from './supabase/client';
import { RealtimeService, RealtimeCallbacks } from './supabase/realtime';
import { SupabaseAuthService } from './supabase/auth';
import { Message } from './supabase/types';

export type SyncEventType =
  | 'newMessages'
  | 'syncStart'
  | 'syncComplete'
  | 'syncError'
  | 'pushComplete'
  | 'pushError'
  | 'readOnlyMode'
  | 'realtimeConnected'
  | 'realtimeDisconnected'
  | 'realtimeMessage';

export interface SyncEvent {
  type: SyncEventType;
  data?: unknown;
}

export class SyncService implements vscode.Disposable {
  private static instance: SyncService | undefined;
  private pollInterval: NodeJS.Timeout | null = null;
  private gitService: GitService;
  private intervalMs: number;
  private autoPush: boolean;
  private pendingPush = false;

  // Supabase realtime
  private realtimeService: RealtimeService | null = null;
  private currentChannelId: string | null = null;
  private useSupabase: boolean = false;

  private readonly _onSync = new vscode.EventEmitter<SyncEvent>();
  readonly onSync = this._onSync.event;

  private constructor() {
    this.gitService = GitService.getInstance();

    const config = vscode.workspace.getConfiguration('vibechannel');
    this.intervalMs = (config.get<number>('syncInterval') || 10) * 1000;
    this.autoPush = config.get<boolean>('autoPush') ?? true;
    this.useSupabase = config.get<boolean>('useSupabase') ?? false;

    // Initialize realtime service if Supabase is configured
    if (isSupabaseConfigured() && this.useSupabase) {
      this.realtimeService = RealtimeService.getInstance();
    }

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vibechannel.syncInterval')) {
        const newConfig = vscode.workspace.getConfiguration('vibechannel');
        const newInterval = (newConfig.get<number>('syncInterval') || 10) * 1000;
        if (newInterval !== this.intervalMs) {
          this.intervalMs = newInterval;
          if (this.pollInterval) {
            this.stop();
            this.start();
          }
        }
      }
      if (e.affectsConfiguration('vibechannel.autoPush')) {
        const newConfig = vscode.workspace.getConfiguration('vibechannel');
        this.autoPush = newConfig.get<boolean>('autoPush') ?? true;
      }
      if (e.affectsConfiguration('vibechannel.useSupabase')) {
        const newConfig = vscode.workspace.getConfiguration('vibechannel');
        this.useSupabase = newConfig.get<boolean>('useSupabase') ?? false;
        if (isSupabaseConfigured() && this.useSupabase && !this.realtimeService) {
          this.realtimeService = RealtimeService.getInstance();
        }
      }
    });
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  /**
   * Start syncing
   * - If Supabase is enabled, subscribe to realtime updates
   * - Always start git polling for AI agent worktree sync
   */
  start(): void {
    if (this.pollInterval) return;

    console.log(`SyncService: Starting with ${this.intervalMs}ms interval`);
    this.sync();
    this.pollInterval = setInterval(() => this.sync(), this.intervalMs);
  }

  /**
   * Subscribe to Supabase realtime for a specific channel
   */
  subscribeToChannel(channelId: string): void {
    if (!this.realtimeService || !this.useSupabase) {
      return;
    }

    const auth = SupabaseAuthService.getInstance();
    if (!auth.isAuthenticated()) {
      console.log('SyncService: Cannot subscribe to realtime - not authenticated');
      return;
    }

    // Unsubscribe from previous channel
    if (this.currentChannelId) {
      this.realtimeService.unsubscribeFromChannel(this.currentChannelId);
    }

    this.currentChannelId = channelId;

    const callbacks: RealtimeCallbacks = {
      onMessage: (message: Message) => {
        console.log('SyncService: Received realtime message');
        this._onSync.fire({ type: 'realtimeMessage', data: message });
      },
      onMessageUpdate: (message: Message) => {
        console.log('SyncService: Message updated');
        this._onSync.fire({ type: 'realtimeMessage', data: { ...message, _updated: true } });
      },
      onMessageDelete: (messageId: string) => {
        console.log('SyncService: Message deleted');
        this._onSync.fire({ type: 'realtimeMessage', data: { id: messageId, _deleted: true } });
      },
    };

    this.realtimeService.subscribeToChannel(channelId, callbacks);
    this._onSync.fire({ type: 'realtimeConnected' });
    console.log(`SyncService: Subscribed to channel ${channelId}`);
  }

  /**
   * Unsubscribe from current channel
   */
  unsubscribeFromChannel(): void {
    if (this.realtimeService && this.currentChannelId) {
      this.realtimeService.unsubscribeFromChannel(this.currentChannelId);
      this.currentChannelId = null;
      this._onSync.fire({ type: 'realtimeDisconnected' });
    }
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('SyncService: Stopped');
    }
    this.unsubscribeFromChannel();
  }

  /**
   * Reset the sync service state (called when switching repos)
   */
  reset(): void {
    this.stop();
    this.pendingPush = false;
    this.currentChannelId = null;
    console.log('SyncService: Reset');
  }

  private async sync(): Promise<void> {
    if (!this.gitService.isInitialized()) return;
    if (!this.gitService.hasRemote()) return;

    try {
      this._onSync.fire({ type: 'syncStart' });

      const fetched = await this.gitService.fetch();
      if (!fetched) {
        this._onSync.fire({ type: 'syncComplete' });
        return;
      }

      const hasChanges = await this.gitService.hasRemoteChanges();
      if (hasChanges) {
        const pulled = await this.gitService.pull();
        if (pulled) {
          const commitHash = this.gitService.getHeadCommit();
          this._onSync.fire({ type: 'newMessages', data: { commitHash } });
        }
      }

      if (this.pendingPush && this.autoPush) {
        await this.pushNow();
      }

      this._onSync.fire({ type: 'syncComplete' });
    } catch (error) {
      console.error('SyncService: Sync error:', error);
      this._onSync.fire({ type: 'syncError', data: error });
    }
  }

  async queuePush(): Promise<void> {
    this.pendingPush = true;
    if (this.autoPush) {
      await this.pushNow();
    }
  }

  private async pushNow(): Promise<void> {
    try {
      const result: PushResult = await this.gitService.push();

      if (result.success) {
        this.pendingPush = false;
        this._onSync.fire({ type: 'pushComplete' });
      } else if (result.noRemote) {
        this.pendingPush = false;
        console.log('SyncService: No remote configured, message saved locally only');
      } else if (result.noPermission) {
        this.pendingPush = false;
        console.log('SyncService: No write permission, entering read-only mode');
        this._onSync.fire({ type: 'readOnlyMode', data: { reason: 'no-permission' } });
      } else {
        this._onSync.fire({ type: 'pushError', data: result.error || 'Push failed' });
      }
    } catch (error) {
      this._onSync.fire({ type: 'pushError', data: error });
    }
  }

  async forcePush(): Promise<boolean> {
    const result = await this.gitService.push();
    if (result.success) this.pendingPush = false;
    return result.success;
  }

  async forceSync(): Promise<void> {
    await this.sync();
  }

  /**
   * Check if Supabase realtime is enabled and connected
   */
  isRealtimeEnabled(): boolean {
    return this.useSupabase && isSupabaseConfigured() && SupabaseAuthService.getInstance().isAuthenticated();
  }

  /**
   * Get the current channel ID being subscribed to
   */
  getCurrentChannelId(): string | null {
    return this.currentChannelId;
  }

  dispose(): void {
    this.stop();
    this._onSync.dispose();
    SyncService.instance = undefined;
  }
}
