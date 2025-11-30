import * as vscode from 'vscode';
import { GitService, PushResult } from './gitService';

export type SyncEventType =
  | 'newMessages'
  | 'syncStart'
  | 'syncComplete'
  | 'syncError'
  | 'pushComplete'
  | 'pushError'
  | 'readOnlyMode';

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

  private readonly _onSync = new vscode.EventEmitter<SyncEvent>();
  readonly onSync = this._onSync.event;

  private constructor() {
    this.gitService = GitService.getInstance();

    const config = vscode.workspace.getConfiguration('vibechannel');
    this.intervalMs = (config.get<number>('syncInterval') || 10) * 1000;
    this.autoPush = config.get<boolean>('autoPush') ?? true;

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
    });
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  start(): void {
    if (this.pollInterval) return;

    console.log(`SyncService: Starting with ${this.intervalMs}ms interval`);
    this.sync();
    this.pollInterval = setInterval(() => this.sync(), this.intervalMs);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('SyncService: Stopped');
    }
  }

  /**
   * Reset the sync service state (called when switching repos)
   */
  reset(): void {
    this.stop();
    this.pendingPush = false;
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

  dispose(): void {
    this.stop();
    this._onSync.dispose();
    SyncService.instance = undefined;
  }
}
