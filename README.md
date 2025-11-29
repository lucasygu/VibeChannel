# VibeChannel

**Team chat for the vibe coding era.**
Conversations live in your repo, readable by AI, owned by you.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lucasygu.vibechannel?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=lucasygu.vibechannel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is VibeChannel?

VibeChannel turns a folder of markdown files into a Slack-like chat interface. Every message is a file. Every channel is a folder. Every conversation is git history.

```
my-project/
├── .git/vibechannel-worktree/
│   ├── general/
│   │   ├── schema.md
│   │   ├── 20250115T103045-alice-a3f8c2.md
│   │   └── 20250115T104512-bob-k9m2p7.md
│   └── feature-ideas/
│       ├── schema.md
│       └── 20250115T110823-claude-x7n4q1.md
└── src/
    └── ... your code
```

Your AI assistant can now read team discussions — because it's just markdown.

---

## Why?

### The Problem

In the vibe coding era, AI can read your code, docs, and README. But team discussions live in Slack — siloed, unsearchable by AI, vendor-locked.

### The Solution

Put conversations in markdown files, in your repo:

| What | Where | AI Access |
|------|-------|-----------|
| Code | Git repo | Full |
| Docs | Git repo | Full |
| **Discussions** | **Slack** | **None** |

**After VibeChannel:**

| What | Where | AI Access |
|------|-------|-----------|
| Code | Git repo | Full |
| Docs | Git repo | Full |
| **Discussions** | **Git repo** | **Full** |

---

## The Three-Layer Stack

| Layer | Purpose | Tool |
|-------|---------|------|
| **1. Quick chat** | Messy brainstorming | **VibeChannel** |
| **2. Structured planning** | Issues, specs, docs | GitHub Issues |
| **3. Implementation** | Actual code | Your IDE |

VibeChannel is Layer 1 — the fast, informal discussions that happen *before* things are ready for an issue.

---

## Installation

### VS Code / Cursor

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucasygu.vibechannel):

```bash
# Or install via command line
code --install-extension lucasygu.vibechannel
```

### iOS (Coming Soon)

Native iOS app for mobile access. Uses GitHub API directly — no backend server.

---

## Quick Start

1. **Install** the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucasygu.vibechannel)
2. **Open** any git repository in VS Code
3. **Click** the `VibeChannel` button in the status bar (bottom left)
4. **Sign in** with GitHub when prompted
5. **Start chatting** — the extension handles everything else

Messages sync via git push/pull automatically.

### The Status Bar Button

Look for **$(comment-discussion) VibeChannel** in your VS Code status bar (bottom left). This is your main entry point:

| Status Bar State | Meaning |
|-----------------|---------|
| `VibeChannel` | Click to initialize — sets up the `vibechannel` branch and git worktree |
| `VibeChannel (3)` | Initialized with 3 channels — click to open chat panel |
| `VibeChannel (3) •` | New unread messages — click to view |

**First click on a new repo:**
- Creates a dedicated `vibechannel` git branch
- Sets up an isolated worktree at `.git/vibechannel-worktree/`
- Creates a default `general` channel
- Opens the chat panel

This keeps conversations completely separate from your code — no merge conflicts, no clutter in your main branch.

---

## Features

- **Chat UI** — Slack-like interface in your editor
- **Git sync** — Push/pull conversations like code
- **Real-time updates** — File watcher detects changes instantly
- **GitHub auth** — One-click sign in via VS Code
- **Threads** — Reply to any message
- **Tags** — Organize with `[idea, urgent, bug]`
- **Multi-channel** — Separate folders for different topics
- **AI-ready** — `agent.md` tells AI how to participate

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

**Why this design:**
- `ls` shows messages in chronological order
- Sender visible without opening the file
- 6-char random ID = no coordination needed
- Git handles merge conflicts automatically

---

## Project Structure

```
VibeChannel/
├── extension/          # VS Code extension
│   ├── src/
│   │   ├── extension.ts        # Entry point
│   │   ├── chatPanel.ts        # Webview UI
│   │   ├── messageParser.ts    # Parse message files
│   │   ├── gitService.ts       # Git worktree management
│   │   └── syncService.ts      # Push/pull queue
│   └── package.json
├── iOS/                # iOS app (SwiftUI)
│   └── VibeChannel/
│       ├── Views/
│       ├── Models/
│       └── Services/
├── docs/               # Protocol specification
│   └── init.md
└── web/                # Landing page
```

---

## How It Works

### Git Worktree Architecture

VibeChannel stores conversations in a separate git worktree, keeping them isolated from your main codebase:

```
.git/vibechannel-worktree/
├── general/
├── random/
└── feature-discussion/
```

This means:
- Conversations don't clutter your main branch
- You can have different conversation branches
- Easy to exclude from CI/CD if needed

### Zero Backend

Both VS Code and iOS clients talk directly to Git/GitHub:
- VS Code: Local git commands + GitHub API
- iOS: GitHub REST API only

No server. No database. $0 infrastructure.

---

## Philosophy

> "There's a new kind of coding I call 'vibe coding', where you fully give in to the vibes, embrace exponentials, and forget that the code even exists."
> — Andrej Karpathy

VibeChannel extends this to team communication:

- **Markdown is the protocol** — No proprietary formats
- **Git is the backend** — No servers needed
- **Files are the API** — Any tool can read/write
- **AI is a first-class participant** — Not an afterthought

---

## Development

### Extension

```bash
cd extension
npm install
npm run compile
npm run watch  # Development mode
```

### Package for Testing

```bash
npx @vscode/vsce package --allow-missing-repository
code --install-extension vibechannel-*.vsix
```

### Publish

```bash
# Via git tag (triggers GitHub Actions)
npm version patch
git push origin master --tags

# Or manually
source .env.local
npx @vscode/vsce publish -p $VSCE_PAT
```

See [CLAUDE.md](./CLAUDE.md) for detailed development instructions.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## License

MIT

---

## Links

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucasygu.vibechannel)
- [Report Issues](https://github.com/lucasygu/VibeChannel/issues)
- [Protocol Specification](./docs/init.md)

---

**Local-first. AI-native. Vibe coding ready.**
