# VibeChannel: A Filesystem-Based Conversation Protocol

## Executive Summary

A minimal, decentralized chat system where a folder of markdown files renders as a conversation interface. Each message is an atomic markdown file following a defined schema, making conversations git-friendly, portable, and truly decentralized.

## Naming

**VibeChannel** — The name captures both the casual nature ("vibe") and the familiar communication metaphor ("channel" as in Slack, Discord, IRC).

### Naming Considerations

| Candidate | Verdict |
|-----------|---------|
| Chatdir | Strong Maildir parallel, but generic |
| Vibedir | Good, but "dir" is technical |
| VibeChan | Short, but "chan" has 4chan/anime connotations |
| Vibe Channel | Clear but two words |
| **VibeChannel** | ✓ One word, clear meaning, casual + familiar |

### Usage

- Display name: **VibeChannel**
- Package/extension ID: `vibechannel`
- Command prefix: `vibechannel.*`
- Folder convention: `.vibechannel/` or just any folder with `schema.md`

---

## Part 1: Analysis & Investigation

### 1.1 Research Findings

We investigated existing solutions across several categories:

#### Chat-to-Markdown Tools
- **chat.md** (VSCode extension): Uses a single markdown file as a chat interface with AI models. Not multi-file, not decentralized.
- **Cursor Chat Keeper**: Exports AI chat history to markdown files. Export-only, not a live system.
- **Various chat exporters**: Convert chat history to markdown for archival. One-way, not interactive.

#### Decentralized Chat Systems
- **IPFS-based chat**: Complex, requires IPFS infrastructure.
- **Chitchatter**: WebRTC-based, ephemeral, no persistence.
- **Matrix/XMPP**: Full protocols with servers, authentication, significant complexity.

#### File-Per-Message Precedents
- **Maildir format**: Email storage where each email is a separate file in a directory structure (`new/`, `cur/`, `tmp/`). Proven at scale, git-friendly, used by Dovecot and others.
- **Notmuch**: Indexes Maildir for search. Demonstrates the pattern works.

#### Static Site Generators
- Jekyll, Hugo, etc.: Render markdown folders to HTML. Similar concept but for blogs/docs, not chat.

### 1.2 Gap Analysis

**What exists:**
- Single-file chat interfaces
- Complex decentralized protocols
- Email systems with file-per-message (Maildir)
- Static site generators for markdown

**What doesn't exist:**
- Maildir-style simplicity applied to chat
- Folder of markdown → chat UI renderer
- Self-contained, portable conversation folders
- Schema-driven chat rendering

This gap is what **VibeChannel** fills.

### 1.3 Insight

The Maildir format solved the "one file per message" problem for email decades ago. The same principles apply to chat:
- Atomic files = no corruption risk
- No coordination needed = truly decentralized
- Filesystem is the database = universal compatibility
- Git-friendly = version control for free

**The gap:** Nobody has built a minimal renderer that treats a markdown folder as a chat conversation.

---

## Part 2: Motivation & Problem Statement

### 2.1 Why This Matters

#### Problem 1: Chat Lock-in
Conversations in Slack, Discord, iMessage, etc. are trapped in proprietary formats and servers. You can't:
- Version control your conversations
- Merge conversation branches
- Own your data as plain files
- Move between platforms

#### Problem 2: Collaboration Friction
When collaborating on projects, chat history is separate from code. What if conversations could live *in* the repository?

#### Problem 3: AI Agent Integration
AI agents (Claude Code, Cursor, Copilot) work with files. A chat system that *is* files means agents can participate naturally—reading schema, creating messages, following protocols.

#### Problem 4: Complexity Overhead
Existing solutions require:
- Servers
- Databases
- Authentication systems
- Sync protocols
- Client applications

**What if you just needed a folder?**

### 2.2 Design Philosophy

#### Minimalism
- No validation
- No consistency checks
- No user management
- No server
- No database

#### Self-Containment
The folder IS the conversation. Copy it anywhere, it works. Clone it, fork it, merge it.

#### Separation of Concerns
- **schema.md**: Defines format (single source of truth)
- **agent.md**: Instructions for AI agents (references schema.md)
- **Extension**: Renders what's there (doesn't create, validate, or enforce)

#### DRY Principle
Schema defined once in schema.md. Agent.md references it, doesn't repeat it. Extension reads it, doesn't hardcode it.

### 2.3 Use Cases

1. **Project Discussions**: Chat folder inside a repo. Decisions tracked with code.
2. **Async Collaboration**: Team members add messages by adding files. Git handles sync.
3. **AI Conversations**: Agent creates messages following agent.md instructions.
4. **Personal Notes**: Conversation with yourself, timestamped and searchable.
5. **Interview Records**: Each response is a file, easy to review and annotate.
6. **Support Threads**: Customer and support messages as files, full history.

---

## Part 3: Architecture

### 3.1 Folder Structure

```
my-vibechannel/
├── schema.md                              # Format definition + rendering config
├── agent.md                               # AI agent instructions
├── 20250115T103045-lucas-a3f8x2.md       # Message files...
├── 20250115T103215-alice-k9m2p7.md
├── 20250115T103540-lucas-b7n4q1.md
└── 20250115T104012-bob-x2c8v5.md
```

### 3.2 Filename Convention

```
{timestamp}-{sender}-{shortid}.md
```

| Component | Format | Example | Purpose |
|-----------|--------|---------|---------|
| timestamp | `YYYYMMDDTHHMMSS` | `20250115T103045` | Chronological sort, second precision |
| sender | lowercase alphanumeric | `lucas` | Attribution, glanceable in `ls` |
| shortid | 6-char alphanumeric | `a3f8x2` | Collision avoidance, no coordination needed |

**Why this format:**
- `ls` shows conversation in order
- Filename alone tells you who/when
- No need to open files to understand flow
- Parallel-safe (short UUID vs sequence number)
- Git diffs show exactly what changed

### 3.3 Message File Structure

```markdown
---
from: lucas
date: 2025-01-15T10:30:45Z
reply_to: 20250115T102030-alice-x7k2m9.md  # optional
tags: [question, urgent]                    # optional
---

The actual message content goes here.

Supports full **markdown** formatting.
```

#### Required Frontmatter
| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Sender identifier |
| `date` | ISO 8601 | Message timestamp |

#### Optional Frontmatter
| Field | Type | Description |
|-------|------|-------------|
| `reply_to` | string | Filename of parent message (threading) |
| `tags` | array | Categorization labels |
| `edited` | ISO 8601 | Last edit timestamp |

### 3.4 schema.md Structure

```markdown
# Conversation Schema

## Metadata
name: Project Discussion
created: 2025-01-15T10:00:00Z
description: Technical decisions for the widget project

## Filename Format
pattern: "{timestamp}-{sender}-{id}.md"
timestamp_format: "%Y%m%dT%H%M%S"
id_length: 6
id_charset: "abcdefghijklmnopqrstuvwxyz0123456789"

## Message Format
required_fields:
  - from: string
  - date: datetime (ISO 8601)

optional_fields:
  - reply_to: string (filename)
  - tags: array of strings
  - edited: datetime (ISO 8601)

## Rendering
sort_by: date
order: ascending
group_by: date  # Optional: group messages by day

## Participants (optional, informational only)
participants:
  - lucas
  - alice
  - bob
```

### 3.5 agent.md Structure

```markdown
# Agent Instructions for VibeChannel

This folder is a conversation following the VibeChannel protocol.
Read `schema.md` for the complete format specification.

## Creating a Message

You MUST use bash tools for accurate data. Do NOT guess or hallucinate.

### Step 1: Get the timestamp
```bash
date +%Y%m%dT%H%M%S
```
This returns format: 20250115T103045

### Step 2: Get the sender name
```bash
git config user.name
```
Use this as the sender identifier. Convert to lowercase, remove spaces.
If git config is not set, ask the user for their name.

### Step 3: Generate a short ID
```bash
cat /dev/urandom | tr -dc 'a-z0-9' | head -c 6
```
This returns 6 random alphanumeric characters.

### Step 4: Create the filename
Combine: `{timestamp}-{sender}-{id}.md`
Example: `20250115T103045-lucas-a3f8x2.md`

### Step 5: Write the file
Follow the format in schema.md:
- YAML frontmatter with `from` and `date`
- Content in markdown

## Example Complete Flow

```bash
# Get components
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
SENDER=$(git config user.name | tr '[:upper:]' '[:lower:]' | tr -d ' ')
ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 6)
FILENAME="${TIMESTAMP}-${SENDER}-${ID}.md"

# Get ISO date for frontmatter
ISO_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

## Reading the Conversation

To understand the conversation context:
1. List all .md files except schema.md and agent.md
2. Sort by filename (gives chronological order)
3. Parse frontmatter for metadata
4. Content is the message body

## Important Rules

1. NEVER guess the timestamp - always use `date` command
2. NEVER guess the sender - always use `git config user.name`
3. ALWAYS generate a fresh short ID for each message
4. ALWAYS follow the format in schema.md
5. DO NOT modify existing messages unless asked to edit
```

---

## Part 4: Implementation Plan

### Phase 1: Specification Files

#### 1.1 Create Example schema.md
**File:** `schema.md`
**Purpose:** Template/reference implementation of the schema definition
**Details:**
- YAML-like markdown structure
- All field definitions with types
- Filename pattern specification
- Rendering preferences
- Comments explaining each section

#### 1.2 Create Example agent.md  
**File:** `agent.md`
**Purpose:** Template/reference implementation of agent instructions
**Details:**
- Clear step-by-step message creation process
- Exact bash commands for timestamp, sender, ID
- Cross-reference to schema.md (DRY)
- Examples of correct output
- Common pitfalls to avoid

#### 1.3 Create Example Messages
**Files:** 3-5 sample message files
**Purpose:** Test data and format demonstration
**Details:**
- Various senders
- Different timestamps
- Some with reply_to (threading)
- Different content types (text, code blocks, lists)

---

### Phase 2: VSCode Extension Core

#### 2.1 Extension Scaffolding
**Task:** Initialize VSCode extension project
**Details:**
- Use Yeoman generator: `yo code`
- TypeScript-based
- Extension type: Custom webview panel
- Name: `vibechannel`
- Publisher setup for marketplace (later)

**Files created:**
```
vibechannel/
├── package.json
├── tsconfig.json
├── src/
│   └── extension.ts
├── .vscode/
│   └── launch.json
└── README.md
```

#### 2.2 Schema Parser
**File:** `src/schemaParser.ts`
**Purpose:** Read and parse schema.md into configuration object
**Details:**
- Read schema.md from workspace folder
- Parse YAML-like frontmatter and structured sections
- Extract: filename pattern, required fields, optional fields, rendering rules
- Return typed configuration object
- Graceful fallback to defaults if schema.md missing or malformed

**Interface:**
```typescript
interface SchemaConfig {
  filenamePattern: string;
  timestampFormat: string;
  idLength: number;
  requiredFields: FieldDef[];
  optionalFields: FieldDef[];
  rendering: {
    sortBy: string;
    order: 'ascending' | 'descending';
    groupBy?: string;
  };
}

function parseSchema(content: string): SchemaConfig;
```

#### 2.3 Message Parser
**File:** `src/messageParser.ts`
**Purpose:** Parse individual message files into structured data
**Details:**
- Read markdown file
- Extract YAML frontmatter (use `gray-matter` or similar)
- Parse body as markdown content
- Validate against schema (optional, soft validation)
- Return typed message object

**Interface:**
```typescript
interface Message {
  filename: string;
  from: string;
  date: Date;
  replyTo?: string;
  tags?: string[];
  content: string;
  rawContent: string;
}

function parseMessage(filepath: string): Message;
```

#### 2.4 Folder Watcher
**File:** `src/folderWatcher.ts`
**Purpose:** Watch conversation folder for changes
**Details:**
- Use `vscode.workspace.createFileSystemWatcher`
- Watch pattern: `**/*.md` excluding `schema.md` and `agent.md`
- Events: create, change, delete
- Debounce rapid changes
- Trigger re-render on changes

**Interface:**
```typescript
class FolderWatcher {
  constructor(folderPath: string, onChange: () => void);
  start(): void;
  stop(): void;
  dispose(): void;
}
```

#### 2.5 Conversation Loader
**File:** `src/conversationLoader.ts`
**Purpose:** Load all messages from folder into sorted array
**Details:**
- List all .md files in folder
- Filter out schema.md, agent.md
- Parse each file using messageParser
- Sort by date (or as specified in schema)
- Group by date if specified
- Return conversation structure

**Interface:**
```typescript
interface Conversation {
  schema: SchemaConfig;
  messages: Message[];
  grouped?: Map<string, Message[]>;  // If groupBy specified
}

function loadConversation(folderPath: string): Conversation;
```

---

### Phase 3: VSCode Extension UI

#### 3.1 Webview Panel Setup
**File:** `src/chatPanel.ts`
**Purpose:** Create and manage the chat webview panel
**Details:**
- Create webview panel with `vscode.window.createWebviewPanel`
- Set panel title from schema metadata or folder name
- Configure webview options (enable scripts, local resources)
- Handle panel lifecycle (dispose, reveal, etc.)

**Interface:**
```typescript
class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  public static createOrShow(folderPath: string): void;
  private constructor(panel: vscode.WebviewPanel, folderPath: string);
  public dispose(): void;
  private update(): void;
  private getHtmlForWebview(): string;
}
```

#### 3.2 Chat UI HTML/CSS
**File:** `src/webview/chat.html` (embedded or loaded)
**Purpose:** Chat interface markup and styling
**Details:**
- Clean, minimal chat bubble UI
- Sender name + timestamp header per message
- Different alignment/color for different senders (or simple linear)
- Markdown rendered content
- Responsive design
- Date separators if grouped
- Thread indicators if reply_to present

**Style decisions:**
- Light/dark theme support (respect VSCode theme)
- Minimal chrome, focus on content
- Clear visual distinction between senders
- Readable typography
- Smooth scroll behavior

#### 3.3 Message Rendering
**File:** `src/webview/messageRenderer.ts` (or embedded JS)
**Purpose:** Render messages array into HTML
**Details:**
- Convert message objects to HTML elements
- Render markdown content (use `marked` or similar)
- Format timestamps (relative or absolute, configurable)
- Handle code blocks with syntax highlighting
- Handle images, links, etc.
- Thread/reply-to visualization

**Interface:**
```typescript
function renderMessages(messages: Message[], schema: SchemaConfig): string;
function renderMessage(message: Message): string;
function renderDateSeparator(date: string): string;
```

#### 3.4 Webview-Extension Communication
**File:** Part of `src/chatPanel.ts` and webview JS
**Purpose:** Message passing between extension and webview
**Details:**
- Extension → Webview: Send conversation data, updates
- Webview → Extension: (Future) User actions like adding messages
- Use `postMessage` API
- Type-safe message contracts

**Messages:**
```typescript
// Extension → Webview
type ToWebviewMessage = 
  | { type: 'update'; conversation: Conversation }
  | { type: 'append'; message: Message };

// Webview → Extension (future)
type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'requestRefresh' };
```

---

### Phase 4: Extension Integration

#### 4.1 Activation & Commands
**File:** `src/extension.ts`
**Purpose:** Extension entry point and command registration
**Details:**

**Activation events:**
- `onCommand:vibechannel.openFolder`
- `workspaceContains:schema.md` (auto-detect)

**Commands:**
- `vibechannel.openFolder`: Open folder picker, then show chat panel
- `vibechannel.openCurrent`: Open chat for current folder (if schema.md exists)
- `vibechannel.refresh`: Force refresh the chat view

**Context menu:**
- Right-click on folder with schema.md → "Open folder as VibeChannel"

#### 4.2 Status Bar Item
**File:** Part of `src/extension.ts`
**Purpose:** Indicate when in a chat folder
**Details:**
- Show icon/text when active folder contains schema.md
- Click to open/focus chat panel
- Tooltip with conversation name

#### 4.3 Configuration Settings
**File:** `package.json` contribution points
**Purpose:** User preferences for the extension
**Details:**
```json
{
  "vibechannel.defaultTimestampFormat": "relative",
  "vibechannel.theme": "auto",
  "vibechannel.autoOpen": false,
  "vibechannel.watchForChanges": true
}
```

---

### Phase 5: Polish & Edge Cases

#### 5.1 Error Handling
**Details:**
- Missing schema.md: Use sensible defaults, show info message
- Malformed message files: Skip with warning, don't crash
- Invalid dates: Show raw string, don't crash
- Empty folder: Show empty state UI
- Permission errors: Clear error message

#### 5.2 Performance Optimization
**Details:**
- Lazy load messages for large conversations
- Virtual scrolling for 1000+ messages
- Incremental updates (don't re-render everything)
- Cache parsed messages
- Debounce file watcher events

#### 5.3 Accessibility
**Details:**
- Proper ARIA labels
- Keyboard navigation
- Screen reader friendly
- High contrast support
- Focus management

#### 5.4 Testing
**Files:** `src/test/`
**Details:**
- Unit tests for parsers
- Integration tests for conversation loading
- Sample conversation folders as fixtures
- Test various edge cases (empty, malformed, large)

---

### Phase 6: Documentation & Distribution

#### 6.1 README.md
**Details:**
- What is VibeChannel (concept)
- Quick start guide
- Schema reference
- Agent integration guide
- Screenshots/GIFs
- Troubleshooting

#### 6.2 Example Conversations
**Details:**
- Create 2-3 example conversation folders
- Different use cases (project discussion, Q&A, notes)
- Include in repo as examples/

#### 6.3 VSCode Marketplace
**Details:**
- Create publisher account
- Package extension: `vsce package`
- Publish: `vsce publish`
- Marketplace listing with images, description

---

## Part 5: File Specifications

### 5.1 Complete schema.md Template

```markdown
# VibeChannel Schema

This file defines the format for this VibeChannel conversation.

## Metadata

```yaml
name: My Conversation
description: A discussion about interesting topics
created: 2025-01-15T10:00:00Z
version: 1.0
```

## Filename Convention

Messages are stored as individual markdown files with this naming pattern:

```yaml
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
```

Full example: `20250115T103045-lucas-a3f8x2.md`

## Message Format

Each message file contains YAML frontmatter and markdown content.

### Required Fields

```yaml
from: string        # Sender identifier (should match filename)
date: datetime      # ISO 8601 format (e.g., 2025-01-15T10:30:45Z)
```

### Optional Fields

```yaml
reply_to: string    # Filename of parent message for threading
tags: [array]       # Categorization tags
edited: datetime    # Last edit timestamp
```

### Example Message

```markdown
---
from: lucas
date: 2025-01-15T10:30:45Z
tags: [idea, discussion]
---

Here is my message content with **markdown** support.
```

## Rendering Preferences

```yaml
rendering:
  sort_by: date
  order: ascending
  group_by: date          # Group messages by day
  timestamp_display: relative  # "relative" or "absolute"
```

## Participants (Informational)

```yaml
participants:
  - name: lucas
    display_name: Lucas
  - name: alice
    display_name: Alice
  - name: bob
    display_name: Bob
```
```

### 5.2 Complete agent.md Template

```markdown
# Agent Instructions for VibeChannel

This folder contains a conversation following the VibeChannel protocol.

**IMPORTANT:** Read `schema.md` for the complete format specification. This file
provides instructions for AI agents to correctly create messages.

## Overview

- Each message is a separate `.md` file
- Filenames encode timestamp, sender, and unique ID
- Content uses YAML frontmatter + markdown body
- See `schema.md` for exact format requirements

## Creating a Message

### Critical Rules

1. **NEVER** guess or hallucinate the timestamp
2. **NEVER** guess or hallucinate the sender name  
3. **ALWAYS** use bash commands to get accurate data
4. **ALWAYS** generate a fresh unique ID per message

### Step-by-Step Process

#### Step 1: Get Current Timestamp

```bash
date +%Y%m%dT%H%M%S
```

Expected output format: `20250115T103045`

This is used in the filename. Store this value.

#### Step 2: Get ISO Timestamp for Frontmatter

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

Expected output format: `2025-01-15T10:30:45Z`

This is used in the `date` field of frontmatter. Store this value.

#### Step 3: Get Sender Name

```bash
git config user.name
```

Then normalize it:
```bash
git config user.name | tr '[:upper:]' '[:lower:]' | tr -d ' ' | tr -cd 'a-z0-9'
```

If git config is not set or returns empty, **ask the user** for their name.
Do NOT make up a name.

#### Step 4: Generate Unique ID

```bash
cat /dev/urandom | tr -dc 'a-z0-9' | head -c 6
```

Expected output: 6 random alphanumeric characters like `a3f8x2`

Generate a fresh ID for EVERY message. Never reuse IDs.

#### Step 5: Construct Filename

Pattern: `{timestamp}-{sender}-{id}.md`

Example: `20250115T103045-lucas-a3f8x2.md`

#### Step 6: Write Message File

Create the file with this structure:

```markdown
---
from: {sender}
date: {iso_timestamp}
---

{message content here}
```

### Complete Example Script

```bash
#!/bin/bash

# Step 1 & 2: Get timestamps
FILE_TIMESTAMP=$(date +%Y%m%dT%H%M%S)
ISO_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Step 3: Get sender
SENDER=$(git config user.name | tr '[:upper:]' '[:lower:]' | tr -d ' ' | tr -cd 'a-z0-9')

# Step 4: Generate ID
UNIQUE_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 6)

# Step 5: Construct filename
FILENAME="${FILE_TIMESTAMP}-${SENDER}-${UNIQUE_ID}.md"

# Step 6: Write file (example content)
cat > "$FILENAME" << EOF
---
from: ${SENDER}
date: ${ISO_TIMESTAMP}
---

Your message content here.
EOF

echo "Created: $FILENAME"
```

### Example Output

Filename: `20250115T103045-lucas-a3f8x2.md`

Content:
```markdown
---
from: lucas
date: 2025-01-15T10:30:45Z
---

This is the message content. It supports **markdown** formatting.

- Lists work
- Code blocks work

Everything markdown supports is allowed.
```

## Reading the Conversation

To understand conversation context before responding:

1. List message files:
   ```bash
   ls -1 *.md | grep -v -E '^(schema|agent)\.md$' | sort
   ```

2. Files are sorted chronologically by filename

3. Read recent messages to understand context

4. Check `reply_to` fields for threading relationships

## Threading (Optional)

To reply to a specific message, include the `reply_to` field:

```markdown
---
from: alice
date: 2025-01-15T10:35:00Z
reply_to: 20250115T103045-lucas-a3f8x2.md
---

This is a reply to Lucas's message.
```

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Correct Approach |
|---------|---------------|------------------|
| Using `2025-01-15` as timestamp | Wrong format, missing time | Use `date +%Y%m%dT%H%M%S` |
| Guessing user is "User" or "Human" | Inaccurate attribution | Use `git config user.name` |
| Reusing a previous message's ID | Causes filename collision | Generate fresh ID each time |
| Using local time in frontmatter | Timezone ambiguity | Use UTC with `date -u` |
| Putting timestamp in wrong format | Inconsistent data | File: `YYYYMMDDTHHMMSS`, Frontmatter: ISO 8601 |

## File Listing Reference

```
my-vibechannel/
├── schema.md                    # DO NOT MODIFY - format definition
├── agent.md                     # This file - your instructions
├── 20250115T103045-lucas-a3f8x2.md    # Message files...
├── 20250115T103215-alice-k9m2p7.md
└── ...
```

Only create new message files. Do not modify `schema.md` or `agent.md` unless
explicitly asked to do so.
```

---

## Part 6: Summary

### What We're Building

**VibeChannel** — A minimal system where:
1. A folder of markdown files IS a conversation
2. Each file IS a message (atomic, git-friendly)
3. schema.md defines the format (single source of truth)
4. agent.md tells AI agents how to participate correctly
5. A VSCode extension renders the folder as a chat UI

### What Makes It Different

| Traditional Chat | VibeChannel |
|-----------------|---------------|
| Server required | Just files |
| Database storage | Filesystem storage |
| Proprietary format | Plain markdown |
| Complex sync | Git handles it |
| Platform lock-in | Copy folder anywhere |
| Auth/user management | None needed |
| API integrations | Agents read files |

### Core Principles

1. **Minimal**: No validation, no consistency checks, no server
2. **Self-contained**: Folder is complete and portable
3. **DRY**: Schema defined once, referenced elsewhere
4. **Tool-friendly**: Agents use bash for accurate data
5. **Git-native**: Every message is a diffable file

### Success Criteria

- [ ] Can create conversation folder with schema.md + agent.md
- [ ] AI agents can read agent.md and create correct messages
- [ ] VSCode extension renders folder as chat UI
- [ ] Live updates when files change
- [ ] Works with any number of participants
- [ ] Folder can be copied/cloned and works anywhere