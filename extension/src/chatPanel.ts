import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Conversation, loadConversation, updateConversationMessage, removeConversationMessage } from './conversationLoader';
import { FolderWatcher, WatcherEvent } from './folderWatcher';
import { Message } from './messageParser';
import { marked } from 'marked';
import { GitHubAuthService, GitHubUser } from './githubAuth';

/**
 * Manages the chat webview panel
 */
export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private static readonly viewType = 'vibechannelChat';

  private readonly panel: vscode.WebviewPanel;
  private readonly folderPath: string;
  private readonly channelName: string | null;
  private conversation: Conversation;
  private watcher: FolderWatcher | undefined;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(folderPath: string): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel for this folder, show it
    if (ChatPanel.currentPanel && ChatPanel.currentPanel.folderPath === folderPath) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }

    // Otherwise, dispose the old panel and create a new one
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.dispose();
    }

    const conversation = loadConversation(folderPath);

    // Extract channel name if this is a channel folder inside .vibechannel
    const parentDir = path.dirname(folderPath);
    const parentName = path.basename(parentDir);
    const channelName = parentName === '.vibechannel' ? path.basename(folderPath) : null;

    // Set panel title to channel name or schema name
    const panelTitle = channelName
      ? `#${channelName}`
      : conversation.schema.metadata.name || 'VibeChannel';

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      panelTitle,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(folderPath)],
      }
    );

    ChatPanel.currentPanel = new ChatPanel(panel, folderPath, conversation, channelName);
  }

  public static refresh(): void {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.refresh();
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    folderPath: string,
    conversation: Conversation,
    channelName: string | null
  ) {
    this.panel = panel;
    this.folderPath = folderPath;
    this.channelName = channelName;
    this.conversation = conversation;

    // Set initial content
    this.update();

    // Start file watcher if enabled
    const config = vscode.workspace.getConfiguration('vibechannel');
    if (config.get('watchForChanges', true)) {
      this.startWatcher();
    }

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
        }
      },
      null,
      this.disposables
    );
  }

  private startWatcher(): void {
    this.watcher = new FolderWatcher(
      this.folderPath,
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
      case 'openFile':
        if (typeof message.payload === 'string') {
          const filepath = path.join(this.folderPath, message.payload);
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
      const filepath = path.join(this.folderPath, filename);

      // Create file content
      const fileContent = `---
from: ${sender}
date: ${isoTimestamp}
---

${content}
`;

      // Write file
      fs.writeFileSync(filepath, fileContent, 'utf-8');

      // The file watcher will pick up the new file and refresh the view
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create message: ${error}`);
    }
  }

  public refresh(): void {
    this.conversation = loadConversation(this.folderPath);
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

    // Use channel name if available, otherwise fall back to schema name
    const headerTitle = this.channelName
      ? `#${this.channelName}`
      : this.conversation.schema.metadata.name || 'Conversation';
    const pageTitle = this.channelName
      ? `#${this.channelName} - VibeChannel`
      : this.conversation.schema.metadata.name || 'VibeChannel';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https:;">
  <title>${this.escapeHtml(pageTitle)}</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="chat-wrapper">
    <div class="chat-container">
      <header class="chat-header">
        <div class="header-top">
          <h1>${this.escapeHtml(headerTitle)}</h1>
          <div class="auth-section">
            ${user ? this.renderUserInfo(user) : this.renderSignInButton()}
          </div>
        </div>
        ${this.conversation.schema.metadata.description
          ? `<p class="description">${this.escapeHtml(this.conversation.schema.metadata.description)}</p>`
          : ''}
        <div class="header-info">
          <span class="message-count">${this.conversation.messages.length} messages</span>
          ${this.conversation.errors.length > 0
            ? `<span class="error-count">${this.conversation.errors.length} errors</span>`
            : ''}
        </div>
      </header>

      <div class="messages" id="messagesContainer">
        ${this.renderMessages(timestampDisplay === 'relative')}
      </div>

      ${this.conversation.errors.length > 0 ? this.renderErrors() : ''}
    </div>

    <div class="input-area">
      ${user ? this.renderInputField(user) : this.renderInputDisabled()}
    </div>
  </div>

  <script>
    ${this.getScript(!!user)}
  </script>
</body>
</html>`;
  }

  private renderMessages(relativeTime: boolean): string {
    if (this.conversation.messages.length === 0) {
      return `<div class="empty-state">
        <p>No messages yet</p>
        <p class="hint">Add markdown files to this folder to start a conversation</p>
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

  private renderUserInfo(user: GitHubUser): string {
    return `<div class="user-info">
      <img class="user-avatar" src="${this.escapeHtml(user.avatarUrl)}" alt="${this.escapeHtml(user.login)}" />
      <span class="user-name">${this.escapeHtml(user.name || user.login)}</span>
      <button class="sign-out-btn" id="signOutBtn">Sign Out</button>
    </div>`;
  }

  private renderSignInButton(): string {
    return `<button class="sign-in-btn" id="signInBtn">
      <svg class="github-icon" viewBox="0 0 16 16" width="16" height="16">
        <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      Sign in with GitHub
    </button>`;
  }

  private renderInputField(user: GitHubUser): string {
    return `<div class="input-container">
      <img class="input-avatar" src="${this.escapeHtml(user.avatarUrl)}" alt="${this.escapeHtml(user.login)}" />
      <textarea
        id="messageInput"
        class="message-input"
        placeholder="Type a message..."
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
      <div class="input-disabled-content">
        <span class="input-disabled-text">Sign in to join the conversation</span>
        <button class="sign-in-btn-small" id="signInBtnInput">
          <svg class="github-icon" viewBox="0 0 16 16" width="14" height="14">
            <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Sign in with GitHub
        </button>
      </div>
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
    // Generate a consistent color class based on sender name
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

      .chat-wrapper {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }

      .chat-container {
        flex: 1;
        overflow-y: auto;
        max-width: 800px;
        width: 100%;
        margin: 0 auto;
        padding: 20px;
        padding-bottom: 0;
      }

      .chat-header {
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--vscode-panel-border, #454545);
      }

      .header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .chat-header h1 {
        font-size: 1.5em;
        font-weight: 600;
        margin: 0;
      }

      .auth-section {
        display: flex;
        align-items: center;
      }

      .user-info {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .user-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
      }

      .user-name {
        font-size: 0.9em;
        color: var(--vscode-foreground, #cccccc);
      }

      .sign-in-btn, .sign-out-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85em;
        font-family: inherit;
      }

      .sign-in-btn {
        background-color: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
      }

      .sign-in-btn:hover {
        background-color: var(--vscode-button-hoverBackground, #1177bb);
      }

      .sign-out-btn {
        background-color: transparent;
        color: var(--vscode-descriptionForeground, #8c8c8c);
        border: 1px solid var(--vscode-panel-border, #454545);
      }

      .sign-out-btn:hover {
        background-color: var(--vscode-list-hoverBackground, #2a2d2e);
      }

      .github-icon {
        flex-shrink: 0;
      }

      .chat-header .description {
        color: var(--vscode-descriptionForeground, #8c8c8c);
        margin-bottom: 8px;
      }

      .header-info {
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      .header-info .error-count {
        color: var(--vscode-errorForeground, #f48771);
        margin-left: 12px;
      }

      .messages {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .message {
        padding: 12px 16px;
        border-radius: 8px;
        background-color: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border-left: 3px solid transparent;
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

      .message-content p {
        margin-bottom: 8px;
      }

      .message-content p:last-child {
        margin-bottom: 0;
      }

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
        font-size: 0.9em;
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

      .empty-state p {
        margin-bottom: 8px;
      }

      .empty-state .hint {
        font-size: 0.9em;
      }

      .errors {
        margin-top: 24px;
        padding: 16px;
        border-radius: 8px;
        background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      }

      .errors h3 {
        margin-bottom: 12px;
        color: var(--vscode-errorForeground, #f48771);
      }

      .error-item {
        margin-bottom: 8px;
        font-size: 0.9em;
      }

      .error-file {
        font-weight: 600;
        margin-right: 8px;
      }

      .error-message {
        color: var(--vscode-descriptionForeground, #8c8c8c);
      }

      /* Input Area Styles */
      .input-area {
        flex-shrink: 0;
        border-top: 1px solid var(--vscode-panel-border, #454545);
        background-color: var(--vscode-editor-background, #1e1e1e);
        padding: 16px 20px;
      }

      .input-container {
        max-width: 800px;
        margin: 0 auto;
        display: flex;
        align-items: flex-end;
        gap: 12px;
      }

      .input-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
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
        transition: background-color 0.15s;
      }

      .send-btn:hover {
        background-color: var(--vscode-button-hoverBackground, #1177bb);
      }

      .send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Disabled input state */
      .input-disabled {
        max-width: 800px;
        margin: 0 auto;
        padding: 12px;
        background-color: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border-radius: 8px;
      }

      .input-disabled-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
      }

      .input-disabled-text {
        color: var(--vscode-descriptionForeground, #8c8c8c);
        font-size: 0.9em;
      }

      .sign-in-btn-small {
        display: flex;
        align-items: center;
        gap: 6px;
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

      // Handle message clicks to open source file
      document.querySelectorAll('.message').forEach(el => {
        el.addEventListener('dblclick', () => {
          const filename = el.getAttribute('data-filename');
          if (filename) {
            vscode.postMessage({ type: 'openFile', payload: filename });
          }
        });
      });

      // Handle sign in button (header)
      const signInBtn = document.getElementById('signInBtn');
      if (signInBtn) {
        signInBtn.addEventListener('click', () => {
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

      // Handle sign out button
      const signOutBtn = document.getElementById('signOutBtn');
      if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'signOut' });
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
