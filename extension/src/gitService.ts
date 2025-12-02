import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const VIBECHANNEL_BRANCH = 'vibechannel';
export const WORKTREE_DIR = 'vibechannel-worktree';
export const ASSETS_DIR = '.assets';

export interface GitServiceConfig {
  repoPath: string;
  branchName: string;
  worktreePath: string;
}

export interface PushResult {
  success: boolean;
  noRemote: boolean;
  noPermission?: boolean;
  error?: string;
}

export interface AccessCheckResult {
  canWrite: boolean;
  reason?: 'no-remote' | 'no-permission' | 'unknown';
}

export interface RemoteValidationResult {
  hasRemote: boolean;
  isReachable: boolean;
  error?: 'no-remote' | 'repo-not-found' | 'auth-failed' | 'network-error' | 'invalid-url';
  remoteUrl?: string;
}

export interface InitResult {
  success: boolean;
  readOnly: boolean;
  reason?: 'no-permission' | 'no-remote' | 'error';
  hasRemoteBranch: boolean;
  worktreePath?: string;
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
  private _readOnly = false;
  private _readOnlyReason: 'no-remote' | 'no-permission' | undefined;

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
   * Check if the repository is in read-only mode (no write access)
   */
  isReadOnly(): boolean {
    return this._readOnly;
  }

  /**
   * Get the reason for read-only mode
   */
  getReadOnlyReason(): 'no-remote' | 'no-permission' | undefined {
    return this._readOnlyReason;
  }

  /**
   * Mark the repository as read-only (called when push fails with permission error)
   */
  setReadOnly(reason: 'no-remote' | 'no-permission' | 'unknown'): void {
    this._readOnly = true;
    // Map 'unknown' to 'no-permission' for storage
    this._readOnlyReason = reason === 'unknown' ? 'no-permission' : reason;
    console.log(`GitService: Marked as read-only (reason: ${reason})`);
  }

  /**
   * Check if user has write access to the remote repository.
   *
   * NOTE: git push --dry-run does NOT verify server permissions (it only simulates locally).
   * We must do an actual push to test write access, then clean up the test ref.
   *
   * @returns AccessCheckResult with canWrite boolean and reason if false
   */
  async checkWriteAccess(): Promise<AccessCheckResult> {
    if (!this.config) {
      return { canWrite: false, reason: 'no-remote' };
    }

    // No remote = local-only, which is fine
    if (!this.hasRemoteOrigin()) {
      return { canWrite: true }; // Local-only mode is allowed
    }

    const testRef = '__vibechannel_access_check__';

    try {
      // Create an empty tree and commit for testing (minimal footprint)
      const emptyTree = execSync('git hash-object -t tree /dev/null', {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      }).trim();

      const testCommit = execSync(
        `git commit-tree ${emptyTree} -m "VibeChannel access check (will be deleted)"`,
        { cwd: this.config.repoPath, encoding: 'utf-8' }
      ).trim();

      // Actually push the test ref (--dry-run doesn't verify server permissions!)
      await execAsync(
        `git push origin ${testCommit}:refs/heads/${testRef}`,
        { cwd: this.config.repoPath }
      );

      // Success! Clean up the test ref
      console.log('GitService: Write access confirmed, cleaning up test ref...');
      await execAsync(
        `git push origin --delete ${testRef}`,
        { cwd: this.config.repoPath }
      ).catch(() => {
        // Ignore cleanup errors - the ref will be orphaned but harmless
        console.log('GitService: Could not delete test ref (will be orphaned)');
      });

      return { canWrite: true };
    } catch (error) {
      const errorStr = String(error);

      if (errorStr.includes('403') ||
          errorStr.includes('Permission') ||
          errorStr.includes('permission') ||
          errorStr.includes('denied') ||
          errorStr.includes('not allowed')) {
        console.log('GitService: No write access detected');
        return { canWrite: false, reason: 'no-permission' };
      }

      // Other errors (network, etc.) - assume can write, will fail later
      console.log('GitService: checkWriteAccess encountered non-permission error:', errorStr);
      return { canWrite: true };
    }
  }

  /**
   * Get the remote origin URL
   */
  getRemoteUrl(): string | undefined {
    if (!this.config) return undefined;

    try {
      const result = execSync('git remote get-url origin', {
        cwd: this.config.repoPath,
        encoding: 'utf-8'
      });
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Validate that the remote is configured and reachable.
   * Uses `git ls-remote` which is fast and doesn't require write access.
   */
  async validateRemote(repoPath?: string): Promise<RemoteValidationResult> {
    const cwd = repoPath || this.config?.repoPath;
    if (!cwd) {
      return { hasRemote: false, isReachable: false, error: 'no-remote' };
    }

    // Check if origin remote exists
    let remoteUrl: string | undefined;
    try {
      const remotes = execSync('git remote', { cwd, encoding: 'utf-8' });
      if (!remotes.includes('origin')) {
        return { hasRemote: false, isReachable: false, error: 'no-remote' };
      }
      remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf-8' }).trim();
    } catch {
      return { hasRemote: false, isReachable: false, error: 'no-remote' };
    }

    // Validate URL format
    if (!remoteUrl || (!remoteUrl.includes('github.com') && !remoteUrl.includes('gitlab.com') && !remoteUrl.includes('bitbucket.org') && !remoteUrl.startsWith('git@') && !remoteUrl.startsWith('https://'))) {
      // Allow any URL that looks like a git remote
      if (!remoteUrl || (!remoteUrl.includes('.git') && !remoteUrl.includes('git@') && !remoteUrl.startsWith('https://') && !remoteUrl.startsWith('http://'))) {
        return { hasRemote: true, isReachable: false, error: 'invalid-url', remoteUrl };
      }
    }

    // Test if remote is reachable with ls-remote (fast, read-only)
    try {
      await execAsync('git ls-remote --exit-code origin HEAD', { cwd, timeout: 15000 });
      return { hasRemote: true, isReachable: true, remoteUrl };
    } catch (error) {
      const errorStr = String(error);
      console.log('GitService: validateRemote error:', errorStr);

      // Categorize the error
      if (errorStr.includes('Repository not found') ||
          errorStr.includes('not found') ||
          errorStr.includes('does not exist') ||
          errorStr.includes('Could not read from remote')) {
        return { hasRemote: true, isReachable: false, error: 'repo-not-found', remoteUrl };
      }

      if (errorStr.includes('Authentication failed') ||
          errorStr.includes('Invalid username or password') ||
          errorStr.includes('403') ||
          errorStr.includes('401') ||
          errorStr.includes('Permission denied') ||
          errorStr.includes('permission denied')) {
        return { hasRemote: true, isReachable: false, error: 'auth-failed', remoteUrl };
      }

      if (errorStr.includes('Could not resolve host') ||
          errorStr.includes('unable to access') ||
          errorStr.includes('Connection refused') ||
          errorStr.includes('Connection timed out') ||
          errorStr.includes('Network is unreachable')) {
        return { hasRemote: true, isReachable: false, error: 'network-error', remoteUrl };
      }

      // Unknown error - treat as network issue
      return { hasRemote: true, isReachable: false, error: 'network-error', remoteUrl };
    }
  }

  // ============================================================================
  // LOCAL-ONLY MODE (Future Implementation)
  // ============================================================================
  //
  // Local-only mode would allow users to chat without pushing to remote.
  // This could be useful for:
  // - Experimenting with VibeChannel on repos they don't have write access to
  // - Drafting messages before pushing
  // - Offline usage
  //
  // Implementation considerations:
  // 1. Add a `_localOnlyMode: boolean` flag
  // 2. In local-only mode:
  //    - Still create commits locally
  //    - Skip push operations
  //    - Show a "local only" indicator in the UI
  //    - Provide option to "sync" (push) when user gains access
  // 3. UI should clearly indicate local-only status
  // 4. Consider how to handle conflicts when syncing later
  //
  // To enable: Add a setting `vibechannel.localOnlyMode` or auto-enable
  // when read-only mode is detected (with user consent).
  // ============================================================================

  /**
   * Main initialization method:
   * 1. RESET state for new repo
   * 2. FETCH (if remote origin exists)
   * 3. DETECT current state
   * 4. CHECK PERMISSION (if remote exists but no remote branch)
   * 5. RESOLVE local branch (only if we have permission or remote branch exists)
   * 6. RESOLVE worktree
   * 7. SYNC with remote
   * 8. PUSH to remote (if we created new content)
   *
   * @returns InitResult indicating success/failure and read-only status
   */
  async initialize(repoPath: string): Promise<InitResult> {
    console.log('GitService: Starting initialization...');

    // Step 1: RESET state for new repo
    this._readOnly = false;
    this._readOnlyReason = undefined;
    this.initialized = false;

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

    // Step 2 & 3: FETCH and DETECT state
    const state = await this.detectState();
    console.log('GitService: Initial state:', JSON.stringify(state, null, 2));

    // Step 4: CHECK PERMISSION before creating anything
    // Only check if remote exists but no remote vibechannel branch
    // (meaning we'd need to create it, which requires write access)
    if (state.hasRemoteOrigin && !state.hasRemoteBranch) {
      console.log('GitService: Checking write access before creating branch...');
      const accessResult = await this.checkWriteAccess();

      if (!accessResult.canWrite) {
        console.log('GitService: No write access, entering read-only mode');

        // Clean up orphaned local state if it exists (from previous buggy version)
        if (state.hasLocalBranch || state.hasWorktree) {
          console.log('GitService: Found orphaned local state, cleaning up...');
          await this.cleanupOrphanedState(state);
        }

        this.setReadOnly(accessResult.reason || 'no-permission');
        return {
          success: false,
          readOnly: true,
          reason: 'no-permission',
          hasRemoteBranch: false,
          worktreePath: undefined
        };
      }
    }

    // Step 5: RESOLVE local branch (only if we have permission or remote branch exists)
    await this.resolveLocalBranch(state);

    // Step 6: RESOLVE worktree (and populate if new)
    await this.resolveWorktree(state);

    // Step 7: SYNC with remote (pull if remote exists)
    if (state.hasRemoteBranch) {
      console.log('GitService: Pulling latest from remote...');
      await this.pull();
    }

    // Step 8: PUSH to remote (if we created new content and remote exists)
    if (state.hasRemoteOrigin && !state.hasRemoteBranch) {
      console.log('GitService: Pushing new branch to remote...');
      const pushResult = await this.push();
      if (pushResult.success) {
        console.log('GitService: Successfully pushed to remote');
      } else if (pushResult.noPermission) {
        // Shouldn't happen since we checked, but handle gracefully
        console.warn('GitService: Push failed due to permission (unexpected)');
        this.setReadOnly('no-permission');
      } else if (!pushResult.noRemote) {
        console.warn('GitService: Failed to push to remote:', pushResult.error);
      }
    }

    this.initialized = true;
    console.log('GitService: Initialization complete!');
    console.log('GitService: Worktree at:', worktreePath);

    return {
      success: true,
      readOnly: this._readOnly,
      hasRemoteBranch: state.hasRemoteBranch,
      worktreePath
    };
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

    // Create .assets folder for pasted images
    const assetsDir = path.join(worktreePath, ASSETS_DIR);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, '.gitkeep'), '');
    fs.writeFileSync(
      path.join(worktreePath, 'README.md'),
      '# VibeChannel Data\n\nThis branch contains VibeChannel conversation data.\n'
    );
    fs.writeFileSync(path.join(worktreePath, 'schema.md'), this.getSchemaTemplate());
    fs.writeFileSync(path.join(worktreePath, 'agent.md'), this.getAgentTemplate());

    await execAsync('git add -A', { cwd: worktreePath });
    await execAsync('git commit --no-verify -m "Add initial VibeChannel structure"', { cwd: worktreePath });
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

    // Prune stale worktree references (e.g., if repo was moved to a new path)
    await execAsync('git worktree prune', { cwd: repoPath }).catch(() => {});

    // Check if branch is checked out at a different path (e.g., repo was moved but old worktree dir still exists)
    await this.removeStaleWorktreeForBranch(branchName, worktreePath);

    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    await execAsync(`git worktree add "${worktreePath}" ${branchName}`, { cwd: repoPath });
  }

  /**
   * Clean up orphaned local state (branch and worktree) that was created by
   * a previous buggy version before permission was checked.
   *
   * This is called when:
   * - Remote origin exists
   * - No remote vibechannel branch
   * - User has no write access
   * - But local branch/worktree exists (orphaned state)
   */
  private async cleanupOrphanedState(state: InitState): Promise<void> {
    if (!this.config) return;

    console.log('GitService: Cleaning up orphaned local state...');

    // Step 1: Remove worktree first (must be done before deleting branch)
    if (state.hasWorktree) {
      console.log('GitService: Removing orphaned worktree...');
      try {
        await execAsync(
          `git worktree remove "${this.config.worktreePath}" --force`,
          { cwd: this.config.repoPath }
        );
        console.log('GitService: Removed orphaned worktree via git');
      } catch {
        // Git remove failed - manually clean up
        console.log('GitService: Git worktree remove failed, cleaning up manually...');
        if (fs.existsSync(this.config.worktreePath)) {
          fs.rmSync(this.config.worktreePath, { recursive: true, force: true });
        }
        await execAsync('git worktree prune', { cwd: this.config.repoPath }).catch(() => {});
      }
    }

    // Step 2: Delete local branch
    if (state.hasLocalBranch) {
      console.log('GitService: Removing orphaned local branch...');
      try {
        await execAsync(
          `git branch -D ${this.config.branchName}`,
          { cwd: this.config.repoPath }
        );
        console.log('GitService: Removed orphaned local branch');
      } catch (error) {
        console.warn('GitService: Failed to remove orphaned branch:', error);
      }
    }

    console.log('GitService: Orphaned state cleanup complete');
  }

  /**
   * If the branch is checked out in a worktree at a different path than expected,
   * remove that stale worktree (handles case where repo was moved but old worktree dir still exists).
   */
  private async removeStaleWorktreeForBranch(branchName: string, expectedPath: string): Promise<void> {
    if (!this.config) return;

    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });

      // Parse porcelain output to find worktree for our branch
      const worktrees = output.split('\n\n').filter(Boolean);
      for (const entry of worktrees) {
        const lines = entry.split('\n');
        const worktreeLine = lines.find(l => l.startsWith('worktree '));
        const branchLine = lines.find(l => l.startsWith('branch '));

        if (!worktreeLine || !branchLine) continue;

        const worktreePath = worktreeLine.replace('worktree ', '');
        const branch = branchLine.replace('branch refs/heads/', '');

        // Found our branch at a different path
        if (branch === branchName && worktreePath !== expectedPath) {
          console.log(`GitService: Branch '${branchName}' is checked out at stale path: ${worktreePath}`);
          console.log(`GitService: Expected path: ${expectedPath}`);

          // Try to remove via git first
          try {
            await execAsync(`git worktree remove "${worktreePath}" --force`, {
              cwd: this.config.repoPath,
            });
            console.log('GitService: Removed stale worktree via git');
          } catch {
            // Git remove failed (corrupted state) - manually clean up
            console.log('GitService: Git remove failed, cleaning up manually...');
            if (fs.existsSync(worktreePath)) {
              fs.rmSync(worktreePath, { recursive: true, force: true });
            }
            await execAsync('git worktree prune', { cwd: this.config.repoPath }).catch(() => {});
            console.log('GitService: Manual cleanup complete');
          }
          break;
        }
      }
    } catch (error) {
      console.warn('GitService: Failed to check for stale worktrees:', error);
    }
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

  /**
   * Ensure the .assets directory exists for storing pasted images
   */
  ensureAssetsDir(): string | undefined {
    if (!this.config?.worktreePath) return undefined;

    const assetsDir = path.join(this.config.worktreePath, ASSETS_DIR);
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    return assetsDir;
  }

  /**
   * Save a file to the .assets directory
   * @param data Base64-encoded file data (without data URI prefix)
   * @param extension File extension (e.g., 'png', 'jpg', 'pdf', 'zip')
   * @returns The relative path to the saved file (e.g., '.assets/20250115T103045-a3f8c2.png')
   */
  saveAsset(data: string, extension: string): string | undefined {
    const assetsDir = this.ensureAssetsDir();
    if (!assetsDir) return undefined;

    // Generate filename: {timestamp}-{randomId}.{ext}
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '')
      .replace('T', 'T');

    const randomId = Array.from({ length: 6 }, () =>
      '0123456789abcdef'[Math.floor(Math.random() * 16)]
    ).join('');

    const filename = `${timestamp}-${randomId}.${extension}`;
    const filepath = path.join(assetsDir, filename);

    // Decode base64 and write to file
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filepath, buffer);

    // Return path relative to worktree root
    return `${ASSETS_DIR}/${filename}`;
  }

  getAssetsPath(): string | undefined {
    if (!this.config?.worktreePath) return undefined;
    return path.join(this.config.worktreePath, ASSETS_DIR);
  }

  async commitChanges(message: string): Promise<boolean> {
    if (!this.config?.worktreePath) return false;

    try {
      await execAsync('git add -A', { cwd: this.config.worktreePath });
      await execAsync(`git commit --no-verify -m "${message}"`, { cwd: this.config.worktreePath });
      return true;
    } catch (error) {
      console.log('GitService: Commit result:', error);
      return false;
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

  /**
   * Get repository owner and name from the git remote URL
   * Returns null if no GitHub remote is configured
   */
  async getRepoInfo(): Promise<{ owner: string; repo: string } | null> {
    if (!this.config?.worktreePath) return null;

    try {
      const remoteUrl = execSync('git remote get-url origin', {
        cwd: this.config.worktreePath,
        encoding: 'utf-8',
      }).trim();

      // Parse GitHub URL formats:
      // https://github.com/owner/repo.git
      // git@github.com:owner/repo.git
      // https://github.com/owner/repo
      const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }

      return null;
    } catch {
      return null;
    }
  }

  async push(): Promise<PushResult> {
    if (!this.config?.worktreePath) {
      return { success: false, noRemote: true };
    }

    // Don't attempt push if already known to be read-only
    if (this._readOnly) {
      return { success: false, noRemote: false, noPermission: true, error: 'Read-only mode' };
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
      const errorStr = String(error);
      console.error('GitService: Push failed:', error);

      // Detect permission errors (403, "Permission denied", etc.)
      const isPermissionError =
        errorStr.includes('403') ||
        errorStr.includes('Permission') ||
        errorStr.includes('permission') ||
        errorStr.includes('denied') ||
        errorStr.includes('not allowed');

      if (isPermissionError) {
        this.setReadOnly('no-permission');
        return { success: false, noRemote: false, noPermission: true, error: errorStr };
      }

      return { success: false, noRemote: false, error: errorStr };
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
      await execAsync('git commit --no-verify -m "Resolve conflicts (auto)"', {
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
    this._readOnly = false;
    this._readOnlyReason = undefined;
  }
}
