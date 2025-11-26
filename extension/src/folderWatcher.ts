import * as vscode from 'vscode';
import * as path from 'path';
import { isMessageFile } from './messageParser';

export type WatcherEvent = 'create' | 'change' | 'delete';

export interface WatcherCallback {
  (event: WatcherEvent, filepath: string): void;
}

/**
 * Watches a VibeChannel folder for changes to message files
 */
export class FolderWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private folderPath: string;
  private callback: WatcherCallback;
  private debounceTimer: NodeJS.Timeout | undefined;
  private debounceDelay: number;
  private pendingChanges: Map<string, WatcherEvent> = new Map();

  constructor(
    folderPath: string,
    callback: WatcherCallback,
    debounceDelay: number = 300
  ) {
    this.folderPath = folderPath;
    this.callback = callback;
    this.debounceDelay = debounceDelay;
  }

  /**
   * Start watching the folder
   */
  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    const pattern = new vscode.RelativePattern(
      this.folderPath,
      '*.md'
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate((uri) => {
      this.handleChange('create', uri);
    });

    this.watcher.onDidChange((uri) => {
      this.handleChange('change', uri);
    });

    this.watcher.onDidDelete((uri) => {
      this.handleChange('delete', uri);
    });
  }

  /**
   * Stop watching the folder
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = undefined;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    this.pendingChanges.clear();
  }

  /**
   * Handle a file change event
   */
  private handleChange(event: WatcherEvent, uri: vscode.Uri): void {
    const filename = path.basename(uri.fsPath);

    // Ignore non-message files
    if (!isMessageFile(filename)) {
      return;
    }

    // Add to pending changes (newer events overwrite older ones)
    this.pendingChanges.set(uri.fsPath, event);

    // Debounce the callback
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushPendingChanges();
    }, this.debounceDelay);
  }

  /**
   * Process all pending changes
   */
  private flushPendingChanges(): void {
    for (const [filepath, event] of this.pendingChanges) {
      try {
        this.callback(event, filepath);
      } catch (error) {
        console.error(`Error handling ${event} event for ${filepath}:`, error);
      }
    }

    this.pendingChanges.clear();
    this.debounceTimer = undefined;
  }

  /**
   * Dispose of the watcher
   */
  dispose(): void {
    this.stop();
  }
}

/**
 * Create a simple watcher that triggers a callback on any change
 */
export function createSimpleWatcher(
  folderPath: string,
  onChange: () => void,
  debounceDelay: number = 300
): FolderWatcher {
  return new FolderWatcher(
    folderPath,
    () => onChange(),
    debounceDelay
  );
}
