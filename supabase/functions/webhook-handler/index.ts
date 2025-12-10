// =============================================================================
// webhook-handler Edge Function
// Handles GitHub webhooks for app installation and push events
// =============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { verify } from 'https://esm.sh/@octokit/webhooks-methods@4.0.0';
import { getServiceClient, jsonResponse, errorResponse } from '../_shared/supabase.ts';
import { getInstallationOctokit, initializeVibechannelBranch } from '../_shared/github.ts';
import { parseMessageFile, isMessageFile } from '../_shared/markdown.ts';

serve(async (req: Request) => {
  // Get headers
  const signature = req.headers.get('x-hub-signature-256');
  const event = req.headers.get('x-github-event');
  const deliveryId = req.headers.get('x-github-delivery');

  console.log(`Received webhook: ${event} (${deliveryId})`);

  // Read body as text for signature verification
  const body = await req.text();

  // Verify webhook signature
  const secret = Deno.env.get('GITHUB_WEBHOOK_SECRET');
  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET not configured');
    return errorResponse('Webhook secret not configured', 500);
  }

  const isValid = await verify(secret, body, signature || '');
  if (!isValid) {
    console.error('Invalid webhook signature');
    return errorResponse('Invalid signature', 401);
  }

  const payload = JSON.parse(body);
  const supabase = getServiceClient();

  try {
    switch (event) {
      case 'installation':
        await handleInstallation(supabase, payload);
        break;
      case 'installation_repositories':
        await handleInstallationRepositories(supabase, payload);
        break;
      case 'push':
        await handlePush(supabase, payload);
        break;
      default:
        console.log(`Unhandled event type: ${event}`);
    }

    return jsonResponse({ success: true, event });

  } catch (error) {
    console.error(`Webhook error (${event}):`, error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error');
  }
});

// -----------------------------------------------------------------------------
// Installation handlers
// -----------------------------------------------------------------------------

async function handleInstallation(supabase: ReturnType<typeof getServiceClient>, payload: {
  action: string;
  installation: { id: number };
  repositories?: Array<{
    id: number;
    full_name: string;
    default_branch?: string;
  }>;
}) {
  const { action, installation, repositories } = payload;

  console.log(`Installation ${action}: ${installation.id}`);

  if (action === 'created') {
    // New installation - add all repos
    for (const repo of repositories || []) {
      await upsertRepo(supabase, installation.id, repo);
    }
  } else if (action === 'deleted') {
    // Installation removed - delete all repos for this installation
    const { error } = await supabase
      .from('repos')
      .delete()
      .eq('github_installation_id', installation.id);

    if (error) {
      console.error('Failed to delete repos for installation:', error);
    }
  }
}

async function handleInstallationRepositories(supabase: ReturnType<typeof getServiceClient>, payload: {
  action: string;
  installation: { id: number };
  repositories_added?: Array<{
    id: number;
    full_name: string;
    default_branch?: string;
  }>;
  repositories_removed?: Array<{ id: number }>;
}) {
  const { action, installation, repositories_added, repositories_removed } = payload;

  console.log(`Installation repositories ${action}: ${installation.id}`);

  if (action === 'added') {
    for (const repo of repositories_added || []) {
      await upsertRepo(supabase, installation.id, repo);
    }
  } else if (action === 'removed') {
    for (const repo of repositories_removed || []) {
      const { error } = await supabase
        .from('repos')
        .delete()
        .eq('github_repo_id', repo.id);

      if (error) {
        console.error(`Failed to delete repo ${repo.id}:`, error);
      }
    }
  }
}

async function upsertRepo(
  supabase: ReturnType<typeof getServiceClient>,
  installationId: number,
  repo: { id: number; full_name: string; default_branch?: string }
) {
  const [owner, name] = repo.full_name.split('/');

  const { error } = await supabase.from('repos').upsert({
    github_installation_id: installationId,
    github_repo_id: repo.id,
    owner,
    name,
    full_name: repo.full_name,
    default_branch: repo.default_branch || 'main',
  }, {
    onConflict: 'github_repo_id',
  });

  if (error) {
    console.error(`Failed to upsert repo ${repo.full_name}:`, error);
  } else {
    console.log(`Upserted repo: ${repo.full_name}`);

    // Initialize vibechannel branch
    try {
      const octokit = await getInstallationOctokit(installationId);
      await initializeVibechannelBranch(octokit, owner, name, repo.default_branch || 'main');
    } catch (error) {
      console.error(`Failed to initialize vibechannel branch for ${repo.full_name}:`, error);
    }
  }
}

// -----------------------------------------------------------------------------
// Push handler (external commits from AI agents, etc.)
// -----------------------------------------------------------------------------

async function handlePush(supabase: ReturnType<typeof getServiceClient>, payload: {
  ref: string;
  repository: { id: number };
  commits: Array<{
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
}) {
  const branch = payload.ref.replace('refs/heads/', '');
  const repoId = payload.repository.id;

  // Get repo from database
  const { data: repo, error } = await supabase
    .from('repos')
    .select('*')
    .eq('github_repo_id', repoId)
    .single();

  if (error || !repo) {
    console.log(`Repo not found for push: ${repoId}`);
    return;
  }

  // Only process vibechannel branch
  if (branch !== repo.vibechannel_branch) {
    console.log(`Ignoring push to branch ${branch} (not ${repo.vibechannel_branch})`);
    return;
  }

  console.log(`Processing push to ${repo.full_name}/${branch}`);

  const octokit = await getInstallationOctokit(repo.github_installation_id);

  // Process each commit
  for (const commit of payload.commits) {
    const files = [...(commit.added || []), ...(commit.modified || [])];

    for (const filepath of files) {
      // Only process message files
      if (!isMessageFile(filepath)) {
        continue;
      }

      const channelName = filepath.split('/')[0];

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
          console.error(`Failed to create channel ${channelName}:`, channelError);
          continue;
        }
        channel = newChannel;
      }

      // Fetch file content from GitHub
      try {
        const { data: fileData } = await octokit.repos.getContent({
          owner: repo.owner,
          repo: repo.name,
          path: filepath,
          ref: branch,
        });

        if (!('content' in fileData)) {
          continue;
        }

        const content = atob(fileData.content);
        const parsed = parseMessageFile(content);

        if (!parsed) {
          console.log(`Could not parse message: ${filepath}`);
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
          github_path: filepath,
          github_sha: fileData.sha,
          github_synced: true,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: 'channel_id,github_path',
        });

        if (upsertError) {
          console.error(`Failed to upsert message ${filepath}:`, upsertError);
        } else {
          console.log(`Synced message from GitHub: ${filepath}`);
        }

      } catch (error) {
        console.error(`Failed to fetch file ${filepath}:`, error);
      }
    }

    // Handle deleted files
    for (const filepath of commit.removed || []) {
      if (!filepath.endsWith('.md')) continue;

      const { error: deleteError } = await supabase
        .from('messages')
        .delete()
        .eq('github_path', filepath);

      if (deleteError) {
        console.error(`Failed to delete message ${filepath}:`, deleteError);
      } else {
        console.log(`Deleted message: ${filepath}`);
      }
    }
  }
}
