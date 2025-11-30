# Permission Check Refactor Implementation

**Date:** 2025-11-30
**Status:** Implemented
**Priority:** Critical

## Problem Summary

VibeChannel creates local git state (branch, worktree, content) **before** checking if the user has write access to the repository. This causes confusion when users open VibeChannel on public repos they don't own.

### Current Broken Flow

```
1. User opens VibeChannel on public repo (e.g., ggml-org/whisper.cpp)
2. GitService.initialize() runs:
   - Fetches from remote
   - Detects: no local branch, no remote 'vibechannel' branch
   - Creates NEW orphan branch locally
   - Creates worktree at .git/vibechannel-worktree/
   - Populates with general/, README.md, schema.md, agent.md
   - Commits locally
   - Tries to push → 403 PERMISSION DENIED
   - Sets _readOnly = true (too late!)
3. User sees "general" channel that can never sync
4. If user deletes branch/worktree, extension recreates it on next open
```

### Desired Behavior

**For repos WITH write access:** Current flow works fine.

**For repos WITHOUT write access:**
- Check permission BEFORE creating any local content
- If remote `vibechannel` branch exists → show read-only viewer
- If no remote branch → show message, suggest forking, don't create anything

---

## Issues to Fix

### Critical Issues

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| 1 | Permission check too late | `gitService.ts:118-164` | Local content created before push attempt reveals no permission |
| 2 | Singleton state not reset | `gitService.ts:118-132` | `_readOnly` flag persists when switching repos |
| 6 | Panel restoration re-inits | `chatPanel.ts:129-184` | Webview serializer re-triggers full initialization |
| 7 | No pre-check for write access | `gitService.ts:196-214` | `resolveLocalBranch()` creates orphan without checking permission |
| 10 | No persistent skip mechanism | Multiple | No way to remember "this repo has no permission" |

### Moderate Issues

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| 3 | SyncService singleton not reset | `syncService.ts` | `pendingPush` and polling persist across repo switches |
| 4 | Read-only mode after user action | `chatPanel.ts:464-547` | User can type/send before discovering no permission |
| 9 | No rollback on push failure | `chatPanel.ts:536-542` | Local commit exists even if push fails |

### Minor Issues

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| 5 | GitHub auth vs git config | `githubAuth.ts` | Message `from:` field may not match git commit author |
| 8 | Empty input in read-only | `chatPanel.ts:800-801` | Input area shows nothing instead of "read-only" message |

---

## Implementation Plan

### Phase 1: Add Permission Check (Critical)

#### 1.1 Add `checkWriteAccess()` method to GitService

**File:** `extension/src/gitService.ts`

```typescript
/**
 * Check if user has write access to the remote repository.
 * Uses a lightweight method: attempt to push an empty ref or use GitHub API.
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

  try {
    // Method 1: Try git push --dry-run (doesn't actually push)
    await execAsync(
      `git push --dry-run origin HEAD:refs/heads/__vibechannel_access_check__ 2>&1`,
      { cwd: this.config.repoPath }
    );
    return { canWrite: true };
  } catch (error) {
    const errorStr = String(error);

    if (errorStr.includes('403') ||
        errorStr.includes('Permission') ||
        errorStr.includes('denied')) {
      return { canWrite: false, reason: 'no-permission' };
    }

    // Other errors (network, etc.) - assume can write, will fail later
    return { canWrite: true };
  }
}
```

#### 1.2 Modify `initialize()` to check permission first

**File:** `extension/src/gitService.ts`

```typescript
async initialize(repoPath: string): Promise<InitResult> {
  console.log('GitService: Starting initialization...');

  // Reset state for new repo
  this._readOnly = false;
  this._readOnlyReason = undefined;

  if (!this.isGitRepo(repoPath)) {
    throw new Error('Not a Git repository');
  }

  // ... setup config ...

  // Step 1 & 2: FETCH and DETECT state
  const state = await this.detectState();

  // NEW Step 2.5: CHECK WRITE ACCESS before creating anything
  if (state.hasRemoteOrigin && !state.hasRemoteBranch) {
    // Remote exists but no vibechannel branch - need write access to create
    const accessResult = await this.checkWriteAccess();

    if (!accessResult.canWrite) {
      this.setReadOnly(accessResult.reason || 'no-permission');
      return {
        success: false,
        readOnly: true,
        reason: 'no-permission',
        hasRemoteBranch: false
      };
    }
  }

  // Step 3: RESOLVE local branch (only if we have permission or remote branch exists)
  await this.resolveLocalBranch(state);

  // ... rest of initialization ...
}
```

#### 1.3 Create `InitResult` interface

**File:** `extension/src/gitService.ts`

```typescript
export interface InitResult {
  success: boolean;
  readOnly: boolean;
  reason?: 'no-permission' | 'no-remote' | 'error';
  hasRemoteBranch: boolean;
  worktreePath?: string;
}
```

### Phase 2: Handle Init Result in ChatPanel

#### 2.1 Update `createOrShow()` to handle InitResult

**File:** `extension/src/chatPanel.ts`

```typescript
public static async createOrShow(repoPath: string): Promise<void> {
  // ... existing panel check ...

  const gitService = GitService.getInstance();
  const initResult = await gitService.initialize(repoPath);

  // Handle no-permission case BEFORE creating panel
  if (!initResult.success && initResult.reason === 'no-permission') {
    if (!initResult.hasRemoteBranch) {
      // No remote branch + no permission = show fork suggestion
      const action = await vscode.window.showInformationMessage(
        'This repository doesn\'t have a VibeChannel yet, and you don\'t have write access to create one.',
        'Fork Repository',
        'Cancel'
      );

      if (action === 'Fork Repository') {
        // Open GitHub fork page
        const remoteUrl = await gitService.getRemoteUrl();
        if (remoteUrl) {
          const forkUrl = convertToForkUrl(remoteUrl);
          vscode.env.openExternal(vscode.Uri.parse(forkUrl));
        }
      }
      return; // Don't create panel
    }
    // Has remote branch but no permission = proceed with read-only view
  }

  // ... rest of panel creation ...
}
```

#### 2.2 Add helper to convert repo URL to fork URL

**File:** `extension/src/gitService.ts`

```typescript
async getRemoteUrl(): Promise<string | undefined> {
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

// In chatPanel.ts or utils
function convertToForkUrl(repoUrl: string): string {
  // Convert git@github.com:owner/repo.git or https://github.com/owner/repo.git
  // to https://github.com/owner/repo/fork
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (match) {
    return `https://github.com/${match[1]}/${match[2]}/fork`;
  }
  return repoUrl;
}
```

### Phase 3: Fix Singleton State Issues

#### 3.1 Reset state in `initialize()`

**File:** `extension/src/gitService.ts`

Add at the beginning of `initialize()`:

```typescript
async initialize(repoPath: string): Promise<InitResult> {
  // Reset ALL state for new repo
  this._readOnly = false;
  this._readOnlyReason = undefined;
  this.initialized = false;

  // ... rest of method
}
```

#### 3.2 Reset SyncService state

**File:** `extension/src/syncService.ts`

Add reset method and call it when switching repos:

```typescript
reset(): void {
  this.stop();
  this.pendingPush = false;
}
```

**File:** `extension/src/chatPanel.ts`

```typescript
// In createOrShow(), before initializing GitService:
if (ChatPanel.currentPanel) {
  ChatPanel.currentPanel.dispose();
}

// Reset services for new repo
SyncService.getInstance().reset();
```

### Phase 4: Fix Panel Restoration

#### 4.1 Add permission check to `revive()`

**File:** `extension/src/chatPanel.ts`

```typescript
public static async revive(
  panel: vscode.WebviewPanel,
  repoPath: string,
  savedChannel?: string
): Promise<void> {
  // ... existing disposal code ...

  const gitService = GitService.getInstance();
  const initResult = await gitService.initialize(repoPath);

  // If no permission and no remote branch, dispose panel
  if (!initResult.success && !initResult.hasRemoteBranch) {
    panel.dispose();
    vscode.window.showWarningMessage(
      'VibeChannel cannot be restored for this repository (no write access).'
    );
    return;
  }

  // ... rest of revival code ...
}
```

### Phase 5: UI Improvements

#### 5.1 Show proper message in read-only mode input area

**File:** `extension/src/chatPanel.ts`

Update line ~801:

```typescript
<div class="input-area${this.isReadOnly ? ' input-disabled' : ''}">
  ${this.isReadOnly
    ? this.renderReadOnlyInput()
    : (user ? this.renderInputField(user) : this.renderInputDisabled())}
</div>
```

Add new method:

```typescript
private renderReadOnlyInput(): string {
  return `<div class="input-readonly">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
    </svg>
    <span>Read-only mode - you don't have write access to this repository</span>
  </div>`;
}
```

---

## Testing Checklist

### Scenario 1: Own Repo (Has Write Access)
- [ ] Opens VibeChannel on own repo
- [ ] Creates branch/worktree if not exists
- [ ] Push succeeds
- [ ] Can send messages

### Scenario 2: Public Repo, No Remote Branch (No Access)
- [ ] Opens VibeChannel on public repo without vibechannel branch
- [ ] Permission check runs BEFORE creating any local content
- [ ] Shows "Fork Repository" suggestion
- [ ] NO local branch created
- [ ] NO local worktree created

### Scenario 3: Public Repo, Has Remote Branch (No Access)
- [ ] Opens VibeChannel on public repo with existing vibechannel branch
- [ ] Creates local branch from remote
- [ ] Shows read-only view of messages
- [ ] Input area shows "Read-only mode" message
- [ ] Cannot send messages

### Scenario 4: Switch Between Repos
- [ ] Open repo A (no permission) → read-only
- [ ] Open repo B (own repo) → full access (NOT stuck in read-only)
- [ ] `_readOnly` flag properly reset

### Scenario 5: Panel Restoration
- [ ] Have VibeChannel open on public repo
- [ ] Restart VS Code/Cursor
- [ ] Panel does NOT recreate local branch/worktree
- [ ] Shows appropriate message

### Scenario 6: Manual Cleanup Persists
- [ ] User manually deletes vibechannel branch
- [ ] Opening VibeChannel does NOT recreate it (for no-permission repos)

---

## Files to Modify

1. `extension/src/gitService.ts`
   - Add `checkWriteAccess()` method
   - Add `getRemoteUrl()` method
   - Modify `initialize()` to check permission first
   - Reset state at start of `initialize()`
   - Add `InitResult` interface

2. `extension/src/chatPanel.ts`
   - Update `createOrShow()` to handle InitResult
   - Update `revive()` to handle InitResult
   - Add `renderReadOnlyInput()` method
   - Add `convertToForkUrl()` helper
   - Reset SyncService when switching repos

3. `extension/src/syncService.ts`
   - Add `reset()` method

---

## Rollback Plan

If issues arise:
1. Revert to previous behavior by removing the permission check
2. The existing `_readOnly` mode still works as fallback (just triggers later)

---

## Future Considerations

- **Local-only mode:** Could add explicit opt-in for local-only chat (commented in current code)
- **GitHub API check:** Could use GitHub API instead of dry-run push for more reliable check
- **Caching:** Could cache permission results to avoid repeated checks
