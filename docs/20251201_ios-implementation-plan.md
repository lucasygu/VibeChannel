# iOS App Implementation Plan

**Date:** 2025-12-01
**Status:** Planning
**Priority:** High

## Executive Summary

This document outlines the implementation plan for bringing the iOS VibeChannel app to feature parity with the VS Code extension (v0.6.17), while also implementing a robust caching layer for performance.

---

## Phase 0: SwiftData Cache Layer (Foundation)

### Problem Statement

Current architecture fetches all data from GitHub API on every interaction:
- Slow initial load (network latency)
- Laggy channel/message switching
- No offline viewing capability
- Redundant API calls waste rate limit quota

### Proposed Architecture: Remote-First with Local Cache

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS App                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   SwiftUI   │───▶│  ViewModel  │───▶│   Views     │         │
│  │   Views     │    │   Layer     │    │  (Cached)   │         │
│  └─────────────┘    └──────┬──────┘    └─────────────┘         │
│                            │                                     │
│                     ┌──────▼──────┐                             │
│                     │  Repository │  ◀── Single source of truth │
│                     │   Pattern   │                             │
│                     └──────┬──────┘                             │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  SwiftData  │    │    Sync     │    │   GitHub    │         │
│  │   Cache     │◀───│   Engine    │───▶│    API      │         │
│  │  (Local)    │    │             │    │  (Remote)   │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **Remote-First Writes**: All create/update/delete operations go directly to GitHub API
2. **Local-First Reads**: UI always reads from SwiftData cache for instant response
3. **Unidirectional Sync**: Remote → Local only (no bidirectional sync complexity)
4. **Timestamp-Based Invalidation**: Smart refresh based on `lastSyncedAt` vs remote commit timestamp
5. **Eventual Consistency**: Accept brief staleness for UI responsiveness

### SwiftData Models

```swift
// Cached repository metadata
@Model
class CachedRepository {
    @Attribute(.unique) var id: String           // "owner/repo"
    var owner: String
    var name: String
    var lastSyncedAt: Date?
    var lastRemoteCommitSHA: String?             // For change detection
    var lastRemoteCommitDate: Date?

    @Relationship(deleteRule: .cascade)
    var channels: [CachedChannel] = []
}

// Cached channel
@Model
class CachedChannel {
    @Attribute(.unique) var id: String           // "owner/repo/channelName"
    var name: String
    var lastSyncedAt: Date?
    var unreadCount: Int = 0
    var lastReadMessageId: String?

    @Relationship(deleteRule: .cascade)
    var messages: [CachedMessage] = []

    var repository: CachedRepository?
}

// Cached message
@Model
class CachedMessage {
    @Attribute(.unique) var id: String           // filename without .md
    var filename: String
    var from: String
    var date: Date
    var replyTo: String?
    var tags: [String]?
    var edited: Date?
    var content: String
    var rawContent: String
    var sha: String?                             // For edit/delete operations

    // Attachment metadata (paths only, not content)
    var files: [String]?
    var images: [String]?
    var attachments: [String]?

    var channel: CachedChannel?
}
```

### Sync Strategy

#### Initial Load (Cold Start)
```
1. Check SwiftData for cached data
2. If cache exists and < 5 min old → Show cached, background refresh
3. If cache stale or empty → Show loading, fetch from API
4. Store fetched data in SwiftData
5. Update lastSyncedAt timestamp
```

#### Incremental Sync (Polling)
```
1. GET /repos/{owner}/{repo}/commits?per_page=1&sha=vibechannel
   - Use If-None-Match with stored ETag

2. If 304 Not Modified → Cache is current, skip
3. If 200 → Compare commit SHA with lastRemoteCommitSHA
   - If same → Skip (ETag race condition)
   - If different → Fetch changed files only

4. Update cache with new/modified messages
5. Update lastRemoteCommitSHA and lastSyncedAt
```

#### Write-Through Pattern
```
1. User creates/edits/deletes message
2. Immediately call GitHub API (PUT/DELETE)
3. On success:
   - Update local SwiftData cache
   - Update UI (already reflects change)
4. On failure:
   - Show error
   - Revert optimistic UI update if applicable
```

### Cache Invalidation Rules

| Trigger | Action |
|---------|--------|
| App launch | Background refresh if cache > 1 min |
| Pull-to-refresh | Force full refresh |
| Channel switch | Check channel's lastSyncedAt |
| Polling interval (10s) | ETag-based check |
| Message sent | Update local cache immediately |
| App foreground | Resume polling, check staleness |

### Performance Optimizations

1. **Lazy Loading**: Only fetch message content when channel is selected
2. **Pagination**: Limit initial fetch to last 100 messages per channel
3. **Image Caching**: Use `AsyncImage` with custom `URLCache`
4. **Debounced Sync**: Batch rapid changes before API calls
5. **Background Fetch**: Use `BGAppRefreshTask` for silent updates

### Migration Path

```
Phase 0a: Add SwiftData models (no behavior change)
Phase 0b: Implement Repository pattern as abstraction
Phase 0c: Wire up cache reads (UI still triggers API)
Phase 0d: Implement write-through for sends
Phase 0e: Add background sync engine
Phase 0f: Remove direct API calls from ViewModels
```

---

## Phase 1: Reply System

### Current State
- `replyTo` field parsed from frontmatter ✓
- Reply icon shown in message header ✓
- No reply preview content ✗
- No way to create replies ✗
- No tap to scroll to parent ✗

### Implementation Plan

#### 1.1 Reply Preview in MessageBubble

**File:** `Views/MessageBubble.swift`

```swift
// Add reply preview above message content
struct ReplyPreview: View {
    let parentMessage: Message?
    let replyToFilename: String
    let onTap: () -> Void

    var body: some View {
        if let parent = parentMessage {
            HStack(spacing: 4) {
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: 2)

                VStack(alignment: .leading, spacing: 2) {
                    Text(parent.from)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)

                    Text(truncatedContent(parent.content))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 8)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(4)
            .onTapGesture(perform: onTap)
        } else {
            // Deleted message fallback
            Text("↩ [deleted message]")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func truncatedContent(_ content: String) -> String {
        let plain = content
            .replacingOccurrences(of: "```[\\s\\S]*?```", with: "[code]", options: .regularExpression)
            .replacingOccurrences(of: "`[^`]+`", with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "\\*\\*([^*]+)\\*\\*", with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespaces)

        return plain.count > 60 ? String(plain.prefix(60)) + "..." : plain
    }
}
```

#### 1.2 Reply Creation

**File:** `Views/MessageInput.swift`

Add reply state:
```swift
struct MessageInput: View {
    @Binding var text: String
    @Binding var replyingTo: Message?  // NEW
    let channelName: String
    var isFocused: FocusState<Bool>.Binding
    let onSend: () -> Void
    let onCancelReply: () -> Void      // NEW

    var body: some View {
        VStack(spacing: 0) {
            // Reply bar (when replying)
            if let replyTo = replyingTo {
                HStack {
                    Text("↩ Replying to \(replyTo.from)")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Spacer()

                    Button(action: onCancelReply) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color.secondary.opacity(0.1))
            }

            // Existing input field...
        }
    }
}
```

#### 1.3 Scroll to Parent Message

**File:** `Views/ChatView.swift`

```swift
// Add scroll proxy action
.onTapGesture {
    if let parentId = message.replyTo?.replacingOccurrences(of: ".md", with: "") {
        withAnimation {
            proxy.scrollTo(parentId, anchor: .center)
        }
        // Flash highlight
        highlightedMessageId = parentId
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            highlightedMessageId = nil
        }
    }
}
```

#### 1.4 Update MessageParser

**File:** `Services/MessageParser.swift`

Already handles `reply_to` parsing. Update `generateMessageContent`:
```swift
static func generateMessageContent(
    from: String,
    content: String,
    replyTo: String? = nil,  // Already exists
    tags: [String]? = nil
) -> String {
    // Already implemented correctly
}
```

#### 1.5 Update SyncService

**File:** `Services/SyncService.swift`

```swift
func sendMessage(
    owner: String,
    repo: String,
    channel: String,
    content: String,
    from: String,
    replyTo: String? = nil  // ADD parameter
) async throws -> Message {
    let fileContent = MessageParser.generateMessageContent(
        from: from,
        content: content,
        replyTo: replyTo  // Pass through
    )
    // ... rest unchanged
}
```

---

## Phase 2: Markdown Rendering

### Current State
```swift
// MessageBubble.swift line 59
Text(message.content)  // Raw text, no markdown
```

### Options Analysis

| Option | Pros | Cons |
|--------|------|------|
| **AttributedString (iOS 15+)** | Native, lightweight | Limited markdown support |
| **swift-markdown** | Apple official | Requires AST → AttributedString conversion |
| **MarkdownUI** | Full CommonMark, SwiftUI native | Third-party dependency |
| **Down** | Fast cmark wrapper | UIKit-based, needs bridging |

### Recommended: MarkdownUI

- Full CommonMark + GFM support
- Native SwiftUI component
- Code syntax highlighting
- Theming support
- Active maintenance

**Installation:**
```swift
// Package.swift or Xcode SPM
.package(url: "https://github.com/gonzalezreal/swift-markdown-ui", from: "2.0.0")
```

### Implementation

**File:** `Views/MessageBubble.swift`

```swift
import MarkdownUI

struct MessageBubble: View {
    let message: Message

    var body: some View {
        // ... existing header code ...

        // Replace Text(message.content) with:
        Markdown(message.content)
            .markdownTheme(.vibeChannel)  // Custom theme
            .textSelection(.enabled)

        // ... rest of view ...
    }
}

// Custom theme matching VS Code extension colors
extension MarkdownUI.Theme {
    static let vibeChannel = Theme()
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.85))
            BackgroundColor(Color(.secondarySystemBackground))
        }
        .codeBlock { configuration in
            configuration.label
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
        }
        .link {
            ForegroundColor(.accentColor)
        }
}
```

---

## Phase 3: Message Actions

### Current State
- No context menu on messages
- No edit capability
- No delete capability
- Text selection only

### Implementation Plan

#### 3.1 Context Menu

**File:** `Views/MessageBubble.swift`

```swift
struct MessageBubble: View {
    let message: Message
    let currentUser: String
    let onReply: (Message) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void
    let onCopy: (String) -> Void

    private var isOwner: Bool {
        message.from.lowercased() == currentUser.lowercased()
    }

    var body: some View {
        // ... existing content ...
        .contextMenu {
            Button {
                onReply(message)
            } label: {
                Label("Reply", systemImage: "arrowshape.turn.up.left")
            }

            Button {
                onCopy(message.content)
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }

            if isOwner {
                Divider()

                Button {
                    onEdit(message)
                } label: {
                    Label("Edit", systemImage: "pencil")
                }

                Button(role: .destructive) {
                    onDelete(message)
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }
}
```

#### 3.2 Edit Message Flow

**File:** `Views/ChatView.swift`

```swift
@State private var editingMessage: Message?
@State private var editText: String = ""

// Edit sheet
.sheet(item: $editingMessage) { message in
    NavigationStack {
        VStack {
            TextEditor(text: $editText)
                .padding()
        }
        .navigationTitle("Edit Message")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") {
                    editingMessage = nil
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        await viewModel.editMessage(message, newContent: editText)
                        editingMessage = nil
                    }
                }
            }
        }
    }
    .onAppear {
        editText = message.content
    }
}
```

#### 3.3 Delete Confirmation

```swift
@State private var messageToDelete: Message?

.confirmationDialog(
    "Delete Message",
    isPresented: Binding(
        get: { messageToDelete != nil },
        set: { if !$0 { messageToDelete = nil } }
    ),
    presenting: messageToDelete
) { message in
    Button("Delete", role: .destructive) {
        Task {
            await viewModel.deleteMessage(message)
        }
    }
} message: { _ in
    Text("This message will be permanently deleted.")
}
```

#### 3.4 ViewModel Methods

**File:** `Views/MainView.swift` (MainViewModel)

```swift
func editMessage(_ message: Message, newContent: String) async {
    guard let repo = selectedRepository,
          let channel = selectedChannel,
          let user = currentUser,
          let sha = message.sha else { return }

    do {
        // Generate updated content with edited timestamp
        let now = Date()
        let iso8601 = ISO8601DateFormatter()
        iso8601.formatOptions = [.withInternetDateTime]

        var updatedContent = """
        ---
        from: \(message.from)
        date: \(iso8601.string(from: message.date))
        edited: \(iso8601.string(from: now))
        """

        if let replyTo = message.replyTo {
            updatedContent += "\nreply_to: \(replyTo)"
        }

        updatedContent += "\n---\n\n\(newContent)"

        // Update via API
        let response = try await api?.updateFile(
            owner: repo.owner,
            repo: repo.name,
            path: "\(channel.id)/\(message.filename)",
            content: updatedContent,
            sha: sha,
            message: "Edit message"
        )

        // Update local cache
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = Message(
                id: message.id,
                filename: message.filename,
                from: message.from,
                date: message.date,
                replyTo: message.replyTo,
                tags: message.tags,
                edited: now,
                content: newContent,
                rawContent: updatedContent,
                sha: response?.content.sha
            )
        }
    } catch {
        self.error = error.localizedDescription
    }
}

func deleteMessage(_ message: Message) async {
    guard let repo = selectedRepository,
          let channel = selectedChannel,
          let sha = message.sha else { return }

    do {
        try await api?.deleteFile(
            owner: repo.owner,
            repo: repo.name,
            path: "\(channel.id)/\(message.filename)",
            sha: sha,
            message: "Delete message"
        )

        // Remove from local
        messages.removeAll { $0.id == message.id }
    } catch {
        self.error = error.localizedDescription
    }
}
```

---

## Phase 4: File Attachments

### Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                    File Attachment Flow                     │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User picks image/file from Photos/Files                │
│                         ↓                                   │
│  2. Generate unique filename: {timestamp}-{hash}.{ext}     │
│                         ↓                                   │
│  3. Upload to: .assets/{filename} via GitHub API           │
│                         ↓                                   │
│  4. Add path to message frontmatter (images/attachments)   │
│                         ↓                                   │
│  5. Render inline preview in MessageBubble                 │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### 4.1 Update Message Model

**File:** `Models/Message.swift`

```swift
struct Message: Identifiable, Codable, Equatable {
    // ... existing fields ...
    let files: [String]?        // @ referenced files (paths in repo)
    let images: [String]?       // Pasted images (paths in .assets/)
    let attachments: [String]?  // Pasted files (paths in .assets/)
}
```

### 4.2 Update MessageParser

**File:** `Services/MessageParser.swift`

```swift
// In parse() method, add:
let files = parseStringArray(yaml["files"])
let images = parseStringArray(yaml["images"])
let attachments = parseStringArray(yaml["attachments"])

// Helper
private static func parseStringArray(_ value: String?) -> [String]? {
    guard let value = value, !value.isEmpty else { return nil }

    // Handle YAML array format
    if value.hasPrefix("[") && value.hasSuffix("]") {
        // Inline array: [item1, item2]
        let inner = String(value.dropFirst().dropLast())
        return inner.components(separatedBy: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    // Single value
    return [value]
}

// Update generateMessageContent
static func generateMessageContent(
    from: String,
    content: String,
    replyTo: String? = nil,
    tags: [String]? = nil,
    images: [String]? = nil,
    attachments: [String]? = nil
) -> String {
    // ... existing code ...

    if let images = images, !images.isEmpty {
        frontmatter += "\nimages:"
        for image in images {
            frontmatter += "\n  - \(image)"
        }
    }

    if let attachments = attachments, !attachments.isEmpty {
        frontmatter += "\nattachments:"
        for attachment in attachments {
            frontmatter += "\n  - \(attachment)"
        }
    }

    // ... rest ...
}
```

### 4.3 Image Picker & Upload

**File:** `Views/MessageInput.swift`

```swift
import PhotosUI

struct MessageInput: View {
    // ... existing state ...
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var pendingImages: [(data: Data, filename: String)] = []
    @State private var isUploading = false

    var body: some View {
        VStack(spacing: 0) {
            // Pending images preview
            if !pendingImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(pendingImages.indices, id: \.self) { index in
                            ImagePreviewChip(
                                data: pendingImages[index].data,
                                onRemove: { pendingImages.remove(at: index) }
                            )
                        }
                    }
                    .padding(.horizontal)
                }
                .frame(height: 80)
            }

            // Input row
            HStack(alignment: .bottom, spacing: 12) {
                // Photo picker button
                PhotosPicker(
                    selection: $selectedPhotos,
                    maxSelectionCount: 5,
                    matching: .images
                ) {
                    Image(systemName: "photo")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .onChange(of: selectedPhotos) { _, items in
                    Task {
                        await loadPhotos(items)
                    }
                }

                // Text input...

                // Send button...
            }
        }
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "png"
                let filename = generateAssetFilename(extension: ext)
                pendingImages.append((data: data, filename: filename))
            }
        }
        selectedPhotos = []
    }

    private func generateAssetFilename(extension ext: String) -> String {
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let random = String(format: "%06x", Int.random(in: 0..<0xFFFFFF))
        return "\(timestamp)-\(random).\(ext)"
    }
}
```

### 4.4 Upload to .assets/

**File:** `Services/SyncService.swift`

```swift
func uploadAsset(
    owner: String,
    repo: String,
    filename: String,
    data: Data
) async throws -> String {
    guard let api = api else { throw GitHubAPIError.unauthorized }

    let path = ".assets/\(filename)"

    _ = try await api.createFile(
        owner: owner,
        repo: repo,
        path: path,
        content: data.base64EncodedString(),
        message: "Upload asset: \(filename)"
    )

    return path
}

func sendMessage(
    owner: String,
    repo: String,
    channel: String,
    content: String,
    from: String,
    replyTo: String? = nil,
    images: [String]? = nil,
    attachments: [String]? = nil
) async throws -> Message {
    // ... update to include images/attachments in frontmatter
}
```

### 4.5 Render Attachments in MessageBubble

**File:** `Views/MessageBubble.swift`

```swift
// After content, before tags
if let images = message.images, !images.isEmpty {
    FlowLayout(spacing: 8) {
        ForEach(images, id: \.self) { imagePath in
            AsyncImage(url: imageURL(for: imagePath)) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                ProgressView()
            }
            .frame(maxWidth: 200, maxHeight: 200)
            .cornerRadius(8)
        }
    }
    .padding(.top, 8)
}

if let attachments = message.attachments, !attachments.isEmpty {
    VStack(alignment: .leading, spacing: 4) {
        ForEach(attachments, id: \.self) { path in
            AttachmentLink(path: path, onTap: { openAttachment(path) })
        }
    }
    .padding(.top, 8)
}

private func imageURL(for path: String) -> URL? {
    // Construct raw GitHub content URL
    guard let repo = /* get current repo */ else { return nil }
    return URL(string: "https://raw.githubusercontent.com/\(repo.owner)/\(repo.name)/vibechannel/\(path)")
}
```

---

## Implementation Timeline

| Phase | Description | Estimated Effort | Dependencies |
|-------|-------------|------------------|--------------|
| **0** | SwiftData Cache Layer | 3-4 days | None |
| **1** | Reply System | 1-2 days | Phase 0 (optional) |
| **2** | Markdown Rendering | 0.5 days | MarkdownUI package |
| **3** | Message Actions | 1-2 days | Phase 0 (for optimistic updates) |
| **4** | File Attachments | 2-3 days | Phase 0 (for caching) |

**Total Estimated: 8-12 days**

---

## Testing Checklist

### Phase 0: Cache Layer
- [ ] Cold start shows cached data
- [ ] Background refresh updates UI
- [ ] Write-through updates cache immediately
- [ ] Polling respects ETag/304
- [ ] Cache invalidation works correctly
- [ ] App kills preserve cache state

### Phase 1: Replies
- [ ] Reply preview shows truncated parent content
- [ ] Tap on preview scrolls to parent
- [ ] Reply bar appears above input
- [ ] Cancel reply works
- [ ] Reply sent with correct `reply_to` field
- [ ] Deleted parent shows "[deleted message]"

### Phase 2: Markdown
- [ ] Bold, italic, code render correctly
- [ ] Code blocks have syntax highlighting
- [ ] Links are tappable
- [ ] Lists render properly
- [ ] Images in markdown render (if applicable)

### Phase 3: Message Actions
- [ ] Context menu appears on long-press
- [ ] Reply action enters reply mode
- [ ] Copy copies text to clipboard
- [ ] Edit shows only on own messages
- [ ] Edit saves changes correctly
- [ ] Delete shows only on own messages
- [ ] Delete confirmation works
- [ ] Deleted message removed from UI

### Phase 4: Attachments
- [ ] Photo picker allows selection
- [ ] Preview chips show before send
- [ ] Remove chip works
- [ ] Images upload to .assets/
- [ ] Sent message includes image paths
- [ ] Images render inline in messages
- [ ] Large images are resized before upload

---

## Design Decisions

### 1. Cache Size Limits
**Decision:** 500 most recent messages per channel

**Rationale:**
- Balances memory usage with sufficient history for context
- Covers ~2-4 weeks of active channel conversation
- Older messages fetched on-demand via "Load More" if needed
- Total cache footprint: ~500 msgs × ~2KB avg = ~1MB per channel

### 2. Image Compression
**Decision:** Yes, compress before upload
- Max dimension: 1920px (resize larger images proportionally)
- Format: JPEG at 80% quality for photos, PNG for screenshots/graphics
- Max file size: 5MB after compression (reject larger)

**Rationale:**
- Reduces upload time on mobile networks
- Reduces GitHub storage usage
- 1920px is sufficient for viewing on any device
- 80% JPEG quality is visually lossless for most photos

### 3. Offline Writes
**Decision:** No offline queue - remote-first only

**Rationale:**
- Keeps architecture simple, avoids sync conflict resolution
- VibeChannel is designed for connected, async collaboration
- Clear error messaging when offline: "No connection. Message not sent."
- User can retry when connected - content preserved in input field
- Future consideration: Draft storage (local only, not queued for sync)

### 4. Platform Target
**Decision:** iOS 17+ with SwiftData

**Rationale:**
- iOS 17 adoption is ~85%+ as of late 2025
- SwiftData is significantly simpler than Core Data
- Apple's future direction - better long-term investment
- Modern Swift concurrency integration
- If iOS 16 support becomes critical, can add Core Data adapter layer later

### 5. Rate Limiting UX
**Decision:** Progressive warnings with graceful degradation

| Usage | Behavior |
|-------|----------|
| < 80% (< 4000 calls) | Normal operation |
| 80-95% (4000-4750) | Yellow banner: "API limit: {remaining} calls left" |
| > 95% (> 4750) | Orange banner: "Approaching limit. Sync paused." |
| 100% (0 remaining) | Red banner: "Rate limited. Resets in {time}." |

**Implementation:**
- Track `X-RateLimit-Remaining` header from API responses
- Store reset time from `X-RateLimit-Reset` header
- Pause polling when > 95%, resume after reset
- Allow manual actions (send/edit/delete) even when polling paused

---

## References

- [SwiftData Documentation](https://developer.apple.com/documentation/swiftdata)
- [MarkdownUI GitHub](https://github.com/gonzalezreal/swift-markdown-ui)
- [GitHub REST API - Contents](https://docs.github.com/en/rest/repos/contents)
- [VS Code Extension v0.6.17 Source](../extension/src/chatPanel.ts)
