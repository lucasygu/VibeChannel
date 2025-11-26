# VibeChannel Schema

This file defines the format for this VibeChannel conversation.

## Metadata

```yaml
name: Project Discussion
description: Technical decisions for the widget project
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
