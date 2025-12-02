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
        try {
          const user = await this.fetchUserInfo(session);
          this.setCurrentUser(user);
          return user;
        } catch (fetchError) {
          // If token is invalid (401), force a new session
          if (fetchError instanceof Error && fetchError.message.includes('401')) {
            console.log('GitHub token invalid, forcing new session...');
            return await this.forceNewSession();
          }
          throw fetchError;
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        // User cancelled - not an error
        if (error.message.includes('cancelled') || error.message.includes('User did not consent')) {
          return null;
        }
        // GitHub provider not available
        if (error.message.includes('No authentication provider')) {
          vscode.window.showErrorMessage(
            'GitHub authentication is not available. Please ensure you have signed into GitHub in VS Code (View → Command Palette → "GitHub: Sign In").'
          );
          return null;
        }
      }
      vscode.window.showErrorMessage(`GitHub sign in failed: ${error instanceof Error ? error.message : error}`);
    }

    return null;
  }

  /**
   * Force a new GitHub session (used when existing token is invalid)
   */
  private async forceNewSession(): Promise<GitHubUser | null> {
    try {
      const session = await vscode.authentication.getSession(
        'github',
        this.scopes,
        { forceNewSession: true }
      );

      if (session) {
        const user = await this.fetchUserInfo(session);
        this.setCurrentUser(user);
        return user;
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('cancelled') || error.message.includes('User did not consent')) {
          return null;
        }
      }
      vscode.window.showErrorMessage(
        'GitHub re-authentication failed. Please try signing out and back in via VS Code\'s Accounts menu.'
      );
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
      // Provide specific error messages for common status codes
      switch (response.status) {
        case 401:
          throw new Error('GitHub API error: 401 - Token is invalid or expired');
        case 403:
          throw new Error('GitHub API error: 403 - Access forbidden (rate limit or permissions)');
        case 404:
          throw new Error('GitHub API error: 404 - User not found');
        default:
          throw new Error(`GitHub API error: ${response.status}`);
      }
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
