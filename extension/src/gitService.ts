import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const VIBECHANNEL_BRANCH = 'vibechannel';
export const WORKTREE_DIR = 'vibechannel-worktree';

export interface GitServiceConfig {
  repoPath: string;
  branchName: string;
  worktreePath: string;
}

export interface PushResult {
  success: boolean;
  noRemote: boolean;
  error?: string;
}

interface InitState {
  hasRemoteOrigin: boolean;
  hasRemoteBranch: boolean;
  hasLocalBranch: boolean;
  hasWorktree: boolean;
  worktreeValid: boolean;
}

export class GitService {
  private static instance: GitService | undefined;
  private config: GitServiceConfig | undefined;
  private initialized = false;

  private constructor() {}

  static getInstance(): GitService {
    if (!GitService.instance) {
      GitService.instance = new GitService();
    }
    return GitService.instance;
  }

  getWorktreePath(): string | undefined {
    return this.config?.worktreePath;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Main initialization method:
   * 1. FETCH (if remote origin exists)
   * 2. DETECT current state
   * 3. RESOLVE local branch
   * 4. RESOLVE worktree
   * 5. SYNC with remote
   * 6. PUSH to remote (if we created new content)
   */
  async initialize(repoPath: string): Promise<void> {
    console.log('GitService: Starting initialization...');

    if (!this.isGitRepo(repoPath)) {
      throw new Error('This folder is not a Git repository. Initialize Git first.');
    }

    const gitDir = path.join(repoPath, '.git');
    const worktreePath = path.join(gitDir, WORKTREE_DIR);

    this.config = {
      repoPath,
      branchName: VIBECHANNEL_BRANCH,
      worktreePath,
    };

    // Step 1 & 2: FETCH and DETECT state
    const state = await this.detectState();
    console.log('GitService: Initial state:', JSON.stringify(state, null, 2));

    // Step 3: RESOLVE local branch
    await this.resolveLocalBranch(state);

    // Step 4: RESOLVE worktree (and populate if new)
    await this.resolveWorktree(state);

    // Step 5: SYNC with remote (pull if remote exists)
    if (state.hasRemoteBranch) {
      console.log('GitService: Pulling latest from remote...');
      await this.pull();
    }

    // Step 6: PUSH to remote (if we created new content and remote exists)
    if (state.hasRemoteOrigin && !state.hasRemoteBranch) {
      console.log('GitService: Pushing new branch to remote...');
      const pushResult = await this.push();
      if (pushResult.success) {
        console.log('GitService: Successfully pushed to remote');
      } else if (!pushResult.noRemote) {
        console.warn('GitService: Failed to push to remote:', pushResult.error);
      }
    }

    this.initialized = true;
    console.log('GitService: Initialization complete!');
    console.log('GitService: Worktree at:', worktreePath);
  }

  private async detectState(): Promise<InitState> {
    if (!this.config) {
      throw new Error('Config not set');
    }

    const hasRemoteOrigin = this.hasRemoteOrigin();

    // Fetch from remote to get latest refs
    if (hasRemoteOrigin) {
      console.log('GitService: Fetching from remote...');
      try {
        await execAsync('git fetch origin', { cwd: this.config.repoPath });
      } catch (error) {
        console.warn('GitService: Fetch failed (continuing anyway):', error);
      }
    }

    const hasRemoteBranch = hasRemoteOrigin ? await this.checkRemoteBranch() : false;
    const hasLocalBranch = await this.checkLocalBranch();
    const { exists: hasWorktree, valid: worktreeValid } = this.checkWorktree();

    return {
      hasRemoteOrigin,
      hasRemoteBranch,
      hasLocalBranch,
      hasWorktree,
      worktreeValid,
    };
  }

  private async resolveLocalBranch(state: InitState): Promise<void> {
    if (!this.config) return;

    if (state.hasLocalBranch) {
      console.log('GitService: Local branch already exists');
      return;
    }

    if (state.hasRemoteBranch) {
      console.log('GitService: Creating local branch from remote...');
      await execAsync(
        `git branch ${this.config.branchName} origin/${this.config.branchName}`,
        { cwd: this.config.repoPath }
      );
    } else {
      console.log('GitService: Creating new orphan branch...');
      await this.createOrphanBranch();
    }
  }

  private async resolveWorktree(state: InitState): Promise<void> {
    if (!this.config) return;

    if (state.hasWorktree && !state.worktreeValid) {
      console.log('GitService: Removing corrupted worktree...');
      await this.removeWorktree();
    }

    const needsPopulation = !state.hasWorktree || !state.worktreeValid;

    if (needsPopulation) {
      console.log('GitService: Setting up worktree...');
      await this.setupWorktree();

      // If fresh init (no remote branch), populate initial content
      if (!state.hasRemoteBranch) {
        await this.populateInitialContent();
      }
    } else {
      console.log('GitService: Worktree already exists and is valid');
    }
  }

  private isGitRepo(repoPath: string): boolean {
    const gitDir = path.join(repoPath, '.git');
    return fs.existsSync(gitDir);
  }

  private hasRemoteOrigin(): boolean {
    if (!this.config) return false;

    try {
      const remotes = execSync('git remote', {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });
      return remotes.includes('origin');
    } catch {
      return false;
    }
  }

  private async checkRemoteBranch(): Promise<boolean> {
    if (!this.config) return false;

    try {
      const result = execSync(
        `git branch -r --list origin/${this.config.branchName}`,
        { cwd: this.config.repoPath, encoding: 'utf-8' }
      );
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async checkLocalBranch(): Promise<boolean> {
    if (!this.config) return false;

    try {
      const result = execSync(`git branch --list ${this.config.branchName}`, {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  private checkWorktree(): { exists: boolean; valid: boolean } {
    if (!this.config) return { exists: false, valid: false };

    const worktreePath = this.config.worktreePath;

    if (!fs.existsSync(worktreePath)) {
      return { exists: false, valid: false };
    }

    const gitFile = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitFile)) {
      return { exists: true, valid: false };
    }

    try {
      const worktrees = execSync('git worktree list', {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });
      const isRegistered = worktrees.includes(worktreePath);
      return { exists: true, valid: isRegistered };
    } catch {
      return { exists: true, valid: false };
    }
  }

  /**
   * Create orphan branch with empty commit using git plumbing commands.
   * This approach NEVER touches the working directory or requires checkout.
   */
  private async createOrphanBranch(): Promise<void> {
    if (!this.config) return;

    const { repoPath, branchName } = this.config;

    // Create an empty tree object
    const emptyTree = execSync('git hash-object -t tree /dev/null', {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim();

    // Create a commit with that empty tree (no parent = orphan)
    const commit = execSync(
      `git commit-tree ${emptyTree} -m "Initialize VibeChannel branch"`,
      { cwd: repoPath, encoding: 'utf-8' }
    ).trim();

    // Create the branch ref pointing to that commit
    await execAsync(`git update-ref refs/heads/${branchName} ${commit}`, { cwd: repoPath });

    console.log(`GitService: Created orphan branch '${branchName}' at ${commit}`);
  }

  /**
   * Populate the worktree with initial VibeChannel structure.
   */
  private async populateInitialContent(): Promise<void> {
    if (!this.config?.worktreePath) return;

    const worktreePath = this.config.worktreePath;

    const entries = fs.readdirSync(worktreePath);
    const hasContent = entries.some(e => e !== '.git' && !e.startsWith('.'));
    if (hasContent) {
      console.log('GitService: Worktree already has content, skipping population');
      return;
    }

    console.log('GitService: Populating initial content in worktree...');

    const generalDir = path.join(worktreePath, 'general');
    fs.mkdirSync(generalDir, { recursive: true });
    fs.writeFileSync(path.join(generalDir, '.gitkeep'), '');
    fs.writeFileSync(
      path.join(worktreePath, 'README.md'),
      '# VibeChannel Data\n\nThis branch contains VibeChannel conversation data.\n'
    );
    fs.writeFileSync(path.join(worktreePath, 'schema.md'), this.getSchemaTemplate());
    fs.writeFileSync(path.join(worktreePath, 'agent.md'), this.getAgentTemplate());

    await execAsync('git add -A', { cwd: worktreePath });
    await execAsync('git commit -m "Add initial VibeChannel structure"', { cwd: worktreePath });
  }

  private async removeWorktree(): Promise<void> {
    if (!this.config) return;

    try {
      await execAsync(
        `git worktree remove "${this.config.worktreePath}" --force`,
        { cwd: this.config.repoPath }
      );
    } catch {
      if (fs.existsSync(this.config.worktreePath)) {
        fs.rmSync(this.config.worktreePath, { recursive: true, force: true });
      }
      await execAsync('git worktree prune', { cwd: this.config.repoPath }).catch(() => {});
    }
  }

  private async setupWorktree(): Promise<void> {
    if (!this.config) return;

    const { repoPath, branchName, worktreePath } = this.config;

    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    await execAsync(`git worktree add "${worktreePath}" ${branchName}`, { cwd: repoPath });
  }

  // === Channel and Message Operations ===

  async getChannels(): Promise<string[]> {
    if (!this.config?.worktreePath) return [];

    const worktreePath = this.config.worktreePath;
    if (!fs.existsSync(worktreePath)) return [];

    const entries = fs.readdirSync(worktreePath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  }

  async createChannel(channelName: string): Promise<void> {
    if (!this.config?.worktreePath) return;

    const channelPath = path.join(this.config.worktreePath, channelName);
    if (!fs.existsSync(channelPath)) {
      fs.mkdirSync(channelPath, { recursive: true });
      fs.writeFileSync(path.join(channelPath, '.gitkeep'), '');
      await this.commitChanges(`Create #${channelName} channel`);
    }
  }

  async writeMessage(channel: string, filename: string, content: string): Promise<void> {
    if (!this.config?.worktreePath) return;

    const channelPath = path.join(this.config.worktreePath, channel);
    if (!fs.existsSync(channelPath)) {
      fs.mkdirSync(channelPath, { recursive: true });
    }

    const filePath = path.join(channelPath, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    await this.commitChanges(`Message in #${channel}`);
  }

  async commitChanges(message: string): Promise<void> {
    if (!this.config?.worktreePath) return;

    try {
      await execAsync('git add -A', { cwd: this.config.worktreePath });
      await execAsync(`git commit -m "${message}"`, { cwd: this.config.worktreePath });
    } catch (error) {
      console.log('GitService: Commit result:', error);
    }
  }

  // === Remote Operations ===

  hasRemote(): boolean {
    if (!this.config?.worktreePath) return false;

    try {
      const remotes = execSync('git remote', {
        cwd: this.config.worktreePath,
        encoding: 'utf-8',
      });
      return remotes.includes('origin');
    } catch {
      return false;
    }
  }

  async push(): Promise<PushResult> {
    if (!this.config?.worktreePath) {
      return { success: false, noRemote: true };
    }

    try {
      if (!this.hasRemote()) {
        return { success: false, noRemote: true };
      }

      try {
        await execAsync(`git push -u origin ${this.config.branchName}`, {
          cwd: this.config.worktreePath,
        });
      } catch {
        await execAsync(`git push origin ${this.config.branchName}`, {
          cwd: this.config.worktreePath,
        });
      }
      return { success: true, noRemote: false };
    } catch (error) {
      console.error('GitService: Push failed:', error);
      return { success: false, noRemote: false, error: String(error) };
    }
  }

  async fetch(): Promise<boolean> {
    if (!this.config?.worktreePath) return false;

    try {
      if (!this.hasRemote()) return false;
      await execAsync(`git fetch origin ${this.config.branchName}`, {
        cwd: this.config.worktreePath,
      });
      return true;
    } catch {
      return false;
    }
  }

  async hasRemoteChanges(): Promise<boolean> {
    if (!this.config?.worktreePath) return false;

    try {
      const result = execSync(
        `git rev-list HEAD..origin/${this.config.branchName} --count`,
        { cwd: this.config.worktreePath, encoding: 'utf-8' }
      );
      return parseInt(result.trim(), 10) > 0;
    } catch {
      return false;
    }
  }

  async pull(): Promise<boolean> {
    if (!this.config?.worktreePath) return false;

    try {
      await execAsync(`git pull origin ${this.config.branchName}`, {
        cwd: this.config.worktreePath,
      });
      return true;
    } catch (error) {
      console.error('GitService: Pull failed:', error);
      await this.resolveConflicts();
      return false;
    }
  }

  private async resolveConflicts(): Promise<void> {
    if (!this.config?.worktreePath) return;

    try {
      await execAsync('git checkout --ours .', { cwd: this.config.worktreePath }).catch(() => {});
      await execAsync('git add -A', { cwd: this.config.worktreePath });
      await execAsync('git commit -m "Resolve conflicts (auto)"', {
        cwd: this.config.worktreePath,
      }).catch(() => {});
    } catch {
      // Ignore
    }
  }

  getChannelPath(channel: string): string | undefined {
    if (!this.config?.worktreePath) return undefined;
    return path.join(this.config.worktreePath, channel);
  }

  private getSchemaTemplate(): string {
    return `# VibeChannel Schema

This file defines the format for VibeChannel conversations.

## Folder Structure

\`\`\`yaml
root: /
channels: subfolders (e.g., general/, random/, dev/)
messages: markdown files inside channel folders
\`\`\`

## Filename Convention

\`\`\`yaml
pattern: "{timestamp}-{sender}-{id}.md"
timestamp:
  format: "%Y%m%dT%H%M%S"
  example: "20250115T103045"
sender:
  format: "lowercase alphanumeric, no spaces"
  example: "lucas"
id:
  length: 6
  charset: "a-z0-9"
  example: "a3f8x2"
\`\`\`

## Message Format

\`\`\`yaml
from: string        # Sender identifier
date: datetime      # ISO 8601 format
reply_to: string    # Optional: filename of parent message
tags: [array]       # Optional: categorization tags
\`\`\`

## Rendering Preferences

\`\`\`yaml
rendering:
  sort_by: date
  order: ascending
  group_by: date
  timestamp_display: relative
\`\`\`
`;
  }

  private getAgentTemplate(): string {
    return `# Agent Instructions for VibeChannel

This branch contains conversations following the VibeChannel protocol.

**IMPORTANT:** Read \`schema.md\` for the complete format specification.

## Quick Start

1. Each channel is a subfolder (e.g., general/, random/)
2. Each message is a \`.md\` file: \`{timestamp}-{sender}-{id}.md\`
3. Use YAML frontmatter + markdown body

## Example Message

\`\`\`markdown
---
from: lucas
date: 2025-01-15T10:30:45Z
---

Your message content here.
\`\`\`
`;
  }

  getHeadCommit(): string | undefined {
    if (!this.config?.worktreePath) return undefined;

    try {
      return execSync('git rev-parse HEAD', {
        cwd: this.config.worktreePath,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    GitService.instance = undefined;
    this.initialized = false;
  }
}
