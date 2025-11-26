import * as vscode from 'vscode';
import * as path from 'path';
import { ChatPanel } from './chatPanel';
import { isVibeChannelFolder } from './schemaParser';

let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('VibeChannel extension activated');

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
          openLabel: 'Open as Chat',
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

  context.subscriptions.push(openFolderCommand, openCurrentCommand, refreshCommand);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'vibechannel.openCurrent';
  statusBarItem.tooltip = 'Open VibeChannel Chat';
  context.subscriptions.push(statusBarItem);

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

export function deactivate(): void {
  console.log('VibeChannel extension deactivated');
}
