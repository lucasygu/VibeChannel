import * as vscode from 'vscode';
import * as notifier from 'node-notifier';
import * as path from 'path';
import { Message } from './messageParser';
import { GitHubAuthService } from './githubAuth';

export type NotificationSetting = 'all' | 'mentions' | 'none';

export class NotificationService implements vscode.Disposable {
  private static instance: NotificationService | undefined;
  private lastSeenTimestamps: Map<string, Date> = new Map();
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vibechannel.notifications') ||
            e.affectsConfiguration('vibechannel.notificationSound')) {
          // Settings updated, will take effect on next notification
        }
      })
    );
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Get current notification setting
   */
  private getNotificationSetting(): NotificationSetting {
    const config = vscode.workspace.getConfiguration('vibechannel');
    return config.get<NotificationSetting>('notifications') || 'all';
  }

  /**
   * Check if sound is enabled
   */
  private isSoundEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('vibechannel');
    return config.get<boolean>('notificationSound') ?? true;
  }

  /**
   * Get current user's GitHub username (to check for mentions)
   */
  private async getCurrentUsername(): Promise<string | undefined> {
    const user = await GitHubAuthService.getInstance().getUser();
    return user?.login;
  }

  /**
   * Check if a message mentions the current user
   */
  private async isMentioned(message: Message): Promise<boolean> {
    const username = await this.getCurrentUsername();
    if (!username) return false;

    const content = message.content.toLowerCase();
    const mentionPattern = `@${username.toLowerCase()}`;
    return content.includes(mentionPattern);
  }

  /**
   * Initialize tracking for a channel (call when loading channel)
   */
  initializeChannel(channel: string, messages: Message[]): void {
    if (messages.length === 0) {
      this.lastSeenTimestamps.set(channel, new Date(0));
      return;
    }

    // Set last seen to the most recent message
    const latestMessage = messages.reduce((latest, msg) =>
      msg.date > latest.date ? msg : latest
    );
    this.lastSeenTimestamps.set(channel, latestMessage.date);
  }

  /**
   * Check for new messages and notify if appropriate
   * @param channel The channel name
   * @param messages All messages in the channel (after refresh)
   * @param panelVisible Whether the chat panel is currently visible
   */
  async checkAndNotify(
    channel: string,
    messages: Message[],
    panelVisible: boolean
  ): Promise<void> {
    const setting = this.getNotificationSetting();
    if (setting === 'none') return;

    // Don't notify if panel is visible and focused
    if (panelVisible && vscode.window.state.focused) {
      // Update last seen timestamp
      this.initializeChannel(channel, messages);
      return;
    }

    const lastSeen = this.lastSeenTimestamps.get(channel) || new Date(0);

    // Find messages newer than last seen
    const newMessages = messages.filter(msg => msg.date > lastSeen);

    if (newMessages.length === 0) return;

    // Filter by current user (don't notify for own messages)
    const currentUser = await this.getCurrentUsername();
    const otherMessages = newMessages.filter(msg =>
      msg.from.toLowerCase() !== currentUser?.toLowerCase()
    );

    if (otherMessages.length === 0) {
      // Update last seen even if all messages were from self
      this.initializeChannel(channel, messages);
      return;
    }

    // If set to 'mentions', filter to only mentioned messages
    let messagesToNotify = otherMessages;
    if (setting === 'mentions') {
      const mentionChecks = await Promise.all(
        otherMessages.map(async (msg) => ({
          msg,
          mentioned: await this.isMentioned(msg)
        }))
      );
      messagesToNotify = mentionChecks
        .filter(({ mentioned }) => mentioned)
        .map(({ msg }) => msg);
    }

    if (messagesToNotify.length === 0) {
      // Update last seen timestamp
      this.initializeChannel(channel, messages);
      return;
    }

    // Get the most recent message for notification
    const latestMessage = messagesToNotify.reduce((latest, msg) =>
      msg.date > latest.date ? msg : latest
    );

    // Show notification
    await this.showNotification(channel, latestMessage, messagesToNotify.length);

    // Update last seen timestamp
    this.initializeChannel(channel, messages);
  }

  /**
   * Show notification using appropriate method based on VS Code focus state
   */
  private async showNotification(
    channel: string,
    message: Message,
    totalNewCount: number
  ): Promise<void> {
    const title = totalNewCount > 1
      ? `${totalNewCount} new messages in #${channel}`
      : `New message in #${channel}`;

    const body = `${message.from}: ${this.truncateMessage(message.content, 100)}`;

    if (vscode.window.state.focused) {
      // VS Code is focused - use toast notification
      const action = await vscode.window.showInformationMessage(
        `${title}\n${body}`,
        'Open'
      );

      if (action === 'Open') {
        // Panel should already be open, just reveal it
        vscode.commands.executeCommand('vibechannel.openCurrent');
      }
    } else {
      // VS Code is not focused - use OS notification with optional sound
      const soundEnabled = this.isSoundEnabled();

      notifier.notify({
        title: 'VibeChannel',
        subtitle: title,
        message: body,
        sound: soundEnabled,
        wait: true, // Wait for user interaction
        timeout: 10, // Notification disappears after 10 seconds
      }, (err, response, metadata) => {
        // Handle notification click
        if (response === 'activate' || metadata?.activationType === 'contentsClicked') {
          // Focus VS Code window and open panel
          vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
          vscode.commands.executeCommand('vibechannel.openCurrent');
        }
      });
    }
  }

  /**
   * Truncate message body for notification preview
   */
  private truncateMessage(body: string, maxLength: number): string {
    // Remove markdown formatting for cleaner preview
    let text = body
      .replace(/\*\*(.+?)\*\*/g, '$1') // Bold
      .replace(/\*(.+?)\*/g, '$1') // Italic
      .replace(/`(.+?)`/g, '$1') // Inline code
      .replace(/```[\s\S]*?```/g, '[code]') // Code blocks
      .replace(/!\[.*?\]\(.*?\)/g, '[image]') // Images
      .replace(/\[(.+?)\]\(.*?\)/g, '$1') // Links
      .replace(/\n/g, ' ') // Newlines to spaces
      .trim();

    if (text.length > maxLength) {
      text = text.substring(0, maxLength - 3) + '...';
    }

    return text;
  }

  /**
   * Reset tracking (call when switching repos)
   */
  reset(): void {
    this.lastSeenTimestamps.clear();
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.lastSeenTimestamps.clear();
    NotificationService.instance = undefined;
  }
}
