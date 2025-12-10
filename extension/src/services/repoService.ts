// =============================================================================
// Repo Service for VibeChannel VS Code Extension
// Manages repository registration and lookup via Supabase
// =============================================================================

import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client';
import { SupabaseAuthService } from '../supabase/auth';
import { Repo, Channel } from '../supabase/types';

/**
 * Service for repository operations via Supabase
 */
export class RepoService {
  private static instance: RepoService | undefined;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): RepoService {
    if (!RepoService.instance) {
      RepoService.instance = new RepoService();
    }
    return RepoService.instance;
  }

  /**
   * Get all repos the current user has access to
   */
  async getUserRepos(): Promise<Repo[]> {
    if (!isSupabaseConfigured()) {
      return [];
    }

    const supabase = getSupabaseClient();
    const auth = SupabaseAuthService.getInstance();

    if (!auth.isAuthenticated()) {
      return [];
    }

    const { data, error } = await supabase
      .from('repos')
      .select('*')
      .order('full_name');

    if (error) {
      console.error('Failed to get user repos:', error);
      return [];
    }

    return (data as Repo[]) || [];
  }

  /**
   * Find a repo by its GitHub full name (owner/name)
   */
  async getRepoByFullName(fullName: string): Promise<Repo | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('repos')
      .select('*')
      .eq('full_name', fullName)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') { // Not found is ok
        console.error('Failed to get repo:', error);
      }
      return null;
    }

    return data as Repo | null;
  }

  /**
   * Get a repo by its Supabase ID
   */
  async getRepoById(repoId: string): Promise<Repo | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('repos')
      .select('*')
      .eq('id', repoId)
      .single();

    if (error) {
      console.error('Failed to get repo by ID:', error);
      return null;
    }

    return data as Repo | null;
  }

  /**
   * Get channels for a repo
   */
  async getRepoChannels(repoId: string): Promise<Channel[]> {
    if (!isSupabaseConfigured()) {
      return [];
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .eq('repo_id', repoId)
      .order('name');

    if (error) {
      console.error('Failed to get channels:', error);
      return [];
    }

    return (data as Channel[]) || [];
  }

  /**
   * Get or create a channel in a repo
   */
  async getOrCreateChannel(repoId: string, channelName: string): Promise<Channel | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = getSupabaseClient();

    // Try to get existing channel
    const { data: existing } = await supabase
      .from('channels')
      .select('*')
      .eq('repo_id', repoId)
      .eq('name', channelName)
      .single();

    if (existing) {
      return existing as Channel;
    }

    // Create new channel
    const { data: created, error } = await supabase
      .from('channels')
      .insert({ repo_id: repoId, name: channelName } as never)
      .select()
      .single();

    if (error) {
      console.error('Failed to create channel:', error);
      return null;
    }

    return created as Channel | null;
  }

  /**
   * Check if the current user has access to a repo
   */
  async hasRepoAccess(repoFullName: string): Promise<boolean> {
    const repo = await this.getRepoByFullName(repoFullName);
    return repo !== null;
  }

  /**
   * Get the GitHub App installation URL for connecting repos
   */
  getInstallationUrl(): string {
    // TODO: Replace with actual GitHub App name
    return 'https://github.com/apps/vibechannel/installations/new';
  }
}
