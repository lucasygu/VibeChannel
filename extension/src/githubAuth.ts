import * as vscode from 'vscode';

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  accessToken: string;
}

export type AuthStateChangeCallback = (user: GitHubUser | null) => void;

/**
 * Manages GitHub authentication using VSCode's built-in auth provider
 */
export class GitHubAuthService implements vscode.Disposable {
  private static instance: GitHubAuthService | undefined;
  private currentUser: GitHubUser | null = null;
  private listeners: Set<AuthStateChangeCallback> = new Set();
  private disposables: vscode.Disposable[] = [];

  // Scopes we need - 'read:user' for profile info
  // Add 'repo' if you need repository access later
  private readonly scopes = ['read:user'];

  private constructor() {
    // Listen for auth session changes
    this.disposables.push(
      vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === 'github') {
          this.checkAuthStatus();
        }
      })
    );

    // Check initial auth status
    this.checkAuthStatus();
  }

  public static getInstance(): GitHubAuthService {
    if (!GitHubAuthService.instance) {
      GitHubAuthService.instance = new GitHubAuthService();
    }
    return GitHubAuthService.instance;
  }

  /**
   * Sign in with GitHub
   * @returns The authenticated user, or null if cancelled
   */
  public async signIn(): Promise<GitHubUser | null> {
    try {
      const session = await vscode.authentication.getSession(
        'github',
        this.scopes,
        { createIfNone: true }
      );

      if (session) {
        const user = await this.fetchUserInfo(session);
        this.setCurrentUser(user);
        return user;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('cancelled')) {
        // User cancelled - not an error
        return null;
      }
      vscode.window.showErrorMessage(`GitHub sign in failed: ${error}`);
    }

    return null;
  }

  /**
   * Sign out from GitHub
   */
  public async signOut(): Promise<void> {
    // VSCode doesn't have a direct "sign out" API for auth providers
    // The user needs to sign out via the Accounts menu
    // We can clear our local state though

    const action = await vscode.window.showInformationMessage(
      'To sign out of GitHub, use the Accounts menu in the bottom-left corner of VSCode.',
      'OK'
    );

    // Clear local state anyway
    this.setCurrentUser(null);
  }

  /**
   * Get the current authenticated user
   */
  public getUser(): GitHubUser | null {
    return this.currentUser;
  }

  /**
   * Check if user is signed in
   */
  public isSignedIn(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Subscribe to auth state changes
   */
  public onAuthStateChange(callback: AuthStateChangeCallback): vscode.Disposable {
    this.listeners.add(callback);

    // Immediately call with current state
    callback(this.currentUser);

    return {
      dispose: () => {
        this.listeners.delete(callback);
      }
    };
  }

  /**
   * Check current auth status silently (without prompting)
   */
  public async checkAuthStatus(): Promise<GitHubUser | null> {
    try {
      const session = await vscode.authentication.getSession(
        'github',
        this.scopes,
        { createIfNone: false } // Don't prompt
      );

      if (session) {
        const user = await this.fetchUserInfo(session);
        this.setCurrentUser(user);
        return user;
      } else {
        this.setCurrentUser(null);
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      this.setCurrentUser(null);
    }

    return null;
  }

  /**
   * Fetch user info from GitHub API
   */
  private async fetchUserInfo(session: vscode.AuthenticationSession): Promise<GitHubUser> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'User-Agent': 'VibeChannel-VSCode-Extension',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json() as {
      login: string;
      name: string | null;
      avatar_url: string;
    };

    return {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      accessToken: session.accessToken,
    };
  }

  private setCurrentUser(user: GitHubUser | null): void {
    this.currentUser = user;

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(user);
      } catch (error) {
        console.error('Error in auth state listener:', error);
      }
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.listeners.clear();
    GitHubAuthService.instance = undefined;
  }
}
