import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

export interface Message {
  filename: string;
  filepath: string;
  from: string;
  date: Date;
  replyTo?: string;
  tags?: string[];
  edited?: Date;
  content: string;
  rawContent: string;
}

export interface ParseError {
  filename: string;
  error: string;
}

/**
 * Parse a single message file
 */
export function parseMessage(filepath: string): Message | ParseError {
  const filename = path.basename(filepath);

  try {
    const fileContent = fs.readFileSync(filepath, 'utf-8');
    const { data: frontmatter, content } = matter(fileContent);

    // Validate required fields
    if (!frontmatter.from) {
      return { filename, error: 'Missing required field: from' };
    }
    if (!frontmatter.date) {
      return { filename, error: 'Missing required field: date' };
    }

    // Parse date
    let date: Date;
    try {
      date = new Date(frontmatter.date);
      if (isNaN(date.getTime())) {
        return { filename, error: `Invalid date format: ${frontmatter.date}` };
      }
    } catch {
      return { filename, error: `Invalid date format: ${frontmatter.date}` };
    }

    // Parse optional edited date
    let edited: Date | undefined;
    if (frontmatter.edited) {
      try {
        edited = new Date(frontmatter.edited);
        if (isNaN(edited.getTime())) {
          edited = undefined;
        }
      } catch {
        edited = undefined;
      }
    }

    // Parse tags
    let tags: string[] | undefined;
    if (frontmatter.tags) {
      if (Array.isArray(frontmatter.tags)) {
        tags = frontmatter.tags.map(String);
      } else if (typeof frontmatter.tags === 'string') {
        // Handle comma-separated string
        tags = frontmatter.tags.split(',').map((t: string) => t.trim());
      }
    }

    return {
      filename,
      filepath,
      from: String(frontmatter.from),
      date,
      replyTo: frontmatter.reply_to ? String(frontmatter.reply_to) : undefined,
      tags,
      edited,
      content: content.trim(),
      rawContent: fileContent,
    };
  } catch (error) {
    return {
      filename,
      error: error instanceof Error ? error.message : 'Unknown error parsing message',
    };
  }
}

/**
 * Check if a parse result is an error
 */
export function isParseError(result: Message | ParseError): result is ParseError {
  return 'error' in result;
}

/**
 * Check if a filename is a message file (not schema.md or agent.md)
 */
export function isMessageFile(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  return (
    filename.endsWith('.md') &&
    lowerFilename !== 'schema.md' &&
    lowerFilename !== 'agent.md' &&
    lowerFilename !== 'readme.md'
  );
}

/**
 * Extract components from a message filename
 * Expected format: {timestamp}-{sender}-{id}.md
 */
export function parseFilename(filename: string): {
  timestamp: string;
  sender: string;
  id: string;
} | null {
  // Remove .md extension
  const baseName = filename.replace(/\.md$/i, '');

  // Match pattern: YYYYMMDDTHHMMSS-sender-id
  const match = baseName.match(/^(\d{8}T\d{6})-([a-z0-9]+)-([a-z0-9]+)$/i);

  if (!match) {
    return null;
  }

  return {
    timestamp: match[1],
    sender: match[2],
    id: match[3],
  };
}

/**
 * Parse timestamp string from filename to Date
 * Format: YYYYMMDDTHHMMSS
 */
export function parseTimestamp(timestamp: string): Date | null {
  const match = timestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year),
    parseInt(month) - 1, // Months are 0-indexed
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  );
}

/**
 * Sort messages by date
 */
export function sortMessages(
  messages: Message[],
  order: 'ascending' | 'descending' = 'ascending'
): Message[] {
  return [...messages].sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    return order === 'ascending' ? diff : -diff;
  });
}

/**
 * Group messages by date (day) using local time
 */
export function groupMessagesByDate(messages: Message[]): Map<string, Message[]> {
  const groups = new Map<string, Message[]>();

  for (const message of messages) {
    // Use local date components instead of UTC (toISOString uses UTC)
    const year = message.date.getFullYear();
    const month = String(message.date.getMonth() + 1).padStart(2, '0');
    const day = String(message.date.getDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`; // YYYY-MM-DD in local time

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(message);
  }

  return groups;
}

/**
 * Build a thread tree from messages
 */
export function buildThreads(messages: Message[]): Map<string, Message[]> {
  const threads = new Map<string, Message[]>();

  for (const message of messages) {
    const parentId = message.replyTo || 'root';

    if (!threads.has(parentId)) {
      threads.set(parentId, []);
    }
    threads.get(parentId)!.push(message);
  }

  return threads;
}
