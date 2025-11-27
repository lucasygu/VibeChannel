# Agent Instructions for VibeChannel

This folder contains conversations following the VibeChannel protocol.

**IMPORTANT:** Read `schema.md` for the complete format specification. This file
provides instructions for AI agents to correctly create messages.

## Overview

- Each channel is a subfolder inside `.vibechannel/`
- Each message is a separate `.md` file inside a channel
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

#### Step 2: Get ISO Timestamp for Frontmatter

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

Expected output format: `2025-01-15T10:30:45Z`

#### Step 3: Get Sender Name

```bash
git config user.name | tr '[:upper:]' '[:lower:]' | tr -d ' ' | tr -cd 'a-z0-9'
```

#### Step 4: Generate Unique ID

```bash
cat /dev/urandom | tr -dc 'a-z0-9' | head -c 6
```

#### Step 5: Construct Filename

Pattern: `{timestamp}-{sender}-{id}.md`

Example: `20250115T103045-lucas-a3f8x2.md`

#### Step 6: Write Message File

Create the file in the appropriate channel folder:

```markdown
---
from: {sender}
date: {iso_timestamp}
---

{message content here}
```

## File Structure

```
.vibechannel/
├── agent.md                         # This file
├── schema.md                        # Format definition
├── general/                         # Default channel
│   └── *.md                         # Messages
├── random/                          # Another channel
└── dev-chat/                        # Another channel
```
