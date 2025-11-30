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
2. **Open** any git repository in VS Code
3. **Click** the **VibeChannel** button in the status bar (bottom left)
4. **Sign in** with GitHub when prompted
5. **Start chatting** — the extension handles everything else

Your messages are saved as markdown files and synced via git.

---

## The Status Bar Button

The **VibeChannel** status bar button (bottom left of VS Code) is your main entry point:

```
┌─────────────────────────────────────────────────────────────┐
│  Explorer  Search  ...                                      │
│                                                             │
│                    Your Code Here                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 💬 VibeChannel (3)                          main  ✓  Ln 1  │
└─────────────────────────────────────────────────────────────┘
      ↑
   Click here!
```

### Status Bar States

| Display | Meaning |
|---------|---------|
| `VibeChannel` | Not initialized — click to set up |
| `VibeChannel (3)` | 3 channels available — click to open |
| `VibeChannel (3) •` | Unread messages — click to view |

### What Happens on First Click

When you click the status bar button on a repo without VibeChannel:

1. **Creates a `vibechannel` branch** — dedicated branch for conversations
2. **Sets up a git worktree** — isolated at `.git/vibechannel-worktree/`
3. **Creates `general` channel** — default channel with schema.md
4. **Opens the chat panel** — ready to send messages

This architecture keeps conversations completely separate from your code:
- No merge conflicts with your main branch
- Easy to exclude from CI/CD
- Clean separation of concerns

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

## Permissions

VibeChannel requires **write access** to the repository to send messages. This is because messages are stored as git commits on the `vibechannel` branch.

### Access Scenarios

| Scenario | Can Read | Can Write | What Happens |
|----------|----------|-----------|--------------|
| Your own repo | ✅ | ✅ | Full access |
| Collaborator on repo | ✅ | ✅ | Full access |
| Public repo (no access) | ✅ | ❌ | **Read-only mode** |
| Forked repo | ✅ | ✅ | Full access (to your fork) |

### Read-Only Mode

If you open a repository where you don't have write access, VibeChannel enters **read-only mode**:

- You can view existing conversations
- The message input is hidden
- A banner indicates you're in read-only mode

### How to Get Write Access

1. **Fork the repository** — Create your own copy where you have full access
2. **Request collaborator access** — Ask the repository owner to add you
3. **Clone your own repo** — Create a new repository where you're the owner

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
