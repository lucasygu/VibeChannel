// =============================================================================
// Supabase Client for VibeChannel VS Code Extension
// =============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as vscode from 'vscode';
import { Database } from './types';

// These will be configured via extension settings or environment
// TODO: Move to proper configuration
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

let supabaseClient: SupabaseClient<Database> | null = null;
let extensionContext: vscode.ExtensionContext | null = null;

/**
 * Initialize the Supabase client with extension context
 * Must be called during extension activation
 */
export function initializeSupabaseClient(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

/**
 * Get configuration values for Supabase
 */
function getSupabaseConfig(): { url: string; anonKey: string } {
  const config = vscode.workspace.getConfiguration('vibechannel');
  return {
    url: config.get<string>('supabaseUrl') || SUPABASE_URL,
    anonKey: config.get<string>('supabaseAnonKey') || SUPABASE_ANON_KEY,
  };
}

/**
 * Custom storage adapter for Supabase auth that uses VS Code's secure storage
 */
class VSCodeStorageAdapter {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async getItem(key: string): Promise<string | null> {
    return this.context.globalState.get<string>(key) || null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.context.globalState.update(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await this.context.globalState.update(key, undefined);
  }
}

/**
 * Get the Supabase client singleton
 * Creates the client on first access
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseClient) {
    const config = getSupabaseConfig();

    if (!config.url || config.url === 'https://your-project.supabase.co') {
      throw new Error('Supabase URL not configured. Please set vibechannel.supabaseUrl in settings.');
    }

    if (!config.anonKey || config.anonKey === 'your-anon-key') {
      throw new Error('Supabase anon key not configured. Please set vibechannel.supabaseAnonKey in settings.');
    }

    const authOptions: {
      persistSession: boolean;
      autoRefreshToken: boolean;
      storage?: VSCodeStorageAdapter;
    } = {
      persistSession: true,
      autoRefreshToken: true,
    };

    // Use VS Code storage if context is available
    if (extensionContext) {
      authOptions.storage = new VSCodeStorageAdapter(extensionContext);
    }

    supabaseClient = createClient<Database>(config.url, config.anonKey, {
      auth: authOptions,
    });
  }

  return supabaseClient;
}

/**
 * Reset the Supabase client
 * Call this when configuration changes or user signs out
 */
export function resetSupabaseClient(): void {
  supabaseClient = null;
}

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
  const config = getSupabaseConfig();
  return (
    config.url !== 'https://your-project.supabase.co' &&
    config.anonKey !== 'your-anon-key' &&
    !!config.url &&
    !!config.anonKey
  );
}
