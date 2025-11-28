import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Conversation, loadConversation, updateConversationMessage, removeConversationMessage } from './conversationLoader';
import { loadSchema } from './schemaParser';
import { FolderWatcher, WatcherEvent } from './folderWatcher';
import { Message } from './messageParser';
import { marked } from 'marked';
import { GitHubAuthService, GitHubUser } from './githubAuth';
import { GitService } from './gitService';
import { SyncService } from './syncService';
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
  private static readonly viewType = 'vibechannelChat';

  private readonly panel: vscode.WebviewPanel;
  private readonly repoPath: string;
  private gitService: GitService;
  private syncService: SyncService;
  private channels: string[];
  private currentChannel: string;
  private conversation: Conversation;
  private watcher: FolderWatcher | undefined;
  private disposables: vscode.Disposable[] = [];

  public static async createOrShow(repoPath: string): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel for this repo, show it
    if (ChatPanel.currentPanel && ChatPanel.currentPanel.repoPath === repoPath) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }

    // Otherwise, dispose the old panel and create a new one
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.dispose();
    }

    // Initialize GitService for this repo
    const gitService = GitService.getInstance();
    await gitService.initialize(repoPath);

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

    ChatPanel.currentPanel = new ChatPanel(panel, repoPath, gitService, syncService, channels, defaultChannel, conversation);
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

  private constructor(
    panel: vscode.WebviewPanel,
    repoPath: string,
    gitService: GitService,
    syncService: SyncService,
    channels: string[],
    currentChannel: string,
    conversation: Conversation
  ) {
    this.panel = panel;
    this.repoPath = repoPath;
    this.gitService = gitService;
    this.syncService = syncService;
    this.channels = channels;
    this.currentChannel = currentChannel;
    this.conversation = conversation;

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
      this.syncService.onSync((event) => {
        if (event.type === 'newMessages') {
          this.refresh();
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
      case 'signIn':
        vscode.commands.executeCommand('vibechannel.signIn');
        break;
      case 'signOut':
        vscode.commands.executeCommand('vibechannel.signOut');
        break;
      case 'sendMessage':
        if (typeof message.payload === 'string' && message.payload.trim()) {
          this.createMessageFile(message.payload.trim());
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

  private async createMessageFile(content: string): Promise<void> {
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

      // Create file content
      const fileContent = `---
from: ${sender}
date: ${isoTimestamp}
---

${content}
`;

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

  public refresh(): void {
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

  private update(): void {
    this.panel.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview(): string {
    const config = vscode.workspace.getConfiguration('vibechannel');
    const timestampDisplay = config.get('timestampDisplay', 'relative');
    const authService = GitHubAuthService.getInstance();
    const user = authService.getUser();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https:;">
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

      <div class="messages-container" id="messagesContainer">
        ${this.renderMessages(timestampDisplay === 'relative')}
      </div>

      ${this.conversation.errors.length > 0 ? this.renderErrors() : ''}

      <div class="input-area">
        ${user ? this.renderInputField(user) : this.renderInputDisabled()}
      </div>
    </main>
  </div>

  <script>
    ${this.getScript(!!user)}
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

    return `<div class="message ${colorClass}" data-filename="${this.escapeHtml(message.filename)}">
      <div class="message-header">
        <span class="sender">${this.escapeHtml(message.from)}</span>
        <span class="timestamp" title="${message.date.toISOString()}">${timestamp}</span>
        ${message.replyTo ? `<span class="reply-indicator" title="Reply to ${this.escapeHtml(message.replyTo)}">↩</span>` : ''}
      </div>
      <div class="message-content">${renderedContent}</div>
      ${message.tags && message.tags.length > 0 ? this.renderTags(message.tags) : ''}
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
    return `<div class="input-container">
      <img class="input-avatar" src="${this.escapeHtml(user.avatarUrl)}" alt="${this.escapeHtml(user.login)}" />
      <textarea
        id="messageInput"
        class="message-input"
        placeholder="Message #${this.escapeHtml(this.currentChannel)}"
        rows="1"
      ></textarea>
      <button class="send-btn" id="sendBtn" title="Send message (Cmd+Enter)">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>`;
  }

  private renderInputDisabled(): string {
    return `<div class="input-disabled">
      <span class="input-disabled-text">Sign in to send messages</span>
      <button class="sign-in-btn-small" id="signInBtnInput">Sign in with GitHub</button>
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
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
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
      .replace(/'/g, '&#039;');
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

      .reply-indicator {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        cursor: help;
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
        align-items: flex-end;
        gap: 12px;
      }

      .input-avatar {
        width: 32px;
        height: 32px;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .message-input {
        flex: 1;
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
    `;
  }

  private getScript(isSignedIn: boolean): string {
    return `
      const vscode = acquireVsCodeApi();

      // Signal ready
      vscode.postMessage({ type: 'ready' });

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

      ${isSignedIn ? `
      // Message input handling
      const messageInput = document.getElementById('messageInput');
      const sendBtn = document.getElementById('sendBtn');

      function sendMessage() {
        const content = messageInput.value.trim();
        if (content) {
          vscode.postMessage({ type: 'sendMessage', payload: content });
          messageInput.value = '';
          messageInput.style.height = 'auto';
        }
      }

      // Send button click
      if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
      }

      // Auto-resize textarea
      if (messageInput) {
        messageInput.addEventListener('input', () => {
          messageInput.style.height = 'auto';
          messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        });

        // Cmd+Enter or Ctrl+Enter to send
        messageInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            sendMessage();
          }
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
