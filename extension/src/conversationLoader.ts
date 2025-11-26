import * as fs from 'fs';
import * as path from 'path';
import { SchemaConfig, loadSchema } from './schemaParser';
import {
  Message,
  ParseError,
  parseMessage,
  isParseError,
  isMessageFile,
  sortMessages,
  groupMessagesByDate,
} from './messageParser';

export interface Conversation {
  folderPath: string;
  schema: SchemaConfig;
  messages: Message[];
  errors: ParseError[];
  grouped?: Map<string, Message[]>;
}

/**
 * Load all messages from a VibeChannel folder
 */
export function loadConversation(folderPath: string): Conversation {
  const schema = loadSchema(folderPath);
  const messages: Message[] = [];
  const errors: ParseError[] = [];

  try {
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      if (!isMessageFile(file)) {
        continue;
      }

      const filepath = path.join(folderPath, file);
      const stat = fs.statSync(filepath);

      if (!stat.isFile()) {
        continue;
      }

      const result = parseMessage(filepath);

      if (isParseError(result)) {
        errors.push(result);
      } else {
        messages.push(result);
      }
    }
  } catch (error) {
    console.error('Error loading conversation:', error);
  }

  // Sort messages according to schema
  const sortedMessages = sortMessages(messages, schema.rendering.order);

  // Group messages if specified in schema
  let grouped: Map<string, Message[]> | undefined;
  if (schema.rendering.groupBy === 'date') {
    grouped = groupMessagesByDate(sortedMessages);
  }

  return {
    folderPath,
    schema,
    messages: sortedMessages,
    errors,
    grouped,
  };
}

/**
 * Load a single message and add/update it in the conversation
 */
export function updateConversationMessage(
  conversation: Conversation,
  filepath: string
): Conversation {
  const result = parseMessage(filepath);
  const filename = path.basename(filepath);

  // Remove old version if exists
  const messages = conversation.messages.filter((m) => m.filename !== filename);
  const errors = conversation.errors.filter((e) => e.filename !== filename);

  if (isParseError(result)) {
    errors.push(result);
  } else {
    messages.push(result);
  }

  // Re-sort messages
  const sortedMessages = sortMessages(messages, conversation.schema.rendering.order);

  // Re-group if needed
  let grouped: Map<string, Message[]> | undefined;
  if (conversation.schema.rendering.groupBy === 'date') {
    grouped = groupMessagesByDate(sortedMessages);
  }

  return {
    ...conversation,
    messages: sortedMessages,
    errors,
    grouped,
  };
}

/**
 * Remove a message from the conversation
 */
export function removeConversationMessage(
  conversation: Conversation,
  filepath: string
): Conversation {
  const filename = path.basename(filepath);

  const messages = conversation.messages.filter((m) => m.filename !== filename);
  const errors = conversation.errors.filter((e) => e.filename !== filename);

  // Re-group if needed
  let grouped: Map<string, Message[]> | undefined;
  if (conversation.schema.rendering.groupBy === 'date') {
    grouped = groupMessagesByDate(messages);
  }

  return {
    ...conversation,
    messages,
    errors,
    grouped,
  };
}

/**
 * Get unique participants from messages
 */
export function getParticipants(conversation: Conversation): string[] {
  const participants = new Set<string>();

  for (const message of conversation.messages) {
    participants.add(message.from);
  }

  return Array.from(participants).sort();
}

/**
 * Get all tags used in the conversation
 */
export function getAllTags(conversation: Conversation): string[] {
  const tags = new Set<string>();

  for (const message of conversation.messages) {
    if (message.tags) {
      for (const tag of message.tags) {
        tags.add(tag);
      }
    }
  }

  return Array.from(tags).sort();
}

/**
 * Filter messages by participant
 */
export function filterByParticipant(
  conversation: Conversation,
  participant: string
): Message[] {
  return conversation.messages.filter(
    (m) => m.from.toLowerCase() === participant.toLowerCase()
  );
}

/**
 * Filter messages by tag
 */
export function filterByTag(conversation: Conversation, tag: string): Message[] {
  return conversation.messages.filter(
    (m) => m.tags && m.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
  );
}

/**
 * Search messages by content
 */
export function searchMessages(
  conversation: Conversation,
  query: string
): Message[] {
  const lowerQuery = query.toLowerCase();

  return conversation.messages.filter(
    (m) =>
      m.content.toLowerCase().includes(lowerQuery) ||
      m.from.toLowerCase().includes(lowerQuery)
  );
}
