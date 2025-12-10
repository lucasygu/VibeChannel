// =============================================================================
// rebuild-cache Edge Function
// Rebuilds the Supabase message cache from GitHub (source of truth)
// =============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient, handleCors, jsonResponse, errorResponse } from '../_shared/supabase.ts';
import { getInstallationOctokit } from '../_shared/github.ts';
import { parseMessageFile, isMessageFile } from '../_shared/markdown.ts';

interface RebuildResults {
  channels_created: number;
  messages_synced: number;
  messages_deleted: number;
  errors: string[];
}

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { repo_id } = await req.json();

    if (!repo_id) {
      return errorResponse('repo_id required', 400);
    }

    const supabase = getServiceClient();

    // Get repo info
    const { data: repo, error: repoError } = await supabase
      .from('repos')
      .select('*')
      .eq('id', repo_id)
      .single();

    if (repoError || !repo) {
      return errorResponse('Repo not found', 404);
    }

    console.log(`Rebuilding cache for ${repo.full_name}`);

    const octokit = await getInstallationOctokit(repo.github_installation_id);

    // List all files in vibechannel branch
    let tree: Array<{ type?: string; path?: string; sha?: string }>;
    try {
      const { data: treeData } = await octokit.git.getTree({
        owner: repo.owner,
        repo: repo.name,
        tree_sha: repo.vibechannel_branch,
        recursive: 'true',
      });
      tree = treeData.tree;
    } catch (error) {
      // Branch doesn't exist yet
      console.log(`Branch ${repo.vibechannel_branch} not found for ${repo.full_name}`);
      return jsonResponse({
        success: true,
        message: 'Branch not initialized',
        results: {
          channels_created: 0,
          messages_synced: 0,
          messages_deleted: 0,
          errors: [],
        },
      });
    }

    const results: RebuildResults = {
      channels_created: 0,
      messages_synced: 0,
      messages_deleted: 0,
      errors: [],
    };

    // Track which github_paths we see
    const seenPaths = new Set<string>();

    // Process each file
    for (const item of tree) {
      if (item.type !== 'blob') continue;
      if (!item.path) continue;
      if (!isMessageFile(item.path)) continue;

      const parts = item.path.split('/');
      if (parts.length !== 2) continue;

      const [channelName, _filename] = parts;
      seenPaths.add(item.path);

      try {
        // Get or create channel
        let { data: channel } = await supabase
          .from('channels')
          .select('id')
          .eq('repo_id', repo.id)
          .eq('name', channelName)
          .single();

        if (!channel) {
          const { data: newChannel, error: channelError } = await supabase
            .from('channels')
            .insert({ repo_id: repo.id, name: channelName })
            .select('id')
            .single();

          if (channelError) {
            results.errors.push(`Failed to create channel ${channelName}: ${channelError.message}`);
            continue;
          }
          channel = newChannel;
          results.channels_created++;
        }

        // Fetch file content
        const { data: fileData } = await octokit.repos.getContent({
          owner: repo.owner,
          repo: repo.name,
          path: item.path,
          ref: repo.vibechannel_branch,
        });

        if (!('content' in fileData)) {
          results.errors.push(`No content for ${item.path}`);
          continue;
        }

        const content = atob(fileData.content);
        const parsed = parseMessageFile(content);

        if (!parsed) {
          results.errors.push(`Could not parse: ${item.path}`);
          continue;
        }

        // Upsert message
        const { error: upsertError } = await supabase.from('messages').upsert({
          channel_id: channel.id,
          sender: parsed.frontmatter.from,
          content: parsed.content,
          created_at: parsed.frontmatter.date,
          reply_to_path: parsed.frontmatter.reply_to,
          tags: parsed.frontmatter.tags,
          github_path: item.path,
          github_sha: item.sha,
          github_synced: true,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: 'channel_id,github_path',
        });

        if (upsertError) {
          results.errors.push(`Failed to upsert ${item.path}: ${upsertError.message}`);
        } else {
          results.messages_synced++;
        }

      } catch (error) {
        results.errors.push(`Error processing ${item.path}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Delete messages that no longer exist in GitHub
    const { data: allMessages } = await supabase
      .from('messages')
      .select('id, github_path, channel:channels!inner(repo_id)')
      .eq('channel.repo_id', repo.id);

    for (const msg of allMessages || []) {
      if (!seenPaths.has(msg.github_path)) {
        const { error: deleteError } = await supabase.from('messages').delete().eq('id', msg.id);
        if (deleteError) {
          results.errors.push(`Failed to delete ${msg.github_path}: ${deleteError.message}`);
        } else {
          results.messages_deleted++;
        }
      }
    }

    console.log(`Rebuild complete for ${repo.full_name}:`, results);

    return jsonResponse({ success: true, results });

  } catch (error) {
    console.error('rebuild-cache error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error');
  }
});
