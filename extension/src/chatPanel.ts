import * as vscode from 'vscode';
import * as path from 'path';
import { Conversation, loadConversation, updateConversationMessage, removeConversationMessage } from './conversationLoader';
import { FolderWatcher, WatcherEvent } from './folderWatcher';
import { Message } from './messageParser';
import { marked } from 'marked';

/**
 * Manages the chat webview panel
 */
export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private static readonly viewType = 'vibechannelChat';

  private readonly panel: vscode.WebviewPanel;
  private readonly folderPath: string;
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

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      conversation.schema.metadata.name || 'VibeChannel',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(folderPath)],
      }
    );

    ChatPanel.currentPanel = new ChatPanel(panel, folderPath, conversation);
  }

  public static refresh(): void {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.refresh();
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    folderPath: string,
    conversation: Conversation
  ) {
    this.panel = panel;
    this.folderPath = folderPath;
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>${this.escapeHtml(this.conversation.schema.metadata.name || 'VibeChannel')}</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="chat-container">
    <header class="chat-header">
      <h1>${this.escapeHtml(this.conversation.schema.metadata.name || 'Conversation')}</h1>
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

    <div class="messages">
      ${this.renderMessages(timestampDisplay === 'relative')}
    </div>

    ${this.conversation.errors.length > 0 ? this.renderErrors() : ''}
  </div>

  <script>
    ${this.getScript()}
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

      body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground, #cccccc);
        background-color: var(--vscode-editor-background, #1e1e1e);
        line-height: 1.5;
      }

      .chat-container {
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }

      .chat-header {
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--vscode-panel-border, #454545);
      }

      .chat-header h1 {
        font-size: 1.5em;
        font-weight: 600;
        margin-bottom: 8px;
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
    `;
  }

  private getScript(): string {
    return `
      const vscode = acquireVsCodeApi();

      // Signal ready
      vscode.postMessage({ type: 'ready' });

      // Handle message clicks to open source file
      document.querySelectorAll('.message').forEach(el => {
        el.addEventListener('dblclick', () => {
          const filename = el.getAttribute('data-filename');
          if (filename) {
            vscode.postMessage({ type: 'openFile', payload: filename });
          }
        });
      });
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
