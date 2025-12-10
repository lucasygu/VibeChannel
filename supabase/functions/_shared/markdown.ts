// =============================================================================
// Markdown Message Parsing for VibeChannel Edge Functions
// =============================================================================

import { parse as parseYaml } from 'https://deno.land/std@0.208.0/yaml/mod.ts';

/**
 * Parsed message structure from a .md file
 */
export interface ParsedMessage {
  frontmatter: {
    from: string;
    date: string;
    reply_to?: string;
    tags?: string[];
  };
  content: string;
}

/**
 * Parse a VibeChannel message file content
 * Returns null if the file doesn't match expected format
 */
export function parseMessageFile(fileContent: string): ParsedMessage | null {
  // Match YAML frontmatter between --- markers
  const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return null;
  }

  try {
    const frontmatter = parseYaml(frontmatterMatch[1]) as ParsedMessage['frontmatter'];
    const content = frontmatterMatch[2].trim();

    // Validate required fields
    if (!frontmatter.from || !frontmatter.date) {
      return null;
    }

    return { frontmatter, content };
  } catch {
    return null;
  }
}

/**
 * Extract channel name and filename from a path
 * e.g., "general/20250115T103045-lucas-a3f8c2.md" -> { channel: "general", filename: "20250115T103045-lucas-a3f8c2.md" }
 */
export function parseFilePath(filepath: string): { channel: string; filename: string } | null {
  const parts = filepath.split('/');

  if (parts.length !== 2) {
    return null;
  }

  const [channel, filename] = parts;

  if (!filename.endsWith('.md')) {
    return null;
  }

  return { channel, filename };
}

/**
 * Check if a file should be processed as a message
 * Excludes schema.md, agent.md, README.md, hidden files, etc.
 */
export function isMessageFile(filepath: string): boolean {
  // Must be a .md file
  if (!filepath.endsWith('.md')) {
    return false;
  }

  // Must be in a channel folder (exactly one level deep)
  if (!filepath.includes('/')) {
    return false;
  }

  // Must not start with a dot (hidden files)
  if (filepath.startsWith('.')) {
    return false;
  }

  // Get filename
  const filename = filepath.split('/').pop();
  if (!filename) {
    return false;
  }

  // Skip special files
  const specialFiles = ['schema.md', 'agent.md', 'README.md', '.gitkeep'];
  if (specialFiles.includes(filename)) {
    return false;
  }

  return true;
}
