import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ChatPanel } from './chatPanel';
import { GitHubAuthService, GitHubUser } from './githubAuth';
import { GitService } from './gitService';
import { SyncService } from './syncService';

let statusBarItem: vscode.StatusBarItem | undefined;
let accountStatusBarItem: vscode.StatusBarItem | undefined;
let authService: GitHubAuthService | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let hasUnread = false;

export function activate(context: vscode.ExtensionContext): void {
  console.log('VibeChannel extension activated');

  // Store context for use in helper functions
  extensionContext = context;

  // Initialize auth service
  authService = GitHubAuthService.getInstance();
  context.subscriptions.push(authService);

  // Register commands
  const openCurrentCommand = vscode.commands.registerCommand(
    'vibechannel.openCurrent',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      // Use the first workspace folder
      const workspacePath = workspaceFolders[0].uri.fsPath;

      // Check if this is a git repository
      if (!isGitRepo(workspacePath)) {
        const action = await vscode.window.showInformationMessage(
          'VibeChannel requires a Git repository. Would you like to initialize one?',
          'Initialize Git',
          'Cancel'
        );

        if (action === 'Initialize Git') {
          try {
            execSync('git init', { cwd: workspacePath, stdio: 'pipe' });
            vscode.window.showInformationMessage('Git repository initialized successfully!');
          } catch (error) {
            vscode.window.showErrorMessage('Failed to initialize Git repository.');
            return;
          }
        } else {
          return;
        }
      }

      // Validate remote connection
      const gitService = GitService.getInstance();
      const remoteResult = await gitService.validateRemote(workspacePath);

      let connectionMode: 'connected' | 'local-only' | 'offline' = 'connected';

      if (!remoteResult.hasRemote) {
        // No remote configured - ask user what to do
        const action = await vscode.window.showInformationMessage(
          'No remote repository configured. VibeChannel can work in local-only mode, but messages won\'t sync to a remote server.',
          'Continue (Local Only)',
          'Cancel'
        );
        if (action !== 'Continue (Local Only)') {
          return;
        }
        connectionMode = 'local-only';
      } else if (!remoteResult.isReachable) {
        // Remote exists but not reachable - show specific error
        let message: string;
        let options: string[];

        switch (remoteResult.error) {
          case 'repo-not-found':
            message = `Remote repository not found: ${remoteResult.remoteUrl}\n\nThe repository may have been deleted or you don't have access.`;
            options = ['Continue Offline', 'Cancel'];
            break;
          case 'auth-failed':
            message = `Authentication failed for: ${remoteResult.remoteUrl}\n\nPlease check your credentials or sign in with GitHub.`;
            options = ['Sign In', 'Continue Offline', 'Cancel'];
            break;
          case 'network-error':
            message = `Cannot reach remote: ${remoteResult.remoteUrl}\n\nPlease check your network connection.`;
            options = ['Continue Offline', 'Retry', 'Cancel'];
            break;
          case 'invalid-url':
            message = `Invalid remote URL: ${remoteResult.remoteUrl}`;
            options = ['Continue Offline', 'Cancel'];
            break;
          default:
            message = `Cannot connect to remote: ${remoteResult.remoteUrl}`;
            options = ['Continue Offline', 'Cancel'];
        }

        const action = await vscode.window.showWarningMessage(message, ...options);

        if (action === 'Cancel' || !action) {
          return;
        } else if (action === 'Sign In') {
          await vscode.commands.executeCommand('vibechannel.signIn');
          // Retry after sign in
          const retryResult = await gitService.validateRemote(workspacePath);
          if (!retryResult.isReachable) {
            vscode.window.showErrorMessage('Still unable to connect after signing in. Continuing in offline mode.');
            connectionMode = 'offline';
          }
        } else if (action === 'Retry') {
          const retryResult = await gitService.validateRemote(workspacePath);
          if (!retryResult.isReachable) {
            vscode.window.showWarningMessage('Still unable to connect. Continuing in offline mode.');
            connectionMode = 'offline';
          }
        } else {
          connectionMode = 'offline';
        }
      }

      // Check if vibechannel branch exists, if not ask to initialize
      const isInitialized = gitService.isInitialized();

      if (!isInitialized) {
        let initMessage = 'VibeChannel is not set up in this repository. Would you like to initialize it?';
        if (connectionMode === 'local-only') {
          initMessage = 'Initialize VibeChannel in local-only mode? Messages will be stored locally but not synced.';
        } else if (connectionMode === 'offline') {
          initMessage = 'Initialize VibeChannel in offline mode? You can sync when connection is restored.';
        }

        const action = await vscode.window.showInformationMessage(
          initMessage,
          'Initialize',
          'Cancel'
        );

        if (action !== 'Initialize') {
          return;
        }
      }

      // Open the chat panel (this will initialize if needed)
      await ChatPanel.createOrShow(workspacePath, connectionMode);
      updateStatusBar();
    }
  );

  const refreshCommand = vscode.commands.registerCommand(
    'vibechannel.refresh',
    async () => {
      if (ChatPanel.isPanelOpen()) {
        ChatPanel.refresh();
      } else {
        // Panel not open - ask user to open it
        const action = await vscode.window.showInformationMessage(
          'VibeChannel is not open. Would you like to open it?',
          'Open VibeChannel',
          'Cancel'
        );
        if (action === 'Open VibeChannel') {
          vscode.commands.executeCommand('vibechannel.openCurrent');
        }
      }
    }
  );

  // GitHub auth commands
  const signInCommand = vscode.commands.registerCommand(
    'vibechannel.signIn',
    async () => {
      const user = await authService?.signIn();
      if (user) {
        vscode.window.showInformationMessage(
          `Signed in as ${user.name || user.login}`
        );
        // Refresh chat panel to show updated auth state
        ChatPanel.refresh();
      }
    }
  );

  const signOutCommand = vscode.commands.registerCommand(
    'vibechannel.signOut',
    async () => {
      await authService?.signOut();
      ChatPanel.refresh();
    }
  );

  const showAccountCommand = vscode.commands.registerCommand(
    'vibechannel.showAccount',
    async () => {
      const user = authService?.getUser();

      if (user) {
        const action = await vscode.window.showInformationMessage(
          `Signed in as ${user.name || user.login} (@${user.login})`,
          'Sign Out',
          'OK'
        );

        if (action === 'Sign Out') {
          await authService?.signOut();
          ChatPanel.refresh();
        }
      } else {
        const action = await vscode.window.showInformationMessage(
          'Not signed in to GitHub',
          'Sign In',
          'Cancel'
        );

        if (action === 'Sign In') {
          await authService?.signIn();
          ChatPanel.refresh();
        }
      }
    }
  );

  context.subscriptions.push(
    openCurrentCommand,
    refreshCommand,
    signInCommand,
    signOutCommand,
    showAccountCommand
  );

  // Register webview panel serializer to restore panels after extension reload
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(ChatPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { repoPath?: string; currentChannel?: string }) {
        console.log('VibeChannel: Restoring webview panel', state);

        // Get workspace path - prefer saved state, fallback to current workspace
        let repoPath = state?.repoPath;
        if (!repoPath) {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders && workspaceFolders.length > 0) {
            repoPath = workspaceFolders[0].uri.fsPath;
          }
        }

        if (repoPath && isGitRepo(repoPath)) {
          await ChatPanel.revive(panel, repoPath, state?.currentChannel);
        } else {
          // Can't restore - dispose the panel
          panel.dispose();
        }
      },
    })
  );

  // Create status bar item for VibeChannel - always show it
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'vibechannel.openCurrent';
  statusBarItem.tooltip = 'Open VibeChannel';
  statusBarItem.text = '$(comment-discussion) VibeChannel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Create account status bar item
  accountStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    50
  );
  accountStatusBarItem.command = 'vibechannel.showAccount';
  context.subscriptions.push(accountStatusBarItem);

  // Listen for auth state changes
  context.subscriptions.push(
    authService.onAuthStateChange((user) => {
      updateAccountStatusBar(user);
    })
  );

  // Update status bar to show channel count if initialized
  updateStatusBar();

  // Watch for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateStatusBar();
    })
  );

  // Initialize unread state and listen for sync events
  initializeUnreadState();
}

function isGitRepo(workspacePath: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: workspacePath, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  const badge = hasUnread ? ' 🔵' : '';

  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspacePath = workspaceFolders[0].uri.fsPath;

    if (isGitRepo(workspacePath)) {
      const gitService = GitService.getInstance();
      const worktreePath = gitService.getWorktreePath();

      if (worktreePath && fs.existsSync(worktreePath)) {
        // Count channels in worktree
        const channels = fs.readdirSync(worktreePath)
          .filter((name) => {
            const fullPath = path.join(worktreePath, name);
            return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
          });
        statusBarItem.text = `$(comment-discussion) VibeChannel (${channels.length})${badge}`;
        statusBarItem.tooltip = hasUnread
          ? `Open VibeChannel - New messages!`
          : `Open VibeChannel - ${channels.length} channel${channels.length !== 1 ? 's' : ''}`;
      } else {
        statusBarItem.text = `$(comment-discussion) VibeChannel${badge}`;
        statusBarItem.tooltip = 'Initialize VibeChannel';
      }
    } else {
      statusBarItem.text = '$(comment-discussion) VibeChannel';
      statusBarItem.tooltip = 'Requires Git repository';
    }
  }
}

function updateAccountStatusBar(user: GitHubUser | null): void {
  if (!accountStatusBarItem) {
    return;
  }

  if (user) {
    accountStatusBarItem.text = `$(github) ${user.login}`;
    accountStatusBarItem.tooltip = `Signed in as ${user.name || user.login}`;
    accountStatusBarItem.show();
  } else {
    accountStatusBarItem.text = '$(github) Sign In';
    accountStatusBarItem.tooltip = 'Sign in with GitHub';
    accountStatusBarItem.show();
  }
}

// === Unread Badge Logic ===

function getLastSeenCommitKey(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return 'vibechannel.lastSeenCommit.default';
  }
  // Use workspace path as key to track per-workspace
  const workspacePath = workspaceFolders[0].uri.fsPath;
  return `vibechannel.lastSeenCommit.${workspacePath}`;
}

function getLastSeenCommit(): string | undefined {
  if (!extensionContext) return undefined;
  return extensionContext.globalState.get<string>(getLastSeenCommitKey());
}

function setLastSeenCommit(commitHash: string): void {
  if (!extensionContext) return;
  extensionContext.globalState.update(getLastSeenCommitKey(), commitHash);
}

function initializeUnreadState(): void {
  const gitService = GitService.getInstance();
  if (!gitService.isInitialized()) return;

  const currentCommit = gitService.getHeadCommit();
  const lastSeenCommit = getLastSeenCommit();

  if (!currentCommit) return;

  if (!lastSeenCommit) {
    // First time - mark current as seen
    setLastSeenCommit(currentCommit);
    hasUnread = false;
  } else if (currentCommit !== lastSeenCommit) {
    // There are new commits since last seen
    hasUnread = true;
  }

  updateStatusBar();

  // Listen for sync events
  const syncService = SyncService.getInstance();
  extensionContext?.subscriptions.push(
    syncService.onSync((event) => {
      if (event.type === 'newMessages') {
        // New messages pulled - check if panel is visible
        if (!ChatPanel.isPanelVisible()) {
          hasUnread = true;
          updateStatusBar();
        }
      }
    })
  );
}

export function markMessagesAsRead(): void {
  const gitService = GitService.getInstance();
  const currentCommit = gitService.getHeadCommit();
  if (currentCommit) {
    setLastSeenCommit(currentCommit);
  }
  hasUnread = false;
  updateStatusBar();
}

export function deactivate(): void {
  console.log('VibeChannel extension deactivated');

  // Clean up services
  try {
    SyncService.getInstance().dispose();
  } catch {
    // Service may not have been initialized
  }
  try {
    GitService.getInstance().dispose();
  } catch {
    // Service may not have been initialized
  }
}
