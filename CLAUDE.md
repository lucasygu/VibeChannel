# CLAUDE.md - VibeChannel Project Guide

## Project Overview

**VibeChannel** is a filesystem-based conversation protocol where a folder of markdown files renders as a chat interface. Each message is an atomic markdown file, making conversations git-friendly, portable, and decentralized.

## Important: Xcode Build Policy

**DO NOT attempt to build the Xcode project.** The user will build it themselves. This includes:
- Do not run `xcodebuild`
- Do not run `swift build` for the iOS project
- Do not attempt to open Xcode via command line to build
- Only create/edit Swift source files - the user handles building and running

## Architecture

```
VibeChannel/
├── .github/workflows/publish.yml   # Auto-publish on git tags
├── docs/init.md                    # Original specification
├── examples/project-discussion/    # Example conversation folder
│   ├── schema.md                   # Format definition
│   ├── agent.md                    # AI agent instructions
│   └── *.md                        # Message files
├── extension/                      # VSCode extension
│   ├── src/
│   │   ├── extension.ts            # Entry point, commands, activation
│   │   ├── chatPanel.ts            # Webview UI rendering
│   │   ├── schemaParser.ts         # Parse schema.md
│   │   ├── messageParser.ts        # Parse message files
│   │   ├── conversationLoader.ts   # Load full conversation
│   │   ├── folderWatcher.ts        # Watch for file changes
│   │   └── githubAuth.ts           # GitHub authentication
│   ├── package.json
│   └── .env.local                  # Local secrets (git-ignored)
└── iOS/                            # iOS app (user builds manually)
    └── VibeChannel/
        ├── Models/                 # Data models
        ├── Services/               # API, Auth, Sync services
        ├── Views/                  # SwiftUI views
        ├── Utilities/              # Keychain, helpers
        ├── Secrets.swift           # OAuth credentials (git-ignored)
        └── Secrets.swift.template  # Template for credentials
```

## Message File Format

**Filename:** `{YYYYMMDDTHHMMSS}-{sender}-{6-char-id}.md`

```markdown
---
from: username
date: 2025-01-15T10:30:45Z
reply_to: optional-filename.md  # optional
tags: [optional, tags]          # optional
---

Message content in **markdown**.
```

## Key Commands

### Development
```bash
cd extension
npm install
npm run compile
npm run watch           # Watch mode for development
```

### Testing Locally
```bash
# Package extension
npx @vscode/vsce package --allow-missing-repository

# Install in Cursor/VSCode
cursor --install-extension vibechannel-0.1.0.vsix
```

### Publishing
```bash
# Option 1: Tag-based (triggers GitHub Actions)
git tag v0.2.0
git push origin v0.2.0

# Option 2: Manual publish
source .env.local && npx @vscode/vsce publish -p $VSCE_PAT
```

## Extension Commands

| Command | Description |
|---------|-------------|
| `VibeChannel: Open Folder as VibeChannel` | Open folder picker |
| `VibeChannel: Open Current Folder as Chat` | Open workspace as chat |
| `VibeChannel: Sign In with GitHub` | Authenticate with GitHub |
| `VibeChannel: Sign Out from GitHub` | Sign out |
| `VibeChannel: Refresh Chat View` | Force refresh |

## GitHub Authentication

Uses VSCode's built-in authentication API - no OAuth app needed:

```typescript
const session = await vscode.authentication.getSession(
  'github',
  ['read:user'],
  { createIfNone: true }
);
```

## Publishing Setup

### Marketplace Publisher
- **Publisher ID:** `lucasygu`
- **Extension ID:** `lucasygu.vibechannel`
- **Marketplace URL:** https://marketplace.visualstudio.com/items?itemName=lucasygu.vibechannel
- **Publisher Hub:** https://marketplace.visualstudio.com/manage/publishers/lucasygu

### Secrets
- `VSCE_PAT` - Azure DevOps Personal Access Token (Marketplace:Manage scope)
- Stored in: GitHub Secrets + `extension/.env.local`

### CI/CD Flow
1. Push tag `v*` → triggers `.github/workflows/publish.yml`
2. Builds and packages extension
3. Publishes to VS Marketplace
4. Uploads `.vsix` as artifact

## How to Publish a New Version

### Option 1: Automated (Recommended)
```bash
cd extension

# Bump version (choose one)
npm version patch   # 0.1.0 → 0.1.1 (bug fixes)
npm version minor   # 0.1.0 → 0.2.0 (new features)
npm version major   # 0.1.0 → 1.0.0 (breaking changes)

# Commit and push
git add package.json package-lock.json
git commit -m "Bump version to $(node -p "require('./package.json').version")"
git push origin master

# Create and push tag (triggers GitHub Actions)
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

### Option 2: Manual Publish
```bash
cd extension
source .env.local
npx @vscode/vsce publish -p $VSCE_PAT
```

### Option 3: GitHub UI Manual Trigger
1. Go to https://github.com/lucasygu/VibeChannel/actions
2. Click "Publish Extension" workflow
3. Click "Run workflow"
4. Select version bump type (patch/minor/major)
5. Click "Run workflow"

### First-Time Setup (Already Done)
1. Create publisher at https://marketplace.visualstudio.com/manage
2. Generate PAT at https://dev.azure.com (Marketplace → Manage scope)
3. Add `VSCE_PAT` to GitHub Secrets
4. Add PAT to `extension/.env.local` for local publishing

### Verify Publication
- **Instant:** Check Publisher Hub for status
- **5-10 mins:** Direct extension URL works
- **15-30 mins:** Appears in marketplace search

## Critical Insights

### Schema Design
- `schema.md` is the single source of truth for format
- `agent.md` provides instructions for AI agents to create messages
- Extension reads schema but doesn't enforce it (minimal validation)

### File Watcher
- Uses `vscode.workspace.createFileSystemWatcher`
- Debounced (300ms) to handle rapid changes
- Filters out `schema.md`, `agent.md`, `README.md`

### Webview Security
- CSP: `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https:`
- Communication via `postMessage` API

### Message Creation
- Timestamp: `crypto` for random ID, `Date` for timestamps
- Sender: GitHub username (lowercase)
- File written synchronously, watcher picks up change

## Version History

- **v0.1.0** - Initial release
  - Chat UI with message rendering
  - GitHub authentication
  - Message input and sending
  - Live file watching
  - Markdown rendering with syntax highlighting

## Useful Links

- [VS Marketplace Publisher Hub](https://marketplace.visualstudio.com/manage/publishers/lucasygu)
- [GitHub Repository](https://github.com/lucasygu/VibeChannel)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [vsce CLI](https://github.com/microsoft/vscode-vsce)
