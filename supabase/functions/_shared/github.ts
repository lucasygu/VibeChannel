// =============================================================================
// GitHub API Helpers for VibeChannel Edge Functions
// =============================================================================

import { createAppAuth } from 'https://esm.sh/@octokit/auth-app@6.0.0';
import { Octokit } from 'https://esm.sh/@octokit/rest@20.0.0';

/**
 * Get an authenticated Octokit instance for a specific GitHub App installation
 */
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const appId = Deno.env.get('GITHUB_APP_ID');
  const privateKeyRaw = Deno.env.get('GITHUB_APP_PRIVATE_KEY');

  if (!appId || !privateKeyRaw) {
    throw new Error('Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY environment variables');
  }

  // Handle escaped newlines in private key
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: appId,
      privateKey: privateKey,
      installationId: installationId,
    },
  });

  return octokit;
}

/**
 * Generate a message filename following the VibeChannel convention
 * Format: {YYYYMMDDTHHMMSS}-{sender}-{6-char-id}.md
 */
export function generateMessageFilename(sender: string, createdAt: Date): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');

  const randomId = Array.from({ length: 6 }, () =>
    '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('');

  // Sanitize sender name for filename
  const safeSender = sender.toLowerCase().replace(/[^a-z0-9-]/g, '');

  return `${timestamp}-${safeSender}-${randomId}.md`;
}

/**
 * Generate markdown content for a message with YAML frontmatter
 */
export function generateMessageContent(message: {
  sender: string;
  content: string;
  createdAt: string;
  replyTo?: string;
  tags?: string[];
}): string {
  const frontmatterLines = [
    '---',
    `from: ${message.sender}`,
    `date: ${message.createdAt}`,
  ];

  if (message.replyTo) {
    frontmatterLines.push(`reply_to: ${message.replyTo}`);
  }

  if (message.tags && message.tags.length > 0) {
    frontmatterLines.push(`tags: [${message.tags.join(', ')}]`);
  }

  frontmatterLines.push('---');

  return `${frontmatterLines.join('\n')}\n\n${message.content}\n`;
}

/**
 * Create the vibechannel branch if it doesn't exist
 */
export async function initializeVibechannelBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  defaultBranch: string,
  vibechannelBranch: string = 'vibechannel'
): Promise<boolean> {
  try {
    // Check if branch already exists
    try {
      await octokit.repos.getBranch({
        owner,
        repo,
        branch: vibechannelBranch,
      });
      // Branch exists
      return true;
    } catch (error: unknown) {
      if ((error as { status?: number }).status !== 404) {
        throw error;
      }
      // Branch doesn't exist, create it
    }

    // Get the SHA of the default branch
    const { data: defaultRef } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });

    // Create orphan branch by creating an empty tree and commit
    const { data: emptyTree } = await octokit.git.createTree({
      owner,
      repo,
      tree: [
        {
          path: '.gitkeep',
          mode: '100644',
          type: 'blob',
          content: '# VibeChannel\n\nThis branch stores VibeChannel messages.\n',
        },
      ],
    });

    // Create initial commit
    const { data: commit } = await octokit.git.createCommit({
      owner,
      repo,
      message: 'Initialize VibeChannel',
      tree: emptyTree.sha,
      parents: [], // Empty parents = orphan branch
    });

    // Create the branch reference
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${vibechannelBranch}`,
      sha: commit.sha,
    });

    return true;
  } catch (error) {
    console.error('Failed to initialize vibechannel branch:', error);
    return false;
  }
}
