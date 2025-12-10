// =============================================================================
// Supabase Authentication Service for VibeChannel VS Code Extension
// =============================================================================

import * as vscode from 'vscode';
import { getSupabaseClient, isSupabaseConfigured } from './client';
import { User, Session } from '@supabase/supabase-js';

/**
 * Authentication service using Supabase Auth with GitHub OAuth
 */
export class SupabaseAuthService implements vscode.Disposable {
  private static instance: SupabaseAuthService | undefined;
  private readonly _onAuthStateChange = new vscode.EventEmitter<User | null>();
  readonly onAuthStateChange = this._onAuthStateChange.event;

  private currentUser: User | null = null;
  private currentSession: Session | null = null;
  private disposables: vscode.Disposable[] = [];
  private initialized = false;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): SupabaseAuthService {
    if (!SupabaseAuthService.instance) {
      SupabaseAuthService.instance = new SupabaseAuthService();
    }
    return SupabaseAuthService.instance;
  }

  /**
   * Initialize the auth service
   * Should be called during extension activation
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!isSupabaseConfigured()) {
      console.log('SupabaseAuthService: Supabase not configured, skipping initialization');
      return;
    }

    try {
      const supabase = getSupabaseClient();

      // Check for existing session
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error('SupabaseAuthService: Error getting session:', error);
      } else if (session?.user) {
        this.currentSession = session;
        this.currentUser = session.user;
        this._onAuthStateChange.fire(session.user);
        console.log('SupabaseAuthService: Restored session for', session.user.email);
      }

      // Listen for auth changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          console.log('SupabaseAuthService: Auth state change:', event);
          this.currentSession = session;
          this.currentUser = session?.user || null;
          this._onAuthStateChange.fire(this.currentUser);
        }
      );

      // Store subscription for cleanup
      this.disposables.push({
        dispose: () => subscription.unsubscribe(),
      });

      this.initialized = true;
    } catch (error) {
      console.error('SupabaseAuthService: Initialization error:', error);
    }
  }

  /**
   * Sign in with GitHub OAuth
   * Opens browser for OAuth flow
   */
  async signIn(): Promise<User | null> {
    if (!isSupabaseConfigured()) {
      vscode.window.showErrorMessage(
        'Supabase is not configured. Please set supabaseUrl and supabaseAnonKey in VibeChannel settings.'
      );
      return null;
    }

    try {
      const supabase = getSupabaseClient();

      // Start OAuth flow
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: 'vscode://lucasygu.vibechannel/auth/callback',
          scopes: 'read:user user:email',
        },
      });

      if (error) {
        vscode.window.showErrorMessage(`Sign in failed: ${error.message}`);
        return null;
      }

      // Open browser for OAuth
      if (data.url) {
        await vscode.env.openExternal(vscode.Uri.parse(data.url));
        vscode.window.showInformationMessage(
          'Please complete the sign-in process in your browser.'
        );
      }

      // Note: The actual session will be established via the callback URI handler
      return this.currentUser;

    } catch (error) {
      console.error('SupabaseAuthService: Sign in error:', error);
      vscode.window.showErrorMessage(
        `Sign in failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }

  /**
   * Handle OAuth callback URI
   * Called when VS Code receives the callback from OAuth flow
   */
  async handleAuthCallback(uri: vscode.Uri): Promise<boolean> {
    try {
      // Parse the callback URL for tokens
      const fragment = uri.fragment;
      const params = new URLSearchParams(fragment);

      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (!accessToken) {
        console.error('SupabaseAuthService: No access token in callback');
        return false;
      }

      const supabase = getSupabaseClient();

      // Set the session
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
      });

      if (error) {
        console.error('SupabaseAuthService: Error setting session:', error);
        return false;
      }

      if (data.session) {
        this.currentSession = data.session;
        this.currentUser = data.session.user;
        this._onAuthStateChange.fire(this.currentUser);
        vscode.window.showInformationMessage(
          `Signed in as ${this.currentUser.email || this.currentUser.user_metadata?.user_name || 'user'}`
        );
        return true;
      }

      return false;

    } catch (error) {
      console.error('SupabaseAuthService: Callback handling error:', error);
      return false;
    }
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      const supabase = getSupabaseClient();
      await supabase.auth.signOut();
      this.currentUser = null;
      this.currentSession = null;
      this._onAuthStateChange.fire(null);
      vscode.window.showInformationMessage('Signed out from VibeChannel');
    } catch (error) {
      console.error('SupabaseAuthService: Sign out error:', error);
    }
  }

  /**
   * Get the current user
   */
  getUser(): User | null {
    return this.currentUser;
  }

  /**
   * Get the current session
   */
  getSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.currentUser !== null && this.currentSession !== null;
  }

  /**
   * Get user's GitHub username from metadata
   */
  getGitHubUsername(): string | null {
    return this.currentUser?.user_metadata?.user_name || null;
  }

  /**
   * Get user's avatar URL from metadata
   */
  getAvatarUrl(): string | null {
    return this.currentUser?.user_metadata?.avatar_url || null;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this._onAuthStateChange.dispose();
    SupabaseAuthService.instance = undefined;
    this.initialized = false;
  }
}
