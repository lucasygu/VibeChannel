// =============================================================================
// sync-to-github Edge Function
// Syncs new messages from Supabase to GitHub repository
// =============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient, handleCors, jsonResponse, errorResponse } from '../_shared/supabase.ts';
import { getInstallationOctokit, generateMessageFilename, generateMessageContent } from '../_shared/github.ts';

interface MessageRecord {
  id: string;
  channel_id: string;
  sender: string;
  content: string;
  created_at: string;
  reply_to_path?: string;
  tags?: string[];
}

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { record, type } = await req.json();

    // Only process inserts
    if (type !== 'INSERT') {
      return jsonResponse({ skipped: true, reason: 'Not an INSERT operation' });
    }

    const message: MessageRecord = record;
    const supabase = getServiceClient();

    // Get channel and repo info
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select(`
        name,
        repo:repos (
          id,
          owner,
          name,
          vibechannel_branch,
          github_installation_id
        )
      `)
      .eq('id', message.channel_id)
      .single();

    if (channelError || !channel) {
      throw new Error(`Channel not found: ${channelError?.message}`);
    }

    const repo = channel.repo as {
      id: string;
      owner: string;
      name: string;
      vibechannel_branch: string;
      github_installation_id: number;
    };

    if (!repo) {
      throw new Error('Repo not found for channel');
    }

    // Get GitHub client for this installation
    const octokit = await getInstallationOctokit(repo.github_installation_id);

    // Generate filename and path
    const filename = generateMessageFilename(message.sender, new Date(message.created_at));
    const filepath = `${channel.name}/${filename}`;

    // Generate markdown content
    const content = generateMessageContent({
      sender: message.sender,
      content: message.content,
      createdAt: message.created_at,
      replyTo: message.reply_to_path,
      tags: message.tags,
    });

    // Create file in GitHub
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: repo.owner,
      repo: repo.name,
      path: filepath,
      message: `Message in #${channel.name}`,
      content: btoa(content),
      branch: repo.vibechannel_branch,
    });

    // Update message with GitHub info
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        github_path: filepath,
        github_sha: response.data.content?.sha,
        github_synced: true,
        synced_at: new Date().toISOString(),
      })
      .eq('id', message.id);

    if (updateError) {
      console.error('Failed to update message sync status:', updateError);
      // Don't throw - the message was created in GitHub successfully
    }

    console.log(`Synced message to GitHub: ${filepath}`);

    return jsonResponse({
      success: true,
      path: filepath,
      sha: response.data.content?.sha,
    });

  } catch (error) {
    console.error('sync-to-github error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error');
  }
});
