# VibeChannel

**Team chat for the vibe coding era.**
Conversations live in your repo, readable by AI, owned by you.

---

## The Problem

Your team discussions are scattered:
- **Slack/Discord** — siloed, unsearchable by AI, vendor-locked
- **GitHub Issues** — too formal for quick brainstorming
- **Meetings** — synchronous, no persistent record

Meanwhile, AI coding assistants can read your code, your docs, your README — but not your team's thinking process.

## The Solution

VibeChannel turns a folder of markdown files into a chat interface. Every message is a file. Every channel is a folder. Every conversation is git history.

```
feature-discussion/
├── schema.md
├── agent.md
├── 20250115T103045-alice-a3f8c2.md
├── 20250115T104512-bob-k9m2p7.md
└── 20250115T110823-claude-x7n4q1.md  ← AI can participate too
```

Your AI assistant can now read the brainstorm, understand the context, and contribute — because it's just markdown.

---

## Features

### Chat UI in Your Editor
A familiar Slack-like interface, but the data is just files in your repo.

### Git-Native Sync
Push and pull conversations like code. Branch discussions. Merge ideas.

### AI-Friendly by Design
- Every message is markdown (LLMs read it natively)
- `agent.md` tells AI how to participate
- `schema.md` documents the format

### Real-Time Updates
File watcher detects changes instantly — no refresh needed.

### GitHub Authentication
One-click sign in using VS Code's built-in GitHub auth.

### Threads & Tags
Reply to messages with `reply_to`. Organize with tags like `[idea, urgent, bug]`.

### Multi-Channel Support
Create multiple channels as subfolders. Switch between them in the sidebar.

### Cross-Platform
Works in VS Code, Cursor, and other VS Code-based editors. iOS app available for mobile access.

---

## Quick Start

1. **Install** the extension from the marketplace
2. **Open** a git repository in VS Code
3. **Run** `VibeChannel: Open VibeChannel` from the command palette
4. **Sign in** with GitHub when prompted
5. **Create** a channel and start chatting

Your messages are saved as markdown files and synced via git.

---

## Why This Matters

### For Vibe Coders
Your AI assistant can now read team discussions, not just code. Context flows from brainstorm → spec → implementation — all in one repo.

### For Async Teams
No "typing..." indicators. No presence anxiety. Thoughtful, permanent messages that respect everyone's time.

### For Startups
One less SaaS subscription. Conversations in git = free forever, fully owned, no vendor lock-in.

### For Open Source
Discussions live with the code. Contributors can see the "why" behind decisions.

---

## The Three-Layer Stack

| Layer | Purpose | Tool |
|-------|---------|------|
| **1. Quick chat** | Messy brainstorming | **VibeChannel** |
| **2. Structured planning** | Issues, specs, docs | GitHub Issues |
| **3. Implementation** | Actual code | Your IDE |

VibeChannel is Layer 1 — the fast, informal discussions that happen *before* things are ready for an issue.

---

## Message Format

**Filename:** `{YYYYMMDDTHHMMSS}-{sender}-{6-char-id}.md`

```markdown
---
from: alice
date: 2025-01-15T10:30:45Z
reply_to: 20250115T103045-bob-k9m2p7.md
tags: [idea, backend]
---

What if we used markdown files for everything?
```

**Why this works:**
- Filenames sort chronologically with `ls`
- Sender visible without opening the file
- Git handles conflicts automatically
- Any tool can read/write these files

---

## Commands

| Command | Description |
|---------|-------------|
| `VibeChannel: Open VibeChannel` | Open chat panel for current repo |
| `VibeChannel: Refresh Chat View` | Force refresh the view |
| `VibeChannel: Sign In with GitHub` | Authenticate with GitHub |
| `VibeChannel: Sign Out from GitHub` | Sign out |
| `VibeChannel: Show GitHub Account` | View current account |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `vibechannel.timestampDisplay` | `relative` | Show relative (`5m ago`) or absolute timestamps |
| `vibechannel.watchForChanges` | `true` | Auto-refresh when files change |
| `vibechannel.syncInterval` | `10` | Seconds between remote sync checks |
| `vibechannel.autoPush` | `true` | Auto-push after sending a message |
| `vibechannel.autoOpen` | `false` | Auto-open panel when opening a VibeChannel folder |

---

## Philosophy

> "There's a new kind of coding I call 'vibe coding', where you fully give in to the vibes, embrace exponentials, and forget that the code even exists."
> — Andrej Karpathy

VibeChannel extends this philosophy to team communication:

- **Markdown is the protocol** — no proprietary formats
- **Git is the backend** — no servers needed
- **Files are the API** — any tool can read/write
- **AI is a first-class participant** — not an afterthought

---

## Links

- [GitHub Repository](https://github.com/lucasygu/VibeChannel)
- [Report Issues](https://github.com/lucasygu/VibeChannel/issues)
- [iOS App](https://github.com/lucasygu/VibeChannel/tree/master/iOS) (coming soon)

---

**Local-first. AI-native. Vibe coding ready.**
