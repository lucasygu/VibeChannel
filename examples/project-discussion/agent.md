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
