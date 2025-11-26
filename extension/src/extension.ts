import * as vscode from 'vscode';
import * as path from 'path';
import { ChatPanel } from './chatPanel';
import { isVibeChannelFolder } from './schemaParser';
import { GitHubAuthService, GitHubUser } from './githubAuth';

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
        // Called from context menu
        folderPath = uri.fsPath;
      } else {
        // Called from command palette - show folder picker
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Open folder as VibeChannel',
          title: 'Select a VibeChannel folder',
        });

        if (result && result.length > 0) {
          folderPath = result[0].fsPath;
        }
      }

      if (folderPath) {
        if (isVibeChannelFolder(folderPath)) {
          ChatPanel.createOrShow(folderPath);
        } else {
          const action = await vscode.window.showWarningMessage(
            'This folder does not contain a schema.md file. Would you like to open it anyway?',
            'Open Anyway',
            'Cancel'
          );

          if (action === 'Open Anyway') {
            ChatPanel.createOrShow(folderPath);
          }
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

      // Find folders with schema.md
      const vibeChannelFolders: vscode.WorkspaceFolder[] = [];

      for (const folder of workspaceFolders) {
        if (isVibeChannelFolder(folder.uri.fsPath)) {
          vibeChannelFolders.push(folder);
        }
      }

      if (vibeChannelFolders.length === 0) {
        // Check if any file is open and its parent folder has schema.md
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const folderPath = path.dirname(activeEditor.document.uri.fsPath);
          if (isVibeChannelFolder(folderPath)) {
            ChatPanel.createOrShow(folderPath);
            return;
          }
        }

        vscode.window.showInformationMessage(
          'No VibeChannel folder found in workspace. A VibeChannel folder must contain a schema.md file.'
        );
        return;
      }

      if (vibeChannelFolders.length === 1) {
        ChatPanel.createOrShow(vibeChannelFolders[0].uri.fsPath);
        return;
      }

      // Multiple folders found - let user pick
      const items = vibeChannelFolders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a VibeChannel folder to open',
      });

      if (selected) {
        ChatPanel.createOrShow(selected.folder.uri.fsPath);
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

  // Create status bar item for VibeChannel
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'vibechannel.openCurrent';
  statusBarItem.tooltip = 'Open VibeChannel Chat';
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

  // Update status bar based on current workspace
  updateStatusBar();

  // Watch for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateStatusBar();
    })
  );

  // Watch for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateStatusBar();
    })
  );

  // Auto-open if configured and workspace is a VibeChannel folder
  const config = vscode.workspace.getConfiguration('vibechannel');
  if (config.get('autoOpen', false)) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const firstFolder = workspaceFolders[0].uri.fsPath;
      if (isVibeChannelFolder(firstFolder)) {
        ChatPanel.createOrShow(firstFolder);
      }
    }
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  let showStatusBar = false;

  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      if (isVibeChannelFolder(folder.uri.fsPath)) {
        showStatusBar = true;
        break;
      }
    }
  }

  // Also check active editor's folder
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const folderPath = path.dirname(activeEditor.document.uri.fsPath);
    if (isVibeChannelFolder(folderPath)) {
      showStatusBar = true;
    }
  }

  if (showStatusBar) {
    statusBarItem.text = '$(comment-discussion) VibeChannel';
    statusBarItem.show();
  } else {
    statusBarItem.hide();
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
