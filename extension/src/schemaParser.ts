import * as fs from 'fs';
import * as path from 'path';

export interface FieldDef {
  name: string;
  type: string;
  description?: string;
}

export interface RenderingConfig {
  sortBy: string;
  order: 'ascending' | 'descending';
  groupBy?: string;
  timestampDisplay?: 'relative' | 'absolute';
}

export interface Participant {
  name: string;
  displayName?: string;
}

export interface SchemaConfig {
  metadata: {
    name: string;
    description?: string;
    created?: string;
    version?: string;
  };
  filenamePattern: string;
  timestampFormat: string;
  idLength: number;
  idCharset: string;
  requiredFields: FieldDef[];
  optionalFields: FieldDef[];
  rendering: RenderingConfig;
  participants: Participant[];
}

const DEFAULT_SCHEMA: SchemaConfig = {
  metadata: {
    name: 'Conversation',
  },
  filenamePattern: '{timestamp}-{sender}-{id}.md',
  timestampFormat: '%Y%m%dT%H%M%S',
  idLength: 6,
  idCharset: 'a-z0-9',
  requiredFields: [
    { name: 'from', type: 'string' },
    { name: 'date', type: 'datetime' },
  ],
  optionalFields: [
    { name: 'reply_to', type: 'string' },
    { name: 'tags', type: 'array' },
    { name: 'edited', type: 'datetime' },
  ],
  rendering: {
    sortBy: 'date',
    order: 'ascending',
    groupBy: 'date',
    timestampDisplay: 'relative',
  },
  participants: [],
};

/**
 * Parse a YAML code block from markdown content
 */
function parseYamlBlock(content: string, sectionName: string): Record<string, unknown> {
  const sectionRegex = new RegExp(
    `##\\s*${sectionName}[\\s\\S]*?\`\`\`yaml\\s*([\\s\\S]*?)\`\`\``,
    'i'
  );
  const match = content.match(sectionRegex);

  if (!match) {
    return {};
  }

  const yamlContent = match[1];
  const result: Record<string, unknown> = {};

  // Simple YAML parser for our use case
  const lines = yamlContent.split('\n');
  let currentKey = '';
  let currentIndent = 0;
  let arrayItems: string[] = [];
  let inArray = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    // Check for array item
    if (trimmed.startsWith('- ')) {
      if (inArray) {
        arrayItems.push(trimmed.substring(2).trim());
      }
      continue;
    }

    // If we were in an array and now we're not, save it
    if (inArray && indent <= currentIndent) {
      result[currentKey] = arrayItems;
      arrayItems = [];
      inArray = false;
    }

    // Key-value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();

      if (value === '' || value === '|') {
        // Possible array or nested object coming
        currentKey = key;
        currentIndent = indent;
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array
        const items = value.slice(1, -1).split(',').map(s => s.trim());
        result[key] = items;
      } else {
        // Simple value - remove quotes if present
        result[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  // Handle any remaining array
  if (inArray && arrayItems.length > 0) {
    result[currentKey] = arrayItems;
  }

  return result;
}

/**
 * Parse schema.md content into a SchemaConfig object
 */
export function parseSchema(content: string): SchemaConfig {
  const config: SchemaConfig = { ...DEFAULT_SCHEMA };

  try {
    // Parse Metadata section
    const metadata = parseYamlBlock(content, 'Metadata');
    if (metadata.name) config.metadata.name = String(metadata.name);
    if (metadata.description) config.metadata.description = String(metadata.description);
    if (metadata.created) config.metadata.created = String(metadata.created);
    if (metadata.version) config.metadata.version = String(metadata.version);

    // Parse Filename Convention section
    const filenameSection = parseYamlBlock(content, 'Filename Convention');
    if (filenameSection.pattern) config.filenamePattern = String(filenameSection.pattern);

    // Look for nested timestamp/id config
    const timestampMatch = content.match(/timestamp:\s*\n\s*format:\s*["']?([^"'\n]+)["']?/);
    if (timestampMatch) config.timestampFormat = timestampMatch[1];

    const idLengthMatch = content.match(/id:\s*\n\s*length:\s*(\d+)/);
    if (idLengthMatch) config.idLength = parseInt(idLengthMatch[1], 10);

    const idCharsetMatch = content.match(/id:\s*\n(?:\s*length:\s*\d+\s*\n)?\s*charset:\s*["']?([^"'\n]+)["']?/);
    if (idCharsetMatch) config.idCharset = idCharsetMatch[1];

    // Parse Rendering section
    const rendering = parseYamlBlock(content, 'Rendering');
    if (rendering.sort_by) config.rendering.sortBy = String(rendering.sort_by);
    if (rendering.order) {
      config.rendering.order = rendering.order === 'descending' ? 'descending' : 'ascending';
    }
    if (rendering.group_by) config.rendering.groupBy = String(rendering.group_by);
    if (rendering.timestamp_display) {
      config.rendering.timestampDisplay = rendering.timestamp_display === 'absolute' ? 'absolute' : 'relative';
    }

    // Parse Participants section
    const participantsMatch = content.match(/##\s*Participants[\s\S]*?```yaml\s*([\s\S]*?)```/i);
    if (participantsMatch) {
      const participantLines = participantsMatch[1].split('\n');
      const participants: Participant[] = [];
      let currentParticipant: Partial<Participant> = {};

      for (const line of participantLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- name:')) {
          if (currentParticipant.name) {
            participants.push(currentParticipant as Participant);
          }
          currentParticipant = { name: trimmed.replace('- name:', '').trim() };
        } else if (trimmed.startsWith('display_name:')) {
          currentParticipant.displayName = trimmed.replace('display_name:', '').trim();
        }
      }

      if (currentParticipant.name) {
        participants.push(currentParticipant as Participant);
      }

      config.participants = participants;
    }
  } catch (error) {
    console.error('Error parsing schema:', error);
    // Return default config on error
  }

  return config;
}

/**
 * Load and parse schema.md from a folder
 */
export function loadSchema(folderPath: string): SchemaConfig {
  const schemaPath = path.join(folderPath, 'schema.md');

  try {
    if (fs.existsSync(schemaPath)) {
      const content = fs.readFileSync(schemaPath, 'utf-8');
      return parseSchema(content);
    }
  } catch (error) {
    console.error('Error loading schema:', error);
  }

  return DEFAULT_SCHEMA;
}

/**
 * Check if a folder is a VibeChannel folder (contains schema.md)
 */
export function isVibeChannelFolder(folderPath: string): boolean {
  const schemaPath = path.join(folderPath, 'schema.md');
  return fs.existsSync(schemaPath);
}
