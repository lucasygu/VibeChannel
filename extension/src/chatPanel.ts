import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { Conversation, loadConversation, updateConversationMessage, removeConversationMessage } from './conversationLoader';
import { loadSchema } from './schemaParser';
import { FolderWatcher, WatcherEvent } from './folderWatcher';
import { Message } from './messageParser';
import { marked } from 'marked';
import { GitHubAuthService, GitHubUser } from './githubAuth';
import { GitService } from './gitService';
import { SyncService } from './syncService';
import { NotificationService } from './notificationService';
import { markMessagesAsRead } from './extension';

function createEmptyConversation(folderPath: string): Conversation {
  return {
    folderPath,
    schema: loadSchema(folderPath),
    messages: [],
    errors: [],
    grouped: new Map(),
  };
}

/**
 * Manages the chat webview panel with Slack-like sidebar
 */
export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  public static readonly viewType = 'vibechannelChat';

  private readonly panel: vscode.WebviewPanel;
  private readonly repoPath: string;
  private gitService: GitService;
  private syncService: SyncService;
  private notificationService: NotificationService;
  private channels: string[];
  private currentChannel: string;
  private conversation: Conversation;
  private watcher: FolderWatcher | undefined;
  private disposables: vscode.Disposable[] = [];
  private isReadOnly = false;
  private connectionMode: 'connected' | 'local-only' | 'offline' = 'connected';

  public static async createOrShow(
    repoPath: string,
    connectionMode: 'connected' | 'local-only' | 'offline' = 'connected'
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel for this repo, show it
    if (ChatPanel.currentPanel && ChatPanel.currentPanel.repoPath === repoPath) {
      ChatPanel.currentPanel.connectionMode = connectionMode;
      ChatPanel.currentPanel.panel.reveal(column);
      ChatPanel.currentPanel.update();
      return;
    }

    // Otherwise, dispose the old panel and create a new one
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.dispose();
    }

    // Reset services state before switching repos
    SyncService.getInstance().reset();
    NotificationService.getInstance().reset();

    // Initialize GitService for this repo
    const gitService = GitService.getInstance();
    const initResult = await gitService.initialize(repoPath);

    // Handle no-permission case BEFORE creating panel
    if (!initResult.success && initResult.reason === 'no-permission') {
      if (!initResult.hasRemoteBranch) {
        // No remote branch + no permission = show message, don't create panel
        const action = await vscode.window.showInformationMessage(
          'This repository doesn\'t have a VibeChannel yet, and you don\'t have write access to create one.',
          'Fork Repository',
          'Cancel'
        );

        if (action === 'Fork Repository') {
          const remoteUrl = gitService.getRemoteUrl();
          if (remoteUrl) {
            const forkUrl = ChatPanel.convertToForkUrl(remoteUrl);
            vscode.env.openExternal(vscode.Uri.parse(forkUrl));
          }
        }
        return; // Don't create panel - no local state was created
      }
      // Has remote branch but no permission = proceed with read-only view
      // (this case shouldn't happen with current flow, but handle it)
    }

    // Initialize SyncService
    const syncService = SyncService.getInstance();

    // Get worktree path for resources
    const worktreePath = gitService.getWorktreePath();
    if (!worktreePath) {
      vscode.window.showErrorMessage('VibeChannel: Failed to initialize worktree');
      return;
    }

    // Get list of channels from the worktree
    const channels = ChatPanel.getChannelsFromWorktree(worktreePath);
    const defaultChannel = channels.includes('general') ? 'general' : channels[0] || 'general';

    // Load conversation for the default channel
    const channelPath = path.join(worktreePath, defaultChannel);
    const conversation = fs.existsSync(channelPath)
      ? loadConversation(channelPath)
      : createEmptyConversation(channelPath);

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'VibeChannel',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(worktreePath)],
      }
    );

    ChatPanel.currentPanel = new ChatPanel(panel, repoPath, gitService, syncService, channels, defaultChannel, conversation, connectionMode);
  }

  /**
   * Convert a git remote URL to a GitHub fork URL
   */
  private static convertToForkUrl(repoUrl: string): string {
    // Convert git@github.com:owner/repo.git or https://github.com/owner/repo.git
    // to https://github.com/owner/repo/fork
    const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return `https://github.com/${match[1]}/${match[2]}/fork`;
    }
    return repoUrl;
  }

  private static getChannelsFromWorktree(worktreePath: string): string[] {
    if (!fs.existsSync(worktreePath)) {
      return [];
    }
    return fs.readdirSync(worktreePath)
      .filter((name) => {
        const fullPath = path.join(worktreePath, name);
        return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
      });
  }

  public static refresh(): void {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.refresh();
    }
  }

  public static isPanelVisible(): boolean {
    return ChatPanel.currentPanel?.panel.visible ?? false;
  }

  public static isPanelOpen(): boolean {
    return ChatPanel.currentPanel !== undefined;
  }

  /**
   * Revive an existing webview panel after extension reload
   */
  public static async revive(
    panel: vscode.WebviewPanel,
    repoPath: string,
    savedChannel?: string
  ): Promise<void> {
    // Dispose any existing panel reference (shouldn't happen, but be safe)
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.dispose();
    }

    // Reset SyncService state
    SyncService.getInstance().reset();

    // Initialize GitService for this repo
    const gitService = GitService.getInstance();
    const initResult = await gitService.initialize(repoPath);

    // If no permission and no remote branch, dispose panel and show message
    if (!initResult.success && !initResult.hasRemoteBranch) {
      panel.dispose();
      vscode.window.showWarningMessage(
        'VibeChannel cannot be restored for this repository (no write access and no existing conversations).'
      );
      return;
    }

    // Initialize SyncService
    const syncService = SyncService.getInstance();

    // Get worktree path
    const worktreePath = gitService.getWorktreePath();
    if (!worktreePath) {
      panel.dispose();
      return;
    }

    // Update panel options for the new extension context
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(worktreePath)],
    };

    // Get channels and determine which one to show
    const channels = ChatPanel.getChannelsFromWorktree(worktreePath);
    let currentChannel = savedChannel;
    if (!currentChannel || !channels.includes(currentChannel)) {
      currentChannel = channels.includes('general') ? 'general' : channels[0] || 'general';
    }

    // Load conversation
    const channelPath = path.join(worktreePath, currentChannel);
    const conversation = fs.existsSync(channelPath)
      ? loadConversation(channelPath)
      : createEmptyConversation(channelPath);

    // Create the ChatPanel instance with the existing panel
    ChatPanel.currentPanel = new ChatPanel(
      panel,
      repoPath,
      gitService,
      syncService,
      channels,
      currentChannel,
      conversation
    );

    console.log('VibeChannel: Panel revived successfully');
  }

  private constructor(
    panel: vscode.WebviewPanel,
    repoPath: string,
    gitService: GitService,
    syncService: SyncService,
    channels: string[],
    currentChannel: string,
    conversation: Conversation,
    connectionMode: 'connected' | 'local-only' | 'offline' = 'connected'
  ) {
    this.panel = panel;
    this.repoPath = repoPath;
    this.gitService = gitService;
    this.syncService = syncService;
    this.notificationService = NotificationService.getInstance();
    this.channels = channels;
    this.currentChannel = currentChannel;
    this.conversation = conversation;
    this.connectionMode = connectionMode;

    // Initialize notification tracking for current channel
    this.notificationService.initializeChannel(currentChannel, conversation.messages);

    // Set initial content
    this.update();

    // Mark messages as read since panel is now visible
    markMessagesAsRead();

    // Start file watcher if enabled
    const config = vscode.workspace.getConfiguration('vibechannel');
    if (config.get('watchForChanges', true)) {
      this.startWatcher();
    }

    // Start sync service
    this.syncService.start();

    // Listen for sync events
    this.disposables.push(
      this.syncService.onSync(async (event) => {
        if (event.type === 'newMessages') {
          await this.refreshWithNotification();
        } else if (event.type === 'readOnlyMode') {
          this.enterReadOnlyMode();
        }
      })
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message),
      null,
      this.disposables
    );

    // Handle view state changes
    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) {
          this.update();
          // Mark messages as read when panel becomes visible
          markMessagesAsRead();
        }
      },
      null,
      this.disposables
    );
  }

  private getCurrentChannelPath(): string {
    const worktreePath = this.gitService.getWorktreePath();
    return worktreePath ? path.join(worktreePath, this.currentChannel) : '';
  }

  /**
   * Get list of files in the repo (respects .gitignore)
   * Returns paths relative to repo root
   */
  private async getRepoFiles(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git ls-files', {
        cwd: this.repoPath,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large repos
      });
      return stdout
        .split('\n')
        .filter(Boolean)
        .filter(f => !f.startsWith('.git/')); // Extra safety
    } catch (error) {
      console.error('Failed to list repo files:', error);
      return [];
    }
  }

  private startWatcher(): void {
    this.watcher?.dispose();
    this.watcher = new FolderWatcher(
      this.getCurrentChannelPath(),
      (event: WatcherEvent, filepath: string) => {
        this.handleFileChange(event, filepath);
      }
    );
    this.watcher.start();
  }

  private handleFileChange(event: WatcherEvent, filepath: string): void {
    switch (event) {
      case 'create':
      case 'change':
        this.conversation = updateConversationMessage(this.conversation, filepath);
        break;
      case 'delete':
        this.conversation = removeConversationMessage(this.conversation, filepath);
        break;
    }
    this.update();
  }

  private handleWebviewMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case 'ready':
        this.update();
        break;
      case 'requestRefresh':
        this.refresh();
        break;
      case 'switchChannel':
        if (typeof message.payload === 'string') {
          this.switchChannel(message.payload);
        }
        break;
      case 'createChannel':
        this.promptCreateChannel();
        break;
      case 'openFile':
        if (typeof message.payload === 'string') {
          const filepath = path.join(this.getCurrentChannelPath(), message.payload);
          vscode.workspace.openTextDocument(filepath).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
        }
        break;
      case 'openRepoFile':
        // Open a file from the repo (for @ file references)
        if (typeof message.payload === 'string') {
          const filepath = path.join(this.repoPath, message.payload);
          vscode.workspace.openTextDocument(filepath).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
        }
        break;
      case 'openAsset':
        // Open an asset file from the worktree (for attachments)
        if (typeof message.payload === 'string') {
          const worktreePath = this.gitService.getWorktreePath();
          if (worktreePath) {
            const filepath = path.join(worktreePath, message.payload);
            // Use vscode.env.openExternal for non-text files
            vscode.env.openExternal(vscode.Uri.file(filepath));
          }
        }
        break;
      case 'signIn':
        vscode.commands.executeCommand('vibechannel.signIn');
        break;
      case 'signOut':
        vscode.commands.executeCommand('vibechannel.signOut');
        break;
      case 'getRepoFiles':
        // Return list of files for autocomplete
        this.getRepoFiles().then((files) => {
          this.panel.webview.postMessage({ type: 'repoFiles', payload: files });
        });
        break;
      case 'saveAsset':
        // Save pasted file to .assets folder
        if (message.payload && typeof message.payload === 'object') {
          const { data, extension, isImage } = message.payload as { data: string; extension: string; isImage: boolean };
          if (data && extension) {
            const assetPath = this.gitService.saveAsset(data, extension);
            if (assetPath) {
              this.panel.webview.postMessage({ type: 'assetSaved', payload: { path: assetPath, isImage } });
            }
          }
        }
        break;
      case 'sendMessage':
        if (message.payload && typeof message.payload === 'object') {
          const { content, files, images, attachments, replyTo } = message.payload as {
            content: string;
            files?: string[];
            images?: string[];
            attachments?: string[];
            replyTo?: string;
          };
          const hasContent = content && content.trim();
          const hasFiles = files && files.length > 0;
          const hasImages = images && images.length > 0;
          const hasAttachments = attachments && attachments.length > 0;
          // Allow messages with text, files, images, or attachments (any combination)
          if (hasContent || hasFiles || hasImages || hasAttachments) {
            this.createMessageFile(content?.trim() || '', files, images, attachments, replyTo);
          }
        } else if (typeof message.payload === 'string' && message.payload.trim()) {
          // Backwards compatibility
          this.createMessageFile(message.payload.trim());
        }
        break;
      case 'deleteMessage':
        if (typeof message.payload === 'string') {
          this.deleteMessageFile(message.payload);
        }
        break;
      case 'editMessage':
        if (message.payload && typeof message.payload === 'object') {
          const { filename, content, files, images, attachments } = message.payload as {
            filename: string;
            content: string;
            files?: string[];
            images?: string[];
            attachments?: string[];
          };
          if (filename) {
            this.editMessageFile(filename, content, files, images, attachments);
          }
        }
        break;
    }
  }

  private switchChannel(channelName: string): void {
    if (channelName === this.currentChannel) {
      return;
    }

    this.currentChannel = channelName;
    const channelPath = this.getCurrentChannelPath();
    this.conversation = loadConversation(channelPath);

    // Initialize notification tracking for the new channel
    this.notificationService.initializeChannel(channelName, this.conversation.messages);

    // Restart watcher for new channel
    const config = vscode.workspace.getConfiguration('vibechannel');
    if (config.get('watchForChanges', true)) {
      this.startWatcher();
    }

    this.update();
  }

  private async promptCreateChannel(): Promise<void> {
    const channelName = await vscode.window.showInputBox({
      prompt: 'Enter channel name',
      placeHolder: 'e.g., random, dev-chat, project-ideas',
      validateInput: (value) => {
        if (!value) {
          return 'Channel name is required';
        }
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Channel name can only contain lowercase letters, numbers, and hyphens';
        }
        if (this.channels.includes(value)) {
          return 'Channel already exists';
        }
        return null;
      },
    });

    if (channelName) {
      try {
        await this.gitService.createChannel(channelName);
        const worktreePath = this.gitService.getWorktreePath();
        if (worktreePath) {
          this.channels = ChatPanel.getChannelsFromWorktree(worktreePath);
        }
        this.switchChannel(channelName);
        vscode.window.showInformationMessage(`Created #${channelName} channel`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create channel: ${error}`);
      }
    }
  }

  private async createMessageFile(content: string, files?: string[], images?: string[], attachments?: string[], replyTo?: string): Promise<void> {
    const authService = GitHubAuthService.getInstance();
    const user = authService.getUser();

    if (!user) {
      vscode.window.showErrorMessage('You must be signed in to send messages');
      return;
    }

    try {
      // Generate timestamp for filename: YYYYMMDDTHHMMSS
      const now = new Date();
      const fileTimestamp = now.toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, '')
        .replace('T', 'T');

      // ISO timestamp for frontmatter
      const isoTimestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

      // Sender from GitHub username (lowercase)
      const sender = user.login.toLowerCase();

      // Generate random 6-char ID
      const randomId = crypto.randomBytes(3).toString('hex');

      // Construct filename
      const filename = `${fileTimestamp}-${sender}-${randomId}.md`;
      const channelPath = this.getCurrentChannelPath();

      if (!channelPath) {
        vscode.window.showErrorMessage('Channel path not available');
        return;
      }

      const filepath = path.join(channelPath, filename);

      // Build frontmatter
      let frontmatter = `---
from: ${sender}
date: ${isoTimestamp}`;

      // Add reply_to if this is a reply
      if (replyTo) {
        frontmatter += `\nreply_to: ${replyTo}`;
      }

      // Add file references if present
      if (files && files.length > 0) {
        frontmatter += `\nfiles:`;
        for (const file of files) {
          frontmatter += `\n  - ${file}`;
        }
      }

      // Add images if present
      if (images && images.length > 0) {
        frontmatter += `\nimages:`;
        for (const image of images) {
          frontmatter += `\n  - ${image}`;
        }
      }

      // Add attachments if present
      if (attachments && attachments.length > 0) {
        frontmatter += `\nattachments:`;
        for (const attachment of attachments) {
          frontmatter += `\n  - ${attachment}`;
        }
      }

      frontmatter += `\n---\n\n`;

      // Create file content
      const fileContent = frontmatter + content;

      // Write file
      fs.writeFileSync(filepath, fileContent, 'utf-8');

      // Commit the message using GitService
      await this.gitService.commitChanges(`Message from ${sender}`);

      // Queue push via sync service
      await this.syncService.queuePush();

      // The file watcher will pick up the new file and refresh the view
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create message: ${error}`);
    }
  }

  private async deleteMessageFile(filename: string): Promise<void> {
    const authService = GitHubAuthService.getInstance();
    const user = authService.getUser();

    if (!user) {
      vscode.window.showErrorMessage('You must be signed in to delete messages');
      return;
    }

    try {
      const channelPath = this.getCurrentChannelPath();
      if (!channelPath) {
        vscode.window.showErrorMessage('Channel path not available');
        return;
      }

      const filepath = path.join(channelPath, filename);

      // Verify file exists
      if (!fs.existsSync(filepath)) {
        vscode.window.showErrorMessage('Message file not found');
        return;
      }

      // Delete the file
      fs.unlinkSync(filepath);

      // Commit the deletion using GitService
      const sender = user.login.toLowerCase();
      await this.gitService.commitChanges(`Delete message by ${sender}`);

      // Queue push via sync service
      await this.syncService.queuePush();

      // The file watcher will pick up the deletion and refresh the view
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete message: ${error}`);
    }
  }

  private async editMessageFile(
    filename: string,
    newContent: string,
    newFiles?: string[],
    newImages?: string[],
    newAttachments?: string[]
  ): Promise<void> {
    const authService = GitHubAuthService.getInstance();
    const user = authService.getUser();

    if (!user) {
      vscode.window.showErrorMessage('You must be signed in to edit messages');
      return;
    }

    try {
      const channelPath = this.getCurrentChannelPath();
      if (!channelPath) {
        vscode.window.showErrorMessage('Channel path not available');
        return;
      }

      const filepath = path.join(channelPath, filename);

      // Verify file exists
      if (!fs.existsSync(filepath)) {
        vscode.window.showErrorMessage('Message file not found');
        return;
      }

      // Read and parse the existing file
      const existingContent = fs.readFileSync(filepath, 'utf-8');
      const matter = require('gray-matter');
      const parsed = matter(existingContent);

      // Update the edited timestamp
      const editedDate = new Date();
      parsed.data.edited = editedDate.toISOString();

      // Rebuild the file with updated content
      let frontmatter = '---';
      frontmatter += `\nfrom: ${parsed.data.from}`;
      frontmatter += `\ndate: ${parsed.data.date}`;
      if (parsed.data.reply_to) {
        frontmatter += `\nreply_to: ${parsed.data.reply_to}`;
      }
      if (parsed.data.tags && parsed.data.tags.length > 0) {
        frontmatter += `\ntags:`;
        for (const tag of parsed.data.tags) {
          frontmatter += `\n  - ${tag}`;
        }
      }
      // Use new files/images/attachments if provided, otherwise keep original
      const files = newFiles !== undefined ? newFiles : parsed.data.files;
      const images = newImages !== undefined ? newImages : parsed.data.images;
      const attachments = newAttachments !== undefined ? newAttachments : parsed.data.attachments;

      if (files && files.length > 0) {
        frontmatter += `\nfiles:`;
        for (const file of files) {
          frontmatter += `\n  - ${file}`;
        }
      }
      if (images && images.length > 0) {
        frontmatter += `\nimages:`;
        for (const image of images) {
          frontmatter += `\n  - ${image}`;
        }
      }
      if (attachments && attachments.length > 0) {
        frontmatter += `\nattachments:`;
        for (const attachment of attachments) {
          frontmatter += `\n  - ${attachment}`;
        }
      }
      frontmatter += `\nedited: ${parsed.data.edited}`;
      frontmatter += `\n---\n\n`;

      const fileContent = frontmatter + newContent;

      // Write the updated file
      fs.writeFileSync(filepath, fileContent, 'utf-8');

      // Commit the edit using GitService
      const sender = user.login.toLowerCase();
      await this.gitService.commitChanges(`Edit message by ${sender}`);

      // Queue push via sync service
      await this.syncService.queuePush();

      // The file watcher will pick up the change and refresh the view
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to edit message: ${error}`);
    }
  }

  public refresh(): void {
    // Check if GitService is in read-only mode
    if (this.gitService.isReadOnly() && !this.isReadOnly) {
      this.enterReadOnlyMode();
    }

    // Refresh channels list from worktree
    const worktreePath = this.gitService.getWorktreePath();
    if (worktreePath) {
      this.channels = ChatPanel.getChannelsFromWorktree(worktreePath);
    }

    // Refresh conversation
    const channelPath = this.getCurrentChannelPath();
    if (channelPath) {
      this.conversation = fs.existsSync(channelPath)
        ? loadConversation(channelPath)
        : createEmptyConversation(channelPath);
    }
    this.update();
  }

  /**
   * Refresh and check for new message notifications.
   * Called when sync detects new messages from remote.
   */
  private async refreshWithNotification(): Promise<void> {
    // Refresh the conversation
    this.refresh();

    // Check for new messages and notify if appropriate
    await this.notificationService.checkAndNotify(
      this.currentChannel,
      this.conversation.messages,
      this.panel.visible
    );
  }

  /**
   * Enter read-only mode - called when push fails due to permission error.
   * Shows a banner and disables message input.
   */
  private enterReadOnlyMode(): void {
    if (this.isReadOnly) return;

    this.isReadOnly = true;
    console.log('ChatPanel: Entering read-only mode');

    // Show a warning message to the user
    vscode.window.showWarningMessage(
      'You don\'t have write access to this repository. VibeChannel is in read-only mode.',
      'Learn More'
    ).then((action) => {
      if (action === 'Learn More') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/lucasygu/VibeChannel#permissions'));
      }
    });

    // Refresh to show updated UI with read-only banner
    this.update();
  }

  private update(): void {
    this.panel.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview(): string {
    const config = vscode.workspace.getConfiguration('vibechannel');
    const timestampDisplay = config.get('timestampDisplay', 'relative');
    const authService = GitHubAuthService.getInstance();
    const user = authService.getUser();
    const cspSource = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: ${cspSource} data:;">
  <title>VibeChannel</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="app-container">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>VibeChannel</h2>
        <div class="auth-section">
          ${user ? this.renderSidebarUserInfo(user) : this.renderSidebarSignIn()}
        </div>
      </div>
      <div class="channels-section">
        <div class="channels-header">
          <span>Channels</span>
          <button class="add-channel-btn" id="addChannelBtn" title="Create new channel">+</button>
        </div>
        <ul class="channel-list">
          ${this.renderChannelList()}
        </ul>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <header class="chat-header">
        <h1>#${this.escapeHtml(this.currentChannel)}</h1>
        <span class="message-count">${this.conversation.messages.length} messages</span>
      </header>

      ${this.renderConnectionBanner()}

      <div class="messages-container" id="messagesContainer">
        ${this.renderMessages(timestampDisplay === 'relative')}
      </div>

      ${this.conversation.errors.length > 0 ? this.renderErrors() : ''}

      <div class="input-area">
        ${this.isReadOnly
          ? this.renderReadOnlyInput()
          : (user ? this.renderInputField(user) : this.renderInputDisabled())}
      </div>
    </main>
  </div>

  <!-- Custom context menu for messages -->
  <div class="context-menu" id="contextMenu">
    <div class="context-menu-item" id="contextReply">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M6 3v2H2v6h4v2l4-5-4-5zm1 1.5L9.5 8 7 11.5V10H3V6h4V4.5z"/>
      </svg>
      <span>Reply</span>
    </div>
    <div class="context-menu-item" id="contextCopy">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M4 4h8v8H4V4zm1 1v6h6V5H5zm-3-3v10h2V3H3V2h2V1H2v1H1v11h11v-1h1V2h-1V1H3v1H2z"/>
      </svg>
      <span>Copy</span>
    </div>
    <div class="context-menu-item" id="contextOpenFile">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M3.5 1.5v13h9v-9l-4-4h-5zm1 1h3.5v3.5h3.5v7.5h-7v-11zm4.5.71l2.29 2.29h-2.29v-2.29z"/>
      </svg>
      <span>Open Source File</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" id="contextEdit">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/>
      </svg>
      <span>Edit Message</span>
    </div>
    <div class="context-menu-item context-menu-danger" id="contextDelete">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M5.5 5.5v7h1v-7h-1zm4 0v7h1v-7h-1zm-5-4v1H2v1h1v10.5l.5.5h9l.5-.5V3.5h1v-1h-2.5v-1h-6zm1 1h4v1h-4v-1zM4 3.5h8V13H4V3.5z"/>
      </svg>
      <span>Delete Message</span>
    </div>
  </div>

  <script>
    ${this.getScript(!!user, user?.login.toLowerCase() || '', this.repoPath, this.currentChannel)}
  </script>
</body>
</html>`;
  }

  private renderChannelList(): string {
    return this.channels
      .map((channel) => {
        const isActive = channel === this.currentChannel;
        return `<li class="channel-item ${isActive ? 'active' : ''}" data-channel="${this.escapeHtml(channel)}">
          <span class="channel-hash">#</span>
          <span class="channel-name">${this.escapeHtml(channel)}</span>
        </li>`;
      })
      .join('');
  }

  private renderSidebarUserInfo(user: GitHubUser): string {
    return `<div class="sidebar-user">
      <img class="sidebar-avatar" src="${this.escapeHtml(user.avatarUrl)}" alt="${this.escapeHtml(user.login)}" />
      <span class="sidebar-username">${this.escapeHtml(user.login)}</span>
    </div>`;
  }

  private renderSidebarSignIn(): string {
    return `<button class="sidebar-sign-in" id="sidebarSignInBtn">Sign in</button>`;
  }

  private renderConnectionBanner(): string {
    // Read-only mode takes precedence
    if (this.isReadOnly) {
      return `<div class="connection-banner connection-banner-warning">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
        <span>
          <strong>Read-only mode:</strong> You don't have write access to this repository.
        </span>
      </div>`;
    }

    switch (this.connectionMode) {
      case 'local-only':
        return `<div class="connection-banner connection-banner-info">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6zm10 0h2v2h-2zm-6-4h8v2h-8z"/>
          </svg>
          <span>
            <strong>Local-only mode:</strong> No remote repository configured. Messages are stored locally only.
          </span>
        </div>`;

      case 'offline':
        return `<div class="connection-banner connection-banner-warning">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M24 8.98C20.93 5.9 16.69 4 12 4S3.07 5.9 0 8.98L12 21 24 8.98zM2.92 9.07C5.51 7.08 8.67 6 12 6s6.49 1.08 9.08 3.07l-1.43 1.43C17.5 8.94 14.86 8 12 8s-5.5.94-7.65 2.51L2.92 9.07zM12 18.17l-7.07-7.07C6.94 9.54 9.38 8.5 12 8.5s5.06 1.04 7.07 2.6L12 18.17z"/>
            <path d="M12 4C7.31 4 3.07 5.9 0 8.98L1.42 10.4C4.02 7.8 7.87 6 12 6s7.98 1.8 10.58 4.4l1.42-1.42C20.93 5.9 16.69 4 12 4z" opacity="0.3"/>
            <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2"/>
          </svg>
          <span>
            <strong>Offline mode:</strong> Cannot connect to remote. Messages will sync when connection is restored.
          </span>
        </div>`;

      default:
        return ''; // Connected - no banner
    }
  }

  private renderMessages(relativeTime: boolean): string {
    if (this.conversation.messages.length === 0) {
      return `<div class="empty-state">
        <p>No messages in #${this.escapeHtml(this.currentChannel)}</p>
        <p class="hint">Be the first to send a message!</p>
      </div>`;
    }

    if (this.conversation.grouped) {
      return this.renderGroupedMessages(relativeTime);
    }

    return this.conversation.messages
      .map((message) => this.renderMessage(message, relativeTime))
      .join('');
  }

  private renderGroupedMessages(relativeTime: boolean): string {
    if (!this.conversation.grouped) {
      return '';
    }

    const html: string[] = [];

    for (const [date, messages] of this.conversation.grouped) {
      html.push(`<div class="date-separator">${this.formatDateSeparator(date)}</div>`);
      for (const message of messages) {
        html.push(this.renderMessage(message, relativeTime));
      }
    }

    return html.join('');
  }

  private renderMessage(message: Message, relativeTime: boolean): string {
    const timestamp = relativeTime
      ? this.formatRelativeTime(message.date)
      : this.formatAbsoluteTime(message.date);

    const renderedContent = this.renderMarkdown(message.content);
    const colorClass = this.getSenderColorClass(message.from);

    const editedTimestamp = message.edited
      ? `<span class="edited-indicator" title="Edited ${message.edited.toISOString()}">(edited ${relativeTime ? this.formatRelativeTime(message.edited) : this.formatAbsoluteTime(message.edited)})</span>`
      : '';

    // Encode arrays as JSON for data attributes (escape for HTML attribute)
    const filesData = this.escapeHtml(JSON.stringify(message.files || []));
    const imagesData = this.escapeHtml(JSON.stringify(message.images || []));
    const attachmentsData = this.escapeHtml(JSON.stringify(message.attachments || []));

    return `<div class="message ${colorClass}" data-filename="${this.escapeHtml(message.filename)}" data-sender="${this.escapeHtml(message.from)}" data-content="${this.escapeHtml(message.content)}" data-files="${filesData}" data-images="${imagesData}" data-attachments="${attachmentsData}">
      <div class="message-header">
        <span class="sender">${this.escapeHtml(message.from)}</span>
        <span class="timestamp" title="${message.date.toISOString()}">${timestamp}</span>
        ${editedTimestamp}
        ${message.replyTo ? this.renderReplyPreview(message.replyTo) : ''}
      </div>
      ${message.files && message.files.length > 0 ? this.renderFiles(message.files) : ''}
      ${message.images && message.images.length > 0 ? this.renderImages(message.images) : ''}
      <div class="message-content">${renderedContent}</div>
      ${message.attachments && message.attachments.length > 0 ? this.renderAttachments(message.attachments) : ''}
      ${message.tags && message.tags.length > 0 ? this.renderTags(message.tags) : ''}
    </div>`;
  }

  /**
   * Render a preview of the message being replied to
   */
  private renderReplyPreview(replyTo: string): string {
    // Find parent message by filename
    const parentMessage = this.conversation.messages.find(m => m.filename === replyTo);

    if (!parentMessage) {
      return `<div class="reply-preview">↩ [deleted message]</div>`;
    }

    // Truncate content (strip markdown, limit to 60 chars)
    const plainText = parentMessage.content
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/!\[.*?\]\(.*?\)/g, '[image]')
      .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
      .replace(/\n/g, ' ')
      .trim();

    const truncated = plainText.length > 60
      ? plainText.slice(0, 60) + '...'
      : plainText;

    return `<div class="reply-preview" data-reply-to="${this.escapeHtml(replyTo)}" title="Click to scroll to original message">
      <span class="reply-icon">↩</span>
      <span class="reply-author">${this.escapeHtml(parentMessage.from)}:</span>
      <span class="reply-text">${this.escapeHtml(truncated)}</span>
    </div>`;
  }

  private renderFiles(files: string[]): string {
    return `<div class="message-files">
      ${files.map((file) => `<span class="file-chip" data-file="${this.escapeHtml(file)}" title="Click to open ${this.escapeHtml(file)}">
        <svg viewBox="0 0 16 16" width="12" height="12" class="file-icon">
          <path fill="currentColor" d="M3.5 1.5v13h9v-9l-4-4h-5zm1 1h3.5v3.5h3.5v7.5h-7v-11zm4.5.71l2.29 2.29h-2.29v-2.29z"/>
        </svg>
        ${this.escapeHtml(path.basename(file))}
      </span>`).join('')}
    </div>`;
  }

  private renderImages(images: string[]): string {
    const worktreePath = this.gitService.getWorktreePath();
    if (!worktreePath) return '';

    return `<div class="message-images">
      ${images.map((imagePath) => {
        // Convert relative path to absolute path in worktree
        const absolutePath = path.join(worktreePath, imagePath);
        // Convert to webview URI
        const imageUri = this.panel.webview.asWebviewUri(vscode.Uri.file(absolutePath));
        return `<div class="message-image-container" data-image="${this.escapeHtml(imagePath)}">
          <img class="message-image" src="${imageUri}" alt="${this.escapeHtml(path.basename(imagePath))}" />
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderAttachments(attachments: string[]): string {
    const worktreePath = this.gitService.getWorktreePath();
    if (!worktreePath) return '';

    return `<div class="message-attachments">
      ${attachments.map((attachmentPath) => {
        const filename = path.basename(attachmentPath);
        const ext = path.extname(filename).toLowerCase().slice(1) || 'file';
        return `<div class="attachment-link" data-attachment="${this.escapeHtml(attachmentPath)}" title="Click to open ${this.escapeHtml(filename)}">
          <svg viewBox="0 0 16 16" width="16" height="16" class="attachment-icon">
            <path fill="currentColor" d="M13.5 1h-11l-.5.5v13l.5.5h11l.5-.5v-13l-.5-.5zm-.5 13H3V2h10v12z"/>
            <path fill="currentColor" d="M4 4h8v1H4V4zm0 3h8v1H4V7zm0 3h5v1H4v-1z"/>
          </svg>
          <span class="attachment-name">${this.escapeHtml(filename)}</span>
          <span class="attachment-ext">${ext.toUpperCase()}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderTags(tags: string[]): string {
    return `<div class="message-tags">
      ${tags.map((tag) => `<span class="tag">${this.escapeHtml(tag)}</span>`).join('')}
    </div>`;
  }

  private renderErrors(): string {
    return `<div class="errors">
      <h3>Parse Errors</h3>
      ${this.conversation.errors
        .map(
          (error) =>
            `<div class="error-item">
              <span class="error-file">${this.escapeHtml(error.filename)}</span>
              <span class="error-message">${this.escapeHtml(error.error)}</span>
            </div>`
        )
        .join('')}
    </div>`;
  }

  private renderInputField(user: GitHubUser): string {
    return `<div id="replyBar" class="reply-bar" style="display: none;">
      <div class="reply-bar-content">
        <span>↩ Replying to</span>
        <span class="reply-bar-author" id="replyBarAuthor"></span>
        <span class="reply-bar-text" id="replyBarText"></span>
      </div>
      <button class="reply-bar-cancel" id="replyBarCancel" title="Cancel reply">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path fill="currentColor" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
        </svg>
      </button>
    </div>
    <div class="input-wrapper">
      <div class="chips-container">
        <div class="files-chips" id="filesChips"></div>
        <div class="images-chips" id="imagesChips"></div>
        <div class="attachments-chips" id="attachmentsChips"></div>
      </div>
      <div class="input-container">
        <img class="input-avatar" src="${this.escapeHtml(user.avatarUrl)}" alt="${this.escapeHtml(user.login)}" />
        <div class="input-with-autocomplete">
          <textarea
            id="messageInput"
            class="message-input"
            placeholder="Message #${this.escapeHtml(this.currentChannel)} (@ files, Cmd+V images)"
            rows="1"
          ></textarea>
          <div class="autocomplete-dropdown" id="autocompleteDropdown"></div>
        </div>
        <div class="send-buttons" id="sendButtons">
          <button class="send-btn" id="sendBtn" title="Send message (Cmd+Enter)">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
        <div class="edit-buttons hidden" id="editButtons">
          <button class="cancel-btn" id="cancelEditBtn" title="Cancel edit (Escape)">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
          <button class="confirm-btn" id="confirmEditBtn" title="Confirm edit (Cmd+Enter)">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>`;
  }

  private renderInputDisabled(): string {
    return `<div class="input-disabled">
      <span class="input-disabled-text">Sign in to send messages</span>
      <button class="sign-in-btn-small" id="signInBtnInput">Sign in with GitHub</button>
    </div>`;
  }

  private renderReadOnlyInput(): string {
    return `<div class="input-readonly">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span>Read-only mode — you don't have write access to this repository</span>
    </div>`;
  }

  private renderMarkdown(content: string): string {
    try {
      return marked(content, { async: false }) as string;
    } catch {
      return this.escapeHtml(content);
    }
  }

  private getSenderColorClass(sender: string): string {
    let hash = 0;
    for (let i = 0; i < sender.length; i++) {
      hash = ((hash << 5) - hash) + sender.charCodeAt(i);
      hash = hash & hash;
    }
    const colorIndex = Math.abs(hash) % 6;
    return `sender-color-${colorIndex}`;
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return this.formatAbsoluteTime(date);
  }

  private formatAbsoluteTime(date: Date): string {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatDateSeparator(dateStr: string): string {
    // Parse YYYY-MM-DD as local date (not UTC)
    // new Date("YYYY-MM-DD") parses as UTC, which can shift days in local time
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Compare just the date parts (year, month, day) in local time
    const isSameDay = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    if (isSameDay(date, today)) {
      return 'Today';
    }
    if (isSameDay(date, yesterday)) {
      return 'Yesterday';
    }

    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/`/g, '&#96;')
      .replace(/\$/g, '&#36;')
      .replace(/\\/g, '&#92;');
  }

  private getStyles(): string {
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      html, body {
        height: 100%;
        overflow: hidden;
      }

      body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground, #cccccc);
        background-color: var(--vscode-editor-background, #1e1e1e);
        line-height: 1.5;
      }

      .app-container {
        display: flex;
        height: 100vh;
      }

      /* Sidebar Styles */
      .sidebar {
        width: 220px;
        background-color: var(--vscode-sideBar-background, #252526);
        border-right: 1px solid var(--vscode-panel-border, #454545);
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
      }

      .sidebar-header {
        padding: 16px;
        border-bottom: 1px solid var(--vscode-panel-border, #454545);
      }

      .sidebar-header h2 {
        font-size: 1.1em;
        font-weight: 600;
        margin-bottom: 12px;
      }

      .auth-section {
        display: flex;
        align-items: center;
      }

      .sidebar-user {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .sidebar-avatar {
        width: 24px;
        height: 24px;
        border-radius: 4px;
      }

      .sidebar-username {
        font-size: 0.85em;
        color: var(--vscode-foreground, #cccccc);
      }

      .sidebar-sign-in {
        padding: 4px 8px;
        font-size: 0.8em;
        background-color: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }

      .sidebar-sign-in:hover {
        background-color: var(--vscode-button-hoverBackground, #1177bb);
      }

      .channels-section {
        flex: 1;
        overflow-y: auto;
        padding: 12px 0;
      }

      .channels-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 16px 8px;
        font-size: 0.75em;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      .add-channel-btn {
        width: 20px;
        height: 20px;
        border: none;
        background: transparent;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        cursor: pointer;
        font-size: 1.2em;
        line-height: 1;
        border-radius: 4px;
      }

      .add-channel-btn:hover {
        background-color: var(--vscode-list-hoverBackground, #2a2d2e);
        color: var(--vscode-foreground, #cccccc);
      }

      .channel-list {
        list-style: none;
      }

      .channel-item {
        display: flex;
        align-items: center;
        padding: 6px 16px;
        cursor: pointer;
        color: var(--vscode-foreground, #cccccc);
        opacity: 0.8;
      }

      .channel-item:hover {
        background-color: var(--vscode-list-hoverBackground, #2a2d2e);
        opacity: 1;
      }

      .channel-item.active {
        background-color: var(--vscode-list-activeSelectionBackground, #094771);
        opacity: 1;
      }

      .channel-hash {
        margin-right: 4px;
        opacity: 0.6;
      }

      .channel-name {
        font-size: 0.95em;
      }

      /* Main Content Styles */
      .main-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .chat-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--vscode-panel-border, #454545);
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .chat-header h1 {
        font-size: 1.2em;
        font-weight: 600;
      }

      .message-count {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      .connection-banner {
        padding: 10px 20px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.85em;
      }

      .connection-banner svg {
        flex-shrink: 0;
      }

      .connection-banner-warning {
        background-color: var(--vscode-inputValidation-warningBackground, #5a4a00);
        border: 1px solid var(--vscode-inputValidation-warningBorder, #856d00);
        color: var(--vscode-inputValidation-warningForeground, #ffffff);
      }

      .connection-banner-info {
        background-color: var(--vscode-inputValidation-infoBackground, #063b49);
        border: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
        color: var(--vscode-inputValidation-infoForeground, #ffffff);
      }

      .connection-banner a {
        color: var(--vscode-textLink-foreground, #3794ff);
        text-decoration: none;
      }

      .connection-banner a:hover {
        text-decoration: underline;
      }

      /* Legacy support */
      .read-only-banner {
        background-color: var(--vscode-inputValidation-warningBackground, #5a4a00);
        border: 1px solid var(--vscode-inputValidation-warningBorder, #856d00);
        color: var(--vscode-inputValidation-warningForeground, #ffffff);
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.9em;
      }

      .read-only-banner svg {
        flex-shrink: 0;
      }

      .read-only-banner a {
        color: var(--vscode-textLink-foreground, #3794ff);
        text-decoration: none;
      }

      .read-only-banner a:hover {
        text-decoration: underline;
      }

      .input-readonly {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        background-color: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border-radius: 8px;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        font-size: 0.9em;
      }

      .input-readonly svg {
        flex-shrink: 0;
        opacity: 0.7;
      }

      .messages-container {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }

      .messages-container > .message:first-child {
        margin-top: 0;
      }

      .message {
        padding: 12px 16px;
        border-radius: 8px;
        background-color: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border-left: 3px solid transparent;
        margin-bottom: 12px;
        transition: background-color 0.3s ease;
      }

      .message.highlight-flash {
        background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.3));
      }

      .sender-color-0 { border-left-color: #4fc3f7; }
      .sender-color-1 { border-left-color: #81c784; }
      .sender-color-2 { border-left-color: #ffb74d; }
      .sender-color-3 { border-left-color: #f06292; }
      .sender-color-4 { border-left-color: #ba68c8; }
      .sender-color-5 { border-left-color: #4db6ac; }

      .message-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .sender {
        font-weight: 600;
        color: var(--vscode-textLink-foreground, #3794ff);
      }

      .timestamp {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      .reply-preview {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        cursor: pointer;
        padding: 4px 8px;
        margin: -4px 0 4px 0;
        background-color: var(--vscode-editor-inactiveSelectionBackground, rgba(255, 255, 255, 0.05));
        border-radius: 4px;
        border-left: 2px solid var(--vscode-textLink-foreground, #3794ff);
        max-width: 100%;
        overflow: hidden;
      }

      .reply-preview:hover {
        background-color: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.1));
      }

      .reply-icon {
        flex-shrink: 0;
        opacity: 0.7;
      }

      .reply-author {
        font-weight: 500;
        flex-shrink: 0;
      }

      .reply-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Reply bar above input when replying */
      .reply-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background-color: var(--vscode-editor-inactiveSelectionBackground, rgba(255, 255, 255, 0.05));
        border-left: 2px solid var(--vscode-textLink-foreground, #3794ff);
        margin-bottom: 8px;
        border-radius: 4px;
        font-size: 0.85em;
      }

      .reply-bar-content {
        display: flex;
        align-items: center;
        gap: 6px;
        overflow: hidden;
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      .reply-bar-author {
        font-weight: 500;
        color: var(--vscode-foreground, #cccccc);
      }

      .reply-bar-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .reply-bar-cancel {
        flex-shrink: 0;
        background: none;
        border: none;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .reply-bar-cancel:hover {
        background-color: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.1));
        color: var(--vscode-foreground, #cccccc);
      }

      .message-content {
        color: var(--vscode-foreground, #cccccc);
      }

      .message-content p { margin-bottom: 8px; }
      .message-content p:last-child { margin-bottom: 0; }

      .message-content pre {
        background-color: var(--vscode-textBlockQuote-background, #2d2d2d);
        padding: 12px;
        border-radius: 4px;
        overflow-x: auto;
        margin: 8px 0;
      }

      .message-content code {
        font-family: var(--vscode-editor-font-family, 'Fira Code', monospace);
        font-size: 0.9em;
        background-color: var(--vscode-textBlockQuote-background, #2d2d2d);
        padding: 2px 4px;
        border-radius: 3px;
      }

      .message-content pre code {
        padding: 0;
        background: none;
      }

      .message-content ul, .message-content ol {
        margin: 8px 0;
        padding-left: 24px;
      }

      .message-content table {
        border-collapse: collapse;
        margin: 8px 0;
        width: 100%;
      }

      .message-content th, .message-content td {
        border: 1px solid var(--vscode-panel-border, #454545);
        padding: 8px;
        text-align: left;
      }

      .message-content th {
        background-color: var(--vscode-textBlockQuote-background, #2d2d2d);
      }

      .message-content blockquote {
        border-left: 3px solid var(--vscode-textBlockQuote-border, #454545);
        margin: 8px 0;
        padding-left: 12px;
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      .message-content a {
        color: var(--vscode-textLink-foreground, #3794ff);
        text-decoration: none;
      }

      .message-content a:hover {
        text-decoration: underline;
      }

      .message-tags {
        margin-top: 8px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .tag {
        font-size: 0.8em;
        padding: 2px 8px;
        border-radius: 12px;
        background-color: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #ffffff);
      }

      .date-separator {
        text-align: center;
        margin: 24px 0 16px;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        font-size: 0.85em;
        font-weight: 500;
      }

      .date-separator::before,
      .date-separator::after {
        content: '';
        display: inline-block;
        width: 40px;
        height: 1px;
        background-color: var(--vscode-panel-border, #454545);
        vertical-align: middle;
        margin: 0 12px;
      }

      .empty-state {
        text-align: center;
        padding: 48px 24px;
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      .empty-state p { margin-bottom: 8px; }
      .empty-state .hint { font-size: 0.9em; }

      .errors {
        margin: 0 20px 20px;
        padding: 16px;
        border-radius: 8px;
        background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      }

      .errors h3 {
        margin-bottom: 12px;
        color: var(--vscode-errorForeground, #f48771);
      }

      .error-item { margin-bottom: 8px; font-size: 0.9em; }
      .error-file { font-weight: 600; margin-right: 8px; }
      .error-message { color: var(--vscode-descriptionForeground, #8c8c8c); }

      /* Input Area */
      .input-area {
        padding: 16px 20px;
        border-top: 1px solid var(--vscode-panel-border, #454545);
        background-color: var(--vscode-editor-background, #1e1e1e);
      }

      .input-container {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .input-avatar {
        width: 42px;
        height: 42px;
        border-radius: 6px;
        flex-shrink: 0;
      }

      .message-input {
        width: 100%;
        padding: 10px 14px;
        border: 1px solid var(--vscode-input-border, #3c3c3c);
        border-radius: 8px;
        background-color: var(--vscode-input-background, #3c3c3c);
        color: var(--vscode-input-foreground, #cccccc);
        font-family: inherit;
        font-size: inherit;
        line-height: 1.5;
        resize: none;
        min-height: 42px;
        max-height: 200px;
        box-sizing: border-box;
      }

      .message-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder, #007fd4);
      }

      .message-input::placeholder {
        color: var(--vscode-input-placeholderForeground, #8c8c8c);
      }

      .send-btn {
        width: 42px;
        height: 42px;
        border: none;
        border-radius: 8px;
        background-color: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .send-btn:hover {
        background-color: var(--vscode-button-hoverBackground, #1177bb);
      }

      .input-disabled {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 12px;
        background-color: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border-radius: 8px;
      }

      .input-disabled-text {
        color: var(--vscode-descriptionForeground, #8c8c8c);
        font-size: 0.9em;
      }

      .sign-in-btn-small {
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85em;
        font-family: inherit;
        background-color: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
      }

      .sign-in-btn-small:hover {
        background-color: var(--vscode-button-hoverBackground, #1177bb);
      }

      /* Input wrapper for files + images + input */
      .input-wrapper {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .input-with-autocomplete {
        flex: 1;
        position: relative;
      }

      /* Chips container for files and images */
      .chips-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .chips-container:empty,
      .chips-container:not(:has(*:not(:empty))) {
        display: none;
      }

      /* File and image chips in input area */
      .files-chips,
      .images-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .files-chips:empty,
      .images-chips:empty {
        display: none;
      }

      .file-input-chip,
      .image-input-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 4px;
        background-color: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #ffffff);
        font-size: 0.8em;
      }

      .file-input-chip .remove-chip,
      .image-input-chip .remove-chip {
        cursor: pointer;
        opacity: 0.7;
        margin-left: 2px;
      }

      .file-input-chip .remove-chip:hover,
      .image-input-chip .remove-chip:hover {
        opacity: 1;
      }

      /* Image thumbnail preview */
      .image-input-chip .image-thumbnail {
        width: 20px;
        height: 20px;
        object-fit: cover;
        border-radius: 2px;
      }

      /* Autocomplete dropdown */
      .autocomplete-dropdown {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        max-height: 200px;
        overflow-y: auto;
        background-color: var(--vscode-dropdown-background, #3c3c3c);
        border: 1px solid var(--vscode-dropdown-border, #454545);
        border-radius: 4px;
        display: none;
        z-index: 1000;
        margin-bottom: 4px;
      }

      .autocomplete-dropdown.visible {
        display: block;
      }

      .autocomplete-item {
        padding: 8px 12px;
        cursor: pointer;
        font-size: 0.9em;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .autocomplete-item:hover,
      .autocomplete-item.selected {
        background-color: var(--vscode-list-hoverBackground, #2a2d2e);
      }

      .autocomplete-item .file-icon {
        opacity: 0.7;
      }

      .autocomplete-item .file-path {
        color: var(--vscode-descriptionForeground, #8c8c8c);
        font-size: 0.85em;
        margin-left: auto;
      }

      .autocomplete-empty {
        padding: 12px;
        text-align: center;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        font-size: 0.9em;
      }

      /* Message file references display */
      .message-files {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }

      .file-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 4px;
        background-color: var(--vscode-textBlockQuote-background, #2d2d2d);
        color: var(--vscode-textLink-foreground, #3794ff);
        font-size: 0.8em;
        cursor: pointer;
        border: 1px solid var(--vscode-panel-border, #454545);
      }

      .file-chip:hover {
        background-color: var(--vscode-list-hoverBackground, #2a2d2e);
      }

      .file-icon {
        opacity: 0.7;
      }

      /* Message images display */
      .message-images {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
      }

      .message-image-container {
        max-width: 400px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid var(--vscode-panel-border, #454545);
        cursor: pointer;
      }

      .message-image {
        display: block;
        max-width: 100%;
        height: auto;
      }

      .message-image-container:hover {
        border-color: var(--vscode-focusBorder, #007fd4);
      }

      /* Message attachments (non-image files) */
      .message-attachments {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
      }

      .attachment-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 6px;
        background-color: var(--vscode-textBlockQuote-background, #2d2d2d);
        border: 1px solid var(--vscode-panel-border, #454545);
        cursor: pointer;
        max-width: fit-content;
      }

      .attachment-link:hover {
        background-color: var(--vscode-list-hoverBackground, #2a2d2e);
        border-color: var(--vscode-focusBorder, #007fd4);
      }

      .attachment-icon {
        opacity: 0.7;
        flex-shrink: 0;
      }

      .attachment-name {
        color: var(--vscode-textLink-foreground, #3794ff);
        font-size: 0.9em;
      }

      .attachment-ext {
        font-size: 0.7em;
        padding: 2px 6px;
        border-radius: 3px;
        background-color: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #ffffff);
        margin-left: auto;
      }

      /* Attachment chips in input area */
      .attachments-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .attachments-chips:empty {
        display: none;
      }

      .attachment-input-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 4px;
        background-color: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #ffffff);
        font-size: 0.8em;
      }

      .attachment-input-chip .remove-chip {
        cursor: pointer;
        opacity: 0.7;
        margin-left: 2px;
      }

      .attachment-input-chip .remove-chip:hover {
        opacity: 1;
      }

      /* Custom context menu */
      .context-menu {
        position: fixed;
        display: none;
        min-width: 180px;
        background-color: var(--vscode-menu-background, #252526);
        border: 1px solid var(--vscode-menu-border, #454545);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        padding: 4px 0;
        font-size: 0.9em;
      }

      .context-menu.visible {
        display: block;
      }

      .context-menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        cursor: pointer;
        color: var(--vscode-menu-foreground, #cccccc);
      }

      .context-menu-item:hover {
        background-color: var(--vscode-menu-selectionBackground, #094771);
        color: var(--vscode-menu-selectionForeground, #ffffff);
      }

      .context-menu-item svg {
        flex-shrink: 0;
        opacity: 0.8;
      }

      .context-menu-item:hover svg {
        opacity: 1;
      }

      .context-menu-separator {
        height: 1px;
        background-color: var(--vscode-menu-separatorBackground, #454545);
        margin: 4px 0;
      }

      .context-menu-danger {
        color: var(--vscode-errorForeground, #f48771);
      }

      .context-menu-danger:hover {
        background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        color: var(--vscode-errorForeground, #f48771);
      }

      .context-menu-item.hidden {
        display: none;
      }

      /* Edited indicator */
      .edited-indicator {
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        font-style: italic;
      }

      /* Edit mode buttons */
      .send-buttons,
      .edit-buttons {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }

      .send-buttons.hidden,
      .edit-buttons.hidden {
        display: none;
      }

      .cancel-btn,
      .confirm-btn {
        width: 42px;
        height: 42px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .cancel-btn {
        background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        color: var(--vscode-errorForeground, #f48771);
      }

      .cancel-btn:hover {
        background-color: #6a2d2d;
      }

      .confirm-btn {
        background-color: var(--vscode-testing-iconPassed, #388a34);
        color: #ffffff;
      }

      .confirm-btn:hover {
        background-color: #48a344;
      }

      /* Edit mode input styling */
      .message-input.editing {
        border-color: var(--vscode-focusBorder, #007fd4);
        background-color: var(--vscode-editor-background, #1e1e1e);
      }
    `;
  }

  private getScript(isSignedIn: boolean, currentUser: string, repoPath: string, currentChannel: string): string {
    return `
      const vscode = acquireVsCodeApi();
      const currentUser = ${JSON.stringify(currentUser)};

      // Save state for panel restoration after extension reload
      vscode.setState({
        repoPath: ${JSON.stringify(repoPath)},
        currentChannel: ${JSON.stringify(currentChannel)}
      });

      // Signal ready
      vscode.postMessage({ type: 'ready' });

      // Context menu handling
      const contextMenu = document.getElementById('contextMenu');
      const contextReply = document.getElementById('contextReply');
      const contextCopy = document.getElementById('contextCopy');
      const contextOpenFile = document.getElementById('contextOpenFile');
      const contextEdit = document.getElementById('contextEdit');
      const contextDelete = document.getElementById('contextDelete');
      let contextTargetMessage = null;

      // Reply state
      let replyingTo = null; // filename of message being replied to
      let replyingToAuthor = null;
      let replyingToText = null;
      const replyBar = document.getElementById('replyBar');
      const replyBarAuthor = document.getElementById('replyBarAuthor');
      const replyBarText = document.getElementById('replyBarText');
      const replyBarCancel = document.getElementById('replyBarCancel');

      // Edit mode state
      let isEditMode = false;
      let editingFilename = null;
      const sendButtons = document.getElementById('sendButtons');
      const editButtons = document.getElementById('editButtons');
      const cancelEditBtn = document.getElementById('cancelEditBtn');
      const confirmEditBtn = document.getElementById('confirmEditBtn');

      function showContextMenu(x, y, messageEl) {
        contextTargetMessage = messageEl;
        const sender = messageEl.getAttribute('data-sender');
        const isOwner = currentUser && sender === currentUser;

        // Show/hide edit and delete options based on ownership
        if (isOwner) {
          contextEdit.classList.remove('hidden');
          contextDelete.classList.remove('hidden');
        } else {
          contextEdit.classList.add('hidden');
          contextDelete.classList.add('hidden');
        }

        // Position the menu
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.classList.add('visible');

        // Adjust position if menu goes off screen
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          contextMenu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
          contextMenu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
      }

      function hideContextMenu() {
        contextMenu.classList.remove('visible');
        contextTargetMessage = null;
      }

      // Hide context menu when clicking elsewhere
      document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
          hideContextMenu();
        }
      });

      // Hide on escape key (also cancel edit mode)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          hideContextMenu();
          if (isEditMode) {
            exitEditMode();
          }
        }
      });

      // Handle right-click on messages
      document.querySelectorAll('.message').forEach(messageEl => {
        messageEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, messageEl);
        });
      });

      // Context menu actions
      if (contextReply) {
        contextReply.addEventListener('click', () => {
          if (contextTargetMessage) {
            const filename = contextTargetMessage.getAttribute('data-filename');
            const sender = contextTargetMessage.getAttribute('data-sender');
            const content = contextTargetMessage.getAttribute('data-content');
            if (filename) {
              enterReplyMode(filename, sender, content);
            }
          }
          hideContextMenu();
        });
      }

      if (contextCopy) {
        contextCopy.addEventListener('click', () => {
          if (contextTargetMessage) {
            const content = contextTargetMessage.querySelector('.message-content');
            if (content) {
              // Get text content, stripping HTML
              const text = content.innerText || content.textContent;
              navigator.clipboard.writeText(text).then(() => {
                // Could show a toast here
              }).catch(err => {
                console.error('Failed to copy:', err);
              });
            }
          }
          hideContextMenu();
        });
      }

      if (contextOpenFile) {
        contextOpenFile.addEventListener('click', () => {
          if (contextTargetMessage) {
            const filename = contextTargetMessage.getAttribute('data-filename');
            if (filename) {
              vscode.postMessage({ type: 'openFile', payload: filename });
            }
          }
          hideContextMenu();
        });
      }

      if (contextDelete) {
        contextDelete.addEventListener('click', () => {
          if (contextTargetMessage) {
            const filename = contextTargetMessage.getAttribute('data-filename');
            const sender = contextTargetMessage.getAttribute('data-sender');
            if (filename && sender === currentUser) {
              vscode.postMessage({ type: 'deleteMessage', payload: filename });
            }
          }
          hideContextMenu();
        });
      }

      if (contextEdit) {
        contextEdit.addEventListener('click', () => {
          if (contextTargetMessage) {
            const filename = contextTargetMessage.getAttribute('data-filename');
            const sender = contextTargetMessage.getAttribute('data-sender');
            const content = contextTargetMessage.getAttribute('data-content');
            const files = contextTargetMessage.getAttribute('data-files');
            const images = contextTargetMessage.getAttribute('data-images');
            const attachments = contextTargetMessage.getAttribute('data-attachments');
            if (filename && sender === currentUser) {
              enterEditMode(filename, content || '', files, images, attachments);
            }
          }
          hideContextMenu();
        });
      }

      function enterEditMode(filename, content, filesJson, imagesJson, attachmentsJson) {
        isEditMode = true;
        editingFilename = filename;

        // Load content into input
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
          messageInput.value = content;
          messageInput.classList.add('editing');
          messageInput.style.height = 'auto';
          messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
          messageInput.focus();
        }

        // Load existing files (@ references)
        try {
          const files = JSON.parse(filesJson || '[]');
          selectedFiles = files;
          renderFileChips();
        } catch (e) {
          selectedFiles = [];
        }

        // Load existing images (no preview for existing ones)
        try {
          const images = JSON.parse(imagesJson || '[]');
          selectedImages = images.map(p => ({ path: p, dataUrl: '' }));
          renderImageChips();
        } catch (e) {
          selectedImages = [];
        }

        // Load existing attachments
        try {
          const attachments = JSON.parse(attachmentsJson || '[]');
          selectedAttachments = attachments.map(p => ({ path: p, name: p.split('/').pop() || p }));
          renderAttachmentChips();
        } catch (e) {
          selectedAttachments = [];
        }

        // Switch buttons
        if (sendButtons) sendButtons.classList.add('hidden');
        if (editButtons) editButtons.classList.remove('hidden');
      }

      function exitEditMode() {
        isEditMode = false;
        editingFilename = null;

        // Clear input
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
          messageInput.value = '';
          messageInput.classList.remove('editing');
          messageInput.style.height = 'auto';
        }

        // Clear all chips (reset to empty state)
        selectedFiles = [];
        selectedImages = [];
        selectedAttachments = [];
        renderFileChips();
        renderImageChips();
        renderAttachmentChips();

        // Switch buttons back
        if (sendButtons) sendButtons.classList.remove('hidden');
        if (editButtons) editButtons.classList.add('hidden');
      }

      function enterReplyMode(filename, author, content) {
        // Cancel edit mode if active
        if (isEditMode) {
          exitEditMode();
        }

        replyingTo = filename;
        replyingToAuthor = author;

        // Truncate content for display
        const plainText = (content || '')
          .replace(/\\n/g, ' ')
          .trim();
        replyingToText = plainText.length > 50 ? plainText.slice(0, 50) + '...' : plainText;

        // Show reply bar
        if (replyBar) {
          replyBar.style.display = 'flex';
        }
        if (replyBarAuthor) {
          replyBarAuthor.textContent = author + ':';
        }
        if (replyBarText) {
          replyBarText.textContent = replyingToText;
        }

        // Focus input
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
          messageInput.focus();
        }
      }

      function exitReplyMode() {
        replyingTo = null;
        replyingToAuthor = null;
        replyingToText = null;

        // Hide reply bar
        if (replyBar) {
          replyBar.style.display = 'none';
        }
        if (replyBarAuthor) {
          replyBarAuthor.textContent = '';
        }
        if (replyBarText) {
          replyBarText.textContent = '';
        }
      }

      // Reply bar cancel button
      if (replyBarCancel) {
        replyBarCancel.addEventListener('click', () => {
          exitReplyMode();
        });
      }

      if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => {
          exitEditMode();
        });
      }

      if (confirmEditBtn) {
        confirmEditBtn.addEventListener('click', () => {
          if (isEditMode && editingFilename) {
            const messageInput = document.getElementById('messageInput');
            const newContent = messageInput ? messageInput.value : '';
            const imagePaths = selectedImages.filter(img => img.path).map(img => img.path);
            const attachmentPaths = selectedAttachments.filter(att => att.path).map(att => att.path);
            vscode.postMessage({
              type: 'editMessage',
              payload: {
                filename: editingFilename,
                content: newContent,
                files: selectedFiles.length > 0 ? [...selectedFiles] : undefined,
                images: imagePaths.length > 0 ? imagePaths : undefined,
                attachments: attachmentPaths.length > 0 ? attachmentPaths : undefined
              }
            });
            exitEditMode();
          }
        });
      }

      // Scroll to bottom of messages
      const messagesContainer = document.getElementById('messagesContainer');
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }

      // Handle channel clicks
      document.querySelectorAll('.channel-item').forEach(el => {
        el.addEventListener('click', () => {
          const channel = el.getAttribute('data-channel');
          if (channel) {
            vscode.postMessage({ type: 'switchChannel', payload: channel });
          }
        });
      });

      // Handle add channel button
      const addChannelBtn = document.getElementById('addChannelBtn');
      if (addChannelBtn) {
        addChannelBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'createChannel' });
        });
      }

      // Handle message clicks to open source file
      document.querySelectorAll('.message').forEach(el => {
        el.addEventListener('dblclick', () => {
          const filename = el.getAttribute('data-filename');
          if (filename) {
            vscode.postMessage({ type: 'openFile', payload: filename });
          }
        });
      });

      // Handle sidebar sign in button
      const sidebarSignInBtn = document.getElementById('sidebarSignInBtn');
      if (sidebarSignInBtn) {
        sidebarSignInBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'signIn' });
        });
      }

      // Handle sign in button (input area)
      const signInBtnInput = document.getElementById('signInBtnInput');
      if (signInBtnInput) {
        signInBtnInput.addEventListener('click', () => {
          vscode.postMessage({ type: 'signIn' });
        });
      }

      // Handle file reference clicks in messages
      document.querySelectorAll('.file-chip').forEach(el => {
        el.addEventListener('click', () => {
          const file = el.getAttribute('data-file');
          if (file) {
            vscode.postMessage({ type: 'openRepoFile', payload: file });
          }
        });
      });

      // Handle attachment link clicks in messages
      document.querySelectorAll('.attachment-link').forEach(el => {
        el.addEventListener('click', () => {
          const attachment = el.getAttribute('data-attachment');
          if (attachment) {
            vscode.postMessage({ type: 'openAsset', payload: attachment });
          }
        });
      });

      // Handle reply preview clicks to scroll to parent message
      document.querySelectorAll('.reply-preview').forEach(el => {
        el.addEventListener('click', () => {
          const replyTo = el.getAttribute('data-reply-to');
          if (replyTo) {
            const parentMessage = document.querySelector('.message[data-filename="' + replyTo + '"]');
            if (parentMessage) {
              parentMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Flash highlight the message briefly
              parentMessage.classList.add('highlight-flash');
              setTimeout(() => {
                parentMessage.classList.remove('highlight-flash');
              }, 1500);
            }
          }
        });
      });

      ${isSignedIn ? `
      // Message input handling with @ file references, image paste, and file paste
      const messageInput = document.getElementById('messageInput');
      const sendBtn = document.getElementById('sendBtn');
      const autocompleteDropdown = document.getElementById('autocompleteDropdown');
      const filesChips = document.getElementById('filesChips');
      const imagesChips = document.getElementById('imagesChips');
      const attachmentsChips = document.getElementById('attachmentsChips');

      let repoFiles = [];
      let selectedFiles = [];       // Array of file paths (@ references to codebase)
      let selectedImages = [];      // Array of { path: string, dataUrl: string } for images
      let selectedAttachments = []; // Array of { path: string, name: string } for non-image files
      let autocompleteVisible = false;
      let selectedIndex = 0;
      let searchStart = -1;

      // Request repo files on load
      vscode.postMessage({ type: 'getRepoFiles' });

      // Listen for messages from extension
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'repoFiles') {
          repoFiles = message.payload || [];
        } else if (message.type === 'assetSaved') {
          // Asset was saved, update the appropriate list
          const { path, isImage } = message.payload;
          if (isImage) {
            const pendingImage = selectedImages.find(img => !img.path);
            if (pendingImage) {
              pendingImage.path = path;
              renderImageChips();
            }
          } else {
            const pendingAttachment = selectedAttachments.find(att => !att.path);
            if (pendingAttachment) {
              pendingAttachment.path = path;
              renderAttachmentChips();
            }
          }
        }
      });

      function sendMessage() {
        const content = messageInput.value.trim();
        const imagePaths = selectedImages.filter(img => img.path).map(img => img.path);
        const attachmentPaths = selectedAttachments.filter(att => att.path).map(att => att.path);
        if (content || selectedFiles.length > 0 || imagePaths.length > 0 || attachmentPaths.length > 0) {
          vscode.postMessage({
            type: 'sendMessage',
            payload: {
              content: content,
              files: selectedFiles.length > 0 ? [...selectedFiles] : undefined,
              images: imagePaths.length > 0 ? imagePaths : undefined,
              attachments: attachmentPaths.length > 0 ? attachmentPaths : undefined,
              replyTo: replyingTo || undefined
            }
          });
          messageInput.value = '';
          messageInput.style.height = 'auto';
          selectedFiles = [];
          selectedImages = [];
          selectedAttachments = [];
          renderFileChips();
          renderImageChips();
          renderAttachmentChips();
          exitReplyMode();
        }
      }

      function renderFileChips() {
        filesChips.innerHTML = selectedFiles.map((file, i) =>
          '<span class="file-input-chip" data-index="' + i + '">' +
            '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M3.5 1.5v13h9v-9l-4-4h-5zm1 1h3.5v3.5h3.5v7.5h-7v-11zm4.5.71l2.29 2.29h-2.29v-2.29z"/></svg>' +
            file.split('/').pop() +
            '<span class="remove-chip" data-index="' + i + '">×</span>' +
          '</span>'
        ).join('');

        // Add click handlers for remove buttons
        filesChips.querySelectorAll('.remove-chip').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(el.getAttribute('data-index'));
            selectedFiles.splice(idx, 1);
            renderFileChips();
          });
        });
      }

      function renderImageChips() {
        imagesChips.innerHTML = selectedImages.map((img, i) => {
          const filename = img.path ? img.path.split('/').pop() : 'Uploading...';
          // If we have a dataUrl, show thumbnail; otherwise show icon (for existing images in edit mode)
          if (img.dataUrl) {
            return '<span class="image-input-chip" data-index="' + i + '">' +
              '<img class="image-thumbnail" src="' + img.dataUrl + '" alt="preview" />' +
              filename +
              '<span class="remove-chip" data-index="' + i + '">×</span>' +
            '</span>';
          } else {
            return '<span class="image-input-chip" data-index="' + i + '">' +
              '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M14 2H2v12h12V2zm-1 10l-3-4-2 3-2-2-2 3V3h9v9z"/><circle fill="currentColor" cx="5" cy="6" r="1.5"/></svg>' +
              filename +
              '<span class="remove-chip" data-index="' + i + '">×</span>' +
            '</span>';
          }
        }).join('');

        // Add click handlers for remove buttons
        imagesChips.querySelectorAll('.remove-chip').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(el.getAttribute('data-index'));
            selectedImages.splice(idx, 1);
            renderImageChips();
          });
        });
      }

      function renderAttachmentChips() {
        attachmentsChips.innerHTML = selectedAttachments.map((att, i) => {
          const filename = att.name || (att.path ? att.path.split('/').pop() : 'Uploading...');
          return '<span class="attachment-input-chip" data-index="' + i + '">' +
            '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M13.5 1h-11l-.5.5v13l.5.5h11l.5-.5v-13l-.5-.5zm-.5 13H3V2h10v12z"/></svg>' +
            filename +
            '<span class="remove-chip" data-index="' + i + '">×</span>' +
          '</span>';
        }).join('');

        // Add click handlers for remove buttons
        attachmentsChips.querySelectorAll('.remove-chip').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(el.getAttribute('data-index'));
            selectedAttachments.splice(idx, 1);
            renderAttachmentChips();
          });
        });
      }

      // Helper to process an image file
      function processImageFile(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result;
          if (typeof dataUrl !== 'string') return;

          // Extract base64 data and extension
          const matches = dataUrl.match(/^data:image\\/(\\w+);base64,(.+)$/);
          if (!matches) return;

          const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const base64Data = matches[2];

          // Add to selectedImages with dataUrl for preview (path will be set when saved)
          selectedImages.push({ path: '', dataUrl: dataUrl });
          renderImageChips();

          // Send to extension to save
          vscode.postMessage({
            type: 'saveAsset',
            payload: { data: base64Data, extension: extension, isImage: true }
          });
        };
        reader.readAsDataURL(file);
      }

      // Helper to process a non-image file
      function processFile(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result;
          if (typeof dataUrl !== 'string') return;

          // Extract base64 data
          const matches = dataUrl.match(/^data:[^;]*;base64,(.+)$/);
          if (!matches) return;

          const base64Data = matches[1];
          const extension = file.name?.split('.').pop()?.toLowerCase() || 'bin';

          // Add to selectedAttachments (path will be set when saved)
          selectedAttachments.push({ path: '', name: file.name || 'file.' + extension });
          renderAttachmentChips();

          // Send to extension to save
          vscode.postMessage({
            type: 'saveAsset',
            payload: { data: base64Data, extension: extension, isImage: false }
          });
        };
        reader.readAsDataURL(file);
      }

      // Check if a file is an image based on type or extension
      function isImageFile(file) {
        if (file.type && file.type.startsWith('image/')) return true;
        const ext = file.name?.toLowerCase().split('.').pop();
        return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
      }

      // Handle paste event for files (images and other file types)
      document.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        let handled = false;

        // Case 1: Check for image data in items (from "Copy Image" or screenshots)
        const items = clipboardData.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) {
                processImageFile(file);
                handled = true;
                break;
              }
            }
          }
        }

        // Case 2: Check for copied files (from Finder/Explorer file copy)
        if (!handled && clipboardData.files && clipboardData.files.length > 0) {
          for (const file of clipboardData.files) {
            e.preventDefault();
            if (isImageFile(file)) {
              processImageFile(file);
            } else {
              processFile(file);
            }
            handled = true;
            break;  // Only handle first file
          }
        }
      });

      function showAutocomplete(query) {
        const filtered = repoFiles
          .filter(f => f.toLowerCase().includes(query.toLowerCase()))
          .filter(f => !selectedFiles.includes(f))
          .slice(0, 10);

        if (filtered.length === 0) {
          autocompleteDropdown.innerHTML = '<div class="autocomplete-empty">No matching files</div>';
        } else {
          autocompleteDropdown.innerHTML = filtered.map((file, i) => {
            const parts = file.split('/');
            const filename = parts.pop();
            const dir = parts.join('/');
            return '<div class="autocomplete-item' + (i === selectedIndex ? ' selected' : '') + '" data-file="' + file + '">' +
              '<span class="file-icon">📄</span>' +
              '<span class="file-name">' + filename + '</span>' +
              (dir ? '<span class="file-path">' + dir + '</span>' : '') +
            '</div>';
          }).join('');

          // Add click handlers
          autocompleteDropdown.querySelectorAll('.autocomplete-item').forEach(el => {
            el.addEventListener('click', () => {
              selectFile(el.getAttribute('data-file'));
            });
          });
        }

        autocompleteDropdown.classList.add('visible');
        autocompleteVisible = true;
        selectedIndex = 0;
      }

      function hideAutocomplete() {
        autocompleteDropdown.classList.remove('visible');
        autocompleteVisible = false;
        searchStart = -1;
      }

      function selectFile(file) {
        if (file && !selectedFiles.includes(file)) {
          selectedFiles.push(file);
          renderFileChips();
        }
        // Remove the @query from the input
        if (searchStart >= 0) {
          const before = messageInput.value.substring(0, searchStart);
          const afterMatch = messageInput.value.substring(searchStart).match(/^@[^\\s]*/);
          const after = afterMatch ? messageInput.value.substring(searchStart + afterMatch[0].length) : '';
          messageInput.value = before + after;
        }
        hideAutocomplete();
        messageInput.focus();
      }

      // Send button click
      if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
      }

      // Auto-resize textarea and handle @ trigger
      if (messageInput) {
        messageInput.addEventListener('input', (e) => {
          messageInput.style.height = 'auto';
          messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';

          // Check for @ trigger
          const value = messageInput.value;
          const cursorPos = messageInput.selectionStart;

          // Find the last @ before cursor
          let atPos = -1;
          for (let i = cursorPos - 1; i >= 0; i--) {
            if (value[i] === '@') {
              atPos = i;
              break;
            }
            if (value[i] === ' ' || value[i] === '\\n') {
              break;
            }
          }

          if (atPos >= 0) {
            const query = value.substring(atPos + 1, cursorPos);
            if (query.length >= 0 && !query.includes(' ')) {
              searchStart = atPos;
              showAutocomplete(query);
            } else {
              hideAutocomplete();
            }
          } else {
            hideAutocomplete();
          }
        });

        // Keyboard navigation
        messageInput.addEventListener('keydown', (e) => {
          if (autocompleteVisible) {
            const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
              items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              selectedIndex = Math.max(selectedIndex - 1, 0);
              items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex));
            } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              const selected = items[selectedIndex];
              if (selected) {
                selectFile(selected.getAttribute('data-file'));
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              hideAutocomplete();
            }
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (isEditMode && editingFilename) {
              // Confirm edit
              const newContent = messageInput.value;
              const imagePaths = selectedImages.filter(img => img.path).map(img => img.path);
              const attachmentPaths = selectedAttachments.filter(att => att.path).map(att => att.path);
              vscode.postMessage({
                type: 'editMessage',
                payload: {
                  filename: editingFilename,
                  content: newContent,
                  files: selectedFiles.length > 0 ? [...selectedFiles] : undefined,
                  images: imagePaths.length > 0 ? imagePaths : undefined,
                  attachments: attachmentPaths.length > 0 ? attachmentPaths : undefined
                }
              });
              exitEditMode();
            } else {
              sendMessage();
            }
          }
        });

        // Hide autocomplete on blur (with delay for click handling)
        messageInput.addEventListener('blur', () => {
          setTimeout(hideAutocomplete, 200);
        });

        // Focus the input
        messageInput.focus();
      }
      ` : ''}
    `;
  }

  public dispose(): void {
    ChatPanel.currentPanel = undefined;

    this.watcher?.dispose();
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
