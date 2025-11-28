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
        vscode.window.showErrorMessage(
          'VibeChannel requires a Git repository. Initialize git first with "git init".'
        );
        return;
      }

      // Check if vibechannel branch exists, if not ask to initialize
      const gitService = GitService.getInstance();
      const isInitialized = gitService.isInitialized();

      if (!isInitialized) {
        const action = await vscode.window.showInformationMessage(
          'VibeChannel is not set up in this repository. Would you like to initialize it?',
          'Initialize',
          'Cancel'
        );

        if (action !== 'Initialize') {
          return;
        }
      }

      // Open the chat panel (this will initialize if needed)
      await ChatPanel.createOrShow(workspacePath);
      updateStatusBar();
    }
  );

  const refreshCommand = vscode.commands.registerCommand(
    'vibechannel.refresh',
    () => {
      ChatPanel.refresh();
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
