// =============================================================================
// Supabase Database Types for VibeChannel
// Generated from database schema - update when schema changes
// =============================================================================

export interface Database {
  public: {
    Tables: {
      repos: {
        Row: {
          id: string;
          github_installation_id: number;
          github_repo_id: number;
          owner: string;
          name: string;
          full_name: string;
          default_branch: string;
          vibechannel_branch: string;
          vibechannel_initialized: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['repos']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['repos']['Insert']>;
      };
      users: {
        Row: {
          id: string;
          github_id: number;
          github_login: string;
          github_name: string | null;
          avatar_url: string | null;
          email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      user_repos: {
        Row: {
          user_id: string;
          repo_id: string;
          role: 'admin' | 'member' | 'viewer';
          joined_at: string;
        };
        Insert: Omit<Database['public']['Tables']['user_repos']['Row'], 'joined_at'>;
        Update: Partial<Database['public']['Tables']['user_repos']['Insert']>;
      };
      channels: {
        Row: {
          id: string;
          repo_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          repo_id: string;
          name: string;
          description?: string | null;
        };
        Update: Partial<Database['public']['Tables']['channels']['Insert']>;
      };
      messages: {
        Row: {
          id: string;
          channel_id: string;
          sender: string;
          sender_user_id: string | null;
          content: string;
          reply_to_id: string | null;
          reply_to_path: string | null;
          tags: string[] | null;
          github_path: string;
          github_sha: string | null;
          github_synced: boolean;
          synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          sender: string;
          content: string;
          created_at: string;
          github_path: string;
          github_synced?: boolean;
          sender_user_id?: string | null;
          reply_to_id?: string | null;
          reply_to_path?: string | null;
          tags?: string[] | null;
          github_sha?: string | null;
          synced_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
      };
      presence: {
        Row: {
          user_id: string;
          repo_id: string | null;
          channel_id: string | null;
          status: 'online' | 'away' | 'typing' | 'offline';
          last_seen: string;
        };
        Insert: Database['public']['Tables']['presence']['Row'];
        Update: Partial<Database['public']['Tables']['presence']['Insert']>;
      };
      unread_counts: {
        Row: {
          user_id: string;
          channel_id: string;
          last_read_message_id: string | null;
          last_read_at: string | null;
          unread_count: number;
        };
        Insert: Omit<Database['public']['Tables']['unread_counts']['Row'], 'unread_count'>;
        Update: Partial<Database['public']['Tables']['unread_counts']['Insert']>;
      };
    };
    Functions: {
      mark_channel_read: {
        Args: { p_channel_id: string };
        Returns: void;
      };
      update_presence: {
        Args: {
          p_repo_id?: string;
          p_channel_id?: string;
          p_status?: string;
        };
        Returns: void;
      };
      cleanup_stale_presence: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
  };
}

// Convenience type aliases
export type Repo = Database['public']['Tables']['repos']['Row'];
export type User = Database['public']['Tables']['users']['Row'];
export type UserRepo = Database['public']['Tables']['user_repos']['Row'];
export type Channel = Database['public']['Tables']['channels']['Row'];
export type Message = Database['public']['Tables']['messages']['Row'];
export type MessageInsert = Database['public']['Tables']['messages']['Insert'];
export type Presence = Database['public']['Tables']['presence']['Row'];
export type UnreadCount = Database['public']['Tables']['unread_counts']['Row'];
