import * as vscode from 'vscode';
import * as path from 'path';
import { ChatPanel } from './chatPanel';
import { GitHubAuthService, GitHubUser } from './githubAuth';
import {
  hasVibeChannel,
  initializeVibeChannel,
  showChannelPicker,
  getChannels,
  isChannelFolder,
  isVibeChannelRoot,
  getWorkspaceFromVibeChannelRoot,
  VIBECHANNEL_FOLDER,
  DEFAULT_CHANNEL,
  getVibeChannelRoot,
} from './channelManager';

let statusBarItem: vscode.StatusBarItem | undefined;
let accountStatusBarItem: vscode.StatusBarItem | undefined;
let authService: GitHubAuthService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('VibeChannel extension activated');

  // Initialize auth service
  authService = GitHubAuthService.getInstance();
  context.subscriptions.push(authService);

  // Register commands
  const openFolderCommand = vscode.commands.registerCommand(
    'vibechannel.openFolder',
    async (uri?: vscode.Uri) => {
      let folderPath: string | undefined;

      if (uri) {
        // Called from context menu - check if it's a channel folder
        folderPath = uri.fsPath;

        // If it's a channel folder inside .vibechannel, open it directly
        if (isChannelFolder(folderPath)) {
          ChatPanel.createOrShow(folderPath);
          return;
        }

        // If it's the .vibechannel folder itself, show channel picker for parent workspace
        if (isVibeChannelRoot(folderPath)) {
          const workspacePath = getWorkspaceFromVibeChannelRoot(folderPath);
          const channelPath = await showChannelPicker(workspacePath);
          if (channelPath) {
            ChatPanel.createOrShow(channelPath);
          }
          return;
        }

        // Check if it has a .vibechannel subfolder
        if (hasVibeChannel(folderPath)) {
          // Show channel picker for this folder
          const channelPath = await showChannelPicker(folderPath);
          if (channelPath) {
            ChatPanel.createOrShow(channelPath);
          }
          return;
        }

        // Not a VibeChannel folder, ask to initialize
        const action = await vscode.window.showInformationMessage(
          'This folder does not have VibeChannel set up. Would you like to initialize it?',
          'Initialize',
          'Cancel'
        );

        if (action === 'Initialize') {
          const generalPath = initializeVibeChannel(folderPath);
          vscode.window.showInformationMessage('VibeChannel initialized with #general channel');
          ChatPanel.createOrShow(generalPath);
        }
      } else {
        // Called from command palette - use workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const channelPath = await showChannelPicker(workspacePath);
        if (channelPath) {
          ChatPanel.createOrShow(channelPath);
        }
      }
    }
  );

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

      // Check if .vibechannel exists, if not initialize it
      if (!hasVibeChannel(workspacePath)) {
        const action = await vscode.window.showInformationMessage(
          'VibeChannel is not set up in this workspace. Would you like to initialize it?',
          'Initialize',
          'Cancel'
        );

        if (action === 'Initialize') {
          const generalPath = initializeVibeChannel(workspacePath);
          vscode.window.showInformationMessage('VibeChannel initialized with #general channel');
          ChatPanel.createOrShow(generalPath);
        }
        return;
      }

      // Show channel picker
      const channelPath = await showChannelPicker(workspacePath);
      if (channelPath) {
        ChatPanel.createOrShow(channelPath);
      }
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
    openFolderCommand,
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
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspacePath = workspaceFolders[0].uri.fsPath;

    if (hasVibeChannel(workspacePath)) {
      const channels = getChannels(workspacePath);
      statusBarItem.text = `$(comment-discussion) VibeChannel (${channels.length})`;
      statusBarItem.tooltip = `Open VibeChannel - ${channels.length} channel${channels.length !== 1 ? 's' : ''}`;
    } else {
      statusBarItem.text = '$(comment-discussion) VibeChannel';
      statusBarItem.tooltip = 'Initialize VibeChannel';
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

export function deactivate(): void {
  console.log('VibeChannel extension deactivated');
}
