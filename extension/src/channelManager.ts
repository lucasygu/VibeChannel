import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export const VIBECHANNEL_FOLDER = '.vibechannel';
export const DEFAULT_CHANNEL = 'general';

/**
 * Template for agent.md
 */
const AGENT_MD_TEMPLATE = `# Agent Instructions for VibeChannel

This folder contains conversations following the VibeChannel protocol.

**IMPORTANT:** Read \`schema.md\` for the complete format specification. This file
provides instructions for AI agents to correctly create messages.

## Overview

- Each channel is a subfolder inside \`.vibechannel/\`
- Each message is a separate \`.md\` file inside a channel
- Filenames encode timestamp, sender, and unique ID
- Content uses YAML frontmatter + markdown body
- See \`schema.md\` for exact format requirements

## Creating a Message

### Critical Rules

1. **NEVER** guess or hallucinate the timestamp
2. **NEVER** guess or hallucinate the sender name
3. **ALWAYS** use bash commands to get accurate data
4. **ALWAYS** generate a fresh unique ID per message

### Step-by-Step Process

#### Step 1: Get Current Timestamp

\`\`\`bash
date +%Y%m%dT%H%M%S
\`\`\`

Expected output format: \`20250115T103045\`

This is used in the filename. Store this value.

#### Step 2: Get ISO Timestamp for Frontmatter

\`\`\`bash
date -u +%Y-%m-%dT%H:%M:%SZ
\`\`\`

Expected output format: \`2025-01-15T10:30:45Z\`

This is used in the \`date\` field of frontmatter. Store this value.

#### Step 3: Get Sender Name

\`\`\`bash
git config user.name
\`\`\`

Then normalize it:
\`\`\`bash
git config user.name | tr '[:upper:]' '[:lower:]' | tr -d ' ' | tr -cd 'a-z0-9'
\`\`\`

If git config is not set or returns empty, **ask the user** for their name.
Do NOT make up a name.

#### Step 4: Generate Unique ID

\`\`\`bash
cat /dev/urandom | tr -dc 'a-z0-9' | head -c 6
\`\`\`

Expected output: 6 random alphanumeric characters like \`a3f8x2\`

Generate a fresh ID for EVERY message. Never reuse IDs.

#### Step 5: Construct Filename

Pattern: \`{timestamp}-{sender}-{id}.md\`

Example: \`20250115T103045-lucas-a3f8x2.md\`

#### Step 6: Write Message File

Create the file in the appropriate channel folder with this structure:

\`\`\`markdown
---
from: {sender}
date: {iso_timestamp}
---

{message content here}
\`\`\`

## Reading the Conversation

To understand conversation context before responding:

1. List channel folders:
   \`\`\`bash
   ls -1 .vibechannel/
   \`\`\`

2. List messages in a channel:
   \`\`\`bash
   ls -1 .vibechannel/general/*.md | sort
   \`\`\`

3. Files are sorted chronologically by filename

4. Read recent messages to understand context

## Threading (Optional)

To reply to a specific message, include the \`reply_to\` field:

\`\`\`markdown
---
from: alice
date: 2025-01-15T10:35:00Z
reply_to: 20250115T103045-lucas-a3f8x2.md
---

This is a reply to Lucas's message.
\`\`\`

## File Structure

\`\`\`
.vibechannel/
├── agent.md                         # This file - your instructions
├── schema.md                        # Format definition
├── general/                         # Default channel
│   ├── 20250115T103045-lucas-a3f8x2.md
│   └── ...
├── random/                          # Another channel
│   └── ...
└── project-ideas/                   # Another channel
    └── ...
\`\`\`

Only create new message files inside channel folders. Do not modify \`schema.md\` or \`agent.md\` unless explicitly asked.
`;

/**
 * Template for schema.md
 */
const SCHEMA_MD_TEMPLATE = `# VibeChannel Schema

This file defines the format for VibeChannel conversations.

## Folder Structure

\`\`\`yaml
root: .vibechannel/
channels: subfolders (e.g., general/, random/, dev/)
messages: markdown files inside channel folders
\`\`\`

## Filename Convention

Messages are stored as individual markdown files with this naming pattern:

\`\`\`yaml
pattern: "{timestamp}-{sender}-{id}.md"
timestamp:
  format: "%Y%m%dT%H%M%S"
  example: "20250115T103045"
sender:
  format: "lowercase alphanumeric, no spaces"
  example: "lucas"
id:
  length: 6
  charset: "a-z0-9"
  example: "a3f8x2"
\`\`\`

Full example: \`20250115T103045-lucas-a3f8x2.md\`

## Message Format

Each message file contains YAML frontmatter and markdown content.

### Required Fields

\`\`\`yaml
from: string        # Sender identifier (should match filename)
date: datetime      # ISO 8601 format (e.g., 2025-01-15T10:30:45Z)
\`\`\`

### Optional Fields

\`\`\`yaml
reply_to: string    # Filename of parent message for threading
tags: [array]       # Categorization tags
edited: datetime    # Last edit timestamp
\`\`\`

### Example Message

\`\`\`markdown
---
from: lucas
date: 2025-01-15T10:30:45Z
tags: [idea, discussion]
---

Here is my message content with **markdown** support.
\`\`\`

## Rendering Preferences

\`\`\`yaml
rendering:
  sort_by: date
  order: ascending
  group_by: date
  timestamp_display: relative
\`\`\`
`;

/**
 * Get the .vibechannel folder path for a workspace
 */
export function getVibeChannelRoot(workspacePath: string): string {
  return path.join(workspacePath, VIBECHANNEL_FOLDER);
}

/**
 * Check if .vibechannel folder exists in workspace
 */
export function hasVibeChannel(workspacePath: string): boolean {
  const vibechannelPath = getVibeChannelRoot(workspacePath);
  return fs.existsSync(vibechannelPath);
}

/**
 * Initialize .vibechannel folder with default structure
 */
export function initializeVibeChannel(workspacePath: string): string {
  const vibechannelPath = getVibeChannelRoot(workspacePath);
  const generalPath = path.join(vibechannelPath, DEFAULT_CHANNEL);

  // Create .vibechannel folder
  if (!fs.existsSync(vibechannelPath)) {
    fs.mkdirSync(vibechannelPath, { recursive: true });
  }

  // Create agent.md
  const agentPath = path.join(vibechannelPath, 'agent.md');
  if (!fs.existsSync(agentPath)) {
    fs.writeFileSync(agentPath, AGENT_MD_TEMPLATE, 'utf-8');
  }

  // Create schema.md
  const schemaPath = path.join(vibechannelPath, 'schema.md');
  if (!fs.existsSync(schemaPath)) {
    fs.writeFileSync(schemaPath, SCHEMA_MD_TEMPLATE, 'utf-8');
  }

  // Create general channel folder
  if (!fs.existsSync(generalPath)) {
    fs.mkdirSync(generalPath, { recursive: true });
  }

  return generalPath;
}

/**
 * Get list of channels in .vibechannel folder
 */
export function getChannels(workspacePath: string): string[] {
  const vibechannelPath = getVibeChannelRoot(workspacePath);

  if (!fs.existsSync(vibechannelPath)) {
    return [];
  }

  const entries = fs.readdirSync(vibechannelPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Create a new channel
 */
export function createChannel(workspacePath: string, channelName: string): string {
  const vibechannelPath = getVibeChannelRoot(workspacePath);
  const channelPath = path.join(vibechannelPath, channelName);

  if (!fs.existsSync(channelPath)) {
    fs.mkdirSync(channelPath, { recursive: true });
  }

  return channelPath;
}

/**
 * Show channel picker and return selected channel path
 */
export async function showChannelPicker(workspacePath: string): Promise<string | undefined> {
  const channels = getChannels(workspacePath);

  if (channels.length === 0) {
    // No channels exist, initialize and return general
    const generalPath = initializeVibeChannel(workspacePath);
    vscode.window.showInformationMessage('VibeChannel initialized with #general channel');
    return generalPath;
  }

  // Build quick pick items
  const items: vscode.QuickPickItem[] = channels.map((channel) => ({
    label: `#${channel}`,
    description: path.join(VIBECHANNEL_FOLDER, channel),
  }));

  // Add option to create new channel
  items.push({
    label: '$(add) Create new channel...',
    description: 'Create a new conversation channel',
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a channel to open',
  });

  if (!selected) {
    return undefined;
  }

  // Handle create new channel
  if (selected.label.startsWith('$(add)')) {
    const newChannelName = await vscode.window.showInputBox({
      prompt: 'Enter channel name',
      placeHolder: 'e.g., random, dev-chat, project-ideas',
      validateInput: (value) => {
        if (!value) {
          return 'Channel name is required';
        }
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Channel name can only contain lowercase letters, numbers, and hyphens';
        }
        if (channels.includes(value)) {
          return 'Channel already exists';
        }
        return null;
      },
    });

    if (!newChannelName) {
      return undefined;
    }

    const channelPath = createChannel(workspacePath, newChannelName);
    vscode.window.showInformationMessage(`Created #${newChannelName} channel`);
    return channelPath;
  }

  // Return selected channel path
  const channelName = selected.label.replace('#', '');
  return path.join(getVibeChannelRoot(workspacePath), channelName);
}

/**
 * Check if a path is a valid channel folder (inside .vibechannel)
 */
export function isChannelFolder(folderPath: string): boolean {
  const parentDir = path.dirname(folderPath);
  const parentName = path.basename(parentDir);
  return parentName === VIBECHANNEL_FOLDER;
}

/**
 * Check if a path is the .vibechannel folder itself
 */
export function isVibeChannelRoot(folderPath: string): boolean {
  return path.basename(folderPath) === VIBECHANNEL_FOLDER;
}

/**
 * Get workspace root from a .vibechannel folder path
 */
export function getWorkspaceFromVibeChannelRoot(vibechannelPath: string): string {
  return path.dirname(vibechannelPath);
}
