# VibeChannel iOS: Supabase Migration Plan

**Created:** December 10, 2025
**Status:** Planning
**Related:** [Supabase Backend Implementation](./20251210_implementation-plan.md)

---

## Executive Summary

This document details the complete migration of the VibeChannel iOS app from the current GitHub-direct architecture to the new Supabase backend. This is a **full rewrite** of the data layer - no backward compatibility with the old GitHub API approach.

**Key Changes:**
- Replace GitHub REST API with Supabase PostgreSQL queries
- Replace OAuth direct-to-GitHub with Supabase Auth (GitHub provider)
- Replace 10-second polling with WebSocket real-time subscriptions
- Add presence (online/typing indicators)
- Add server-side unread counts
- Remove all markdown parsing (structured data now)
- Simplify caching (optional, data is fast)

---

## Table of Contents

1. [Architecture Comparison](#part-1-architecture-comparison)
2. [Supabase Configuration](#part-2-supabase-configuration)
3. [Swift Package Dependencies](#part-3-swift-package-dependencies)
4. [New Data Models](#part-4-new-data-models)
5. [Service Layer Rewrite](#part-5-service-layer-rewrite)
6. [Authentication Flow](#part-6-authentication-flow)
7. [Realtime Implementation](#part-7-realtime-implementation)
8. [View Layer Updates](#part-8-view-layer-updates)
9. [Files to Delete](#part-9-files-to-delete)
10. [Files to Create](#part-10-files-to-create)
11. [Files to Modify](#part-11-files-to-modify)
12. [Testing Plan](#part-12-testing-plan)
13. [Implementation Checklist](#part-13-implementation-checklist)

---

## Part 1: Architecture Comparison

### Before: GitHub-Direct Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS App                                 │
├─────────────────────────────────────────────────────────────────┤
│                       SwiftUI Views                             │
│  LoginView → ContentView → MainView → ChatView → MessageBubble │
├─────────────────────────────────────────────────────────────────┤
│              MainViewModel (ObservableObject)                   │
├─────────────────────────────────────────────────────────────────┤
│              MessageRepository (SwiftData Cache)                │
├─────────────────────────────────────────────────────────────────┤
│  GitHubAuthService    GitHubAPIClient    SyncService            │
│  (OAuth direct)       (REST calls)       (10s polling)          │
├─────────────────────────────────────────────────────────────────┤
│                     MessageParser                               │
│              (YAML frontmatter + markdown)                      │
├─────────────────────────────────────────────────────────────────┤
│                   GitHub REST API v3                            │
│                  (vibechannel branch)                           │
└─────────────────────────────────────────────────────────────────┘

Problems:
- 10-second polling delay
- Rate limited (5000 requests/hour)
- No presence/typing indicators
- Complex markdown parsing
- Client-side unread counts only
```

### After: Supabase Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS App                                 │
├─────────────────────────────────────────────────────────────────┤
│                       SwiftUI Views                             │
│  LoginView → ContentView → MainView → ChatView → MessageBubble │
├─────────────────────────────────────────────────────────────────┤
│              MainViewModel (ObservableObject)                   │
├─────────────────────────────────────────────────────────────────┤
│  SupabaseService (singleton)                                    │
│  ├── AuthService (Supabase Auth + GitHub OAuth)                 │
│  ├── RealtimeService (WebSocket subscriptions)                  │
│  ├── MessageService (CRUD operations)                           │
│  ├── ChannelService (CRUD operations)                           │
│  ├── RepoService (user's repos)                                 │
│  └── PresenceService (online/typing status)                     │
├─────────────────────────────────────────────────────────────────┤
│                    Supabase Swift SDK                           │
│            (supabase-swift via Swift Package Manager)           │
├─────────────────────────────────────────────────────────────────┤
│                   Supabase Backend                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │  PostgreSQL │ │  Realtime   │ │     Edge Functions      │   │
│  │  (7 tables) │ │ (WebSocket) │ │  (sync-to-github)       │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

Benefits:
- Instant messaging via WebSocket
- No rate limits
- Real presence/typing indicators
- Structured data (no parsing)
- Server-side unread counts
```

---

## Part 2: Supabase Configuration

### Project Details

| Setting | Value |
|---------|-------|
| **Project URL** | `https://mhdkictdllndbsmmnxfp.supabase.co` |
| **Anon Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oZGtpY3RkbGxuZGJzbW1ueGZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNzk4NDMsImV4cCI6MjA4MDk1NTg0M30.0T62h45Ocoj67KI7ka-H9-noXY-Kw8MPZpI67uxLLlQ` |
| **GitHub OAuth Client ID** | `Ov23liwA3oYrksna2Ulm` |
| **Redirect URL (iOS)** | `vibechannel://auth/callback` |

### Database Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | User profiles (auto-created on auth) | Yes |
| `repos` | Registered repositories | Yes |
| `user_repos` | User ↔ Repo access mapping | Yes |
| `channels` | Chat channels per repo | Yes |
| `messages` | Message cache (synced to Git) | Yes |
| `presence` | Online/typing status (transient) | Yes |
| `unread_counts` | Per-user read state (transient) | Yes |

### Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `sync-to-github` | Message INSERT | Write message to Git |
| `webhook-handler` | GitHub webhook | Sync Git → Supabase |
| `rebuild-cache` | Manual/API | Full rebuild from Git |

---

## Part 3: Swift Package Dependencies

### Add to Xcode Project

**Package URL:** `https://github.com/supabase/supabase-swift`
**Version:** `2.0.0` or later

### Products to Include

```swift
// In Package.swift or Xcode SPM UI
dependencies: [
    .package(url: "https://github.com/supabase/supabase-swift", from: "2.0.0")
]

// Products to add to target:
// - Supabase (main client)
// - Auth (authentication)
// - Realtime (WebSocket)
// - PostgREST (database queries)
```

### Import Statements

```swift
import Supabase
import Auth
import Realtime
import PostgREST
```

---

## Part 4: New Data Models

### 4.1 User.swift (replaces GitHubUser.swift)

```swift
// iOS/VibeChannel/Models/User.swift

import Foundation

struct User: Identifiable, Codable, Equatable {
    let id: UUID                    // Supabase auth.users.id
    let githubId: Int?              // GitHub numeric ID
    let githubLogin: String         // GitHub username (e.g., "lucasygu")
    let githubName: String?         // Display name
    let avatarUrl: String?          // GitHub avatar URL
    let email: String?              // Email address
    let createdAt: Date
    let updatedAt: Date

    var displayName: String {
        githubName ?? githubLogin
    }

    enum CodingKeys: String, CodingKey {
        case id
        case githubId = "github_id"
        case githubLogin = "github_login"
        case githubName = "github_name"
        case avatarUrl = "avatar_url"
        case email
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
```

### 4.2 Repo.swift (replaces Repository.swift)

```swift
// iOS/VibeChannel/Models/Repo.swift

import Foundation

struct Repo: Identifiable, Codable, Equatable, Hashable {
    let id: UUID                        // Supabase UUID
    let githubInstallationId: Int       // GitHub App installation
    let githubRepoId: Int               // GitHub numeric repo ID
    let owner: String                   // e.g., "lucasygu"
    let name: String                    // e.g., "VibeChannel"
    let fullName: String                // e.g., "lucasygu/VibeChannel"
    let defaultBranch: String           // e.g., "main"
    let vibechannelBranch: String       // e.g., "vibechannel"
    let vibechannelInitialized: Bool?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case githubInstallationId = "github_installation_id"
        case githubRepoId = "github_repo_id"
        case owner
        case name
        case fullName = "full_name"
        case defaultBranch = "default_branch"
        case vibechannelBranch = "vibechannel_branch"
        case vibechannelInitialized = "vibechannel_initialized"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
```

### 4.3 Channel.swift (updated)

```swift
// iOS/VibeChannel/Models/Channel.swift

import Foundation

struct Channel: Identifiable, Codable, Equatable, Hashable {
    let id: UUID                    // Supabase UUID
    let repoId: UUID                // Foreign key to repos
    let name: String                // Channel name (e.g., "general")
    let description: String?        // Optional description
    let createdAt: Date
    let updatedAt: Date

    // Local state (not from database)
    var unreadCount: Int = 0

    enum CodingKeys: String, CodingKey {
        case id
        case repoId = "repo_id"
        case name
        case description
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        repoId = try container.decode(UUID.self, forKey: .repoId)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        unreadCount = 0  // Set from unread_counts table separately
    }
}
```

### 4.4 Message.swift (simplified)

```swift
// iOS/VibeChannel/Models/Message.swift

import Foundation

struct Message: Identifiable, Codable, Equatable {
    let id: UUID                        // Supabase UUID
    let channelId: UUID                 // Foreign key to channels
    let sender: String                  // GitHub username
    let senderUserId: UUID?             // Foreign key to users (optional)
    let content: String                 // Message content (markdown)
    let replyToId: UUID?                // Foreign key to parent message
    let replyToPath: String?            // Legacy: original filename
    let tags: [String]?                 // Optional tags
    let githubPath: String              // Path in Git (e.g., "general/20250115T103045-alice-abc123.md")
    let githubSha: String?              // Git file SHA
    let githubSynced: Bool?             // Has been written to Git
    let syncedAt: Date?                 // When synced to Git
    let createdAt: Date                 // Message timestamp
    let updatedAt: Date                 // Last modified

    // For replies - populated by join query
    var replyToMessage: Message?

    enum CodingKeys: String, CodingKey {
        case id
        case channelId = "channel_id"
        case sender
        case senderUserId = "sender_user_id"
        case content
        case replyToId = "reply_to_id"
        case replyToPath = "reply_to_path"
        case tags
        case githubPath = "github_path"
        case githubSha = "github_sha"
        case githubSynced = "github_synced"
        case syncedAt = "synced_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        channelId = try container.decode(UUID.self, forKey: .channelId)
        sender = try container.decode(String.self, forKey: .sender)
        senderUserId = try container.decodeIfPresent(UUID.self, forKey: .senderUserId)
        content = try container.decode(String.self, forKey: .content)
        replyToId = try container.decodeIfPresent(UUID.self, forKey: .replyToId)
        replyToPath = try container.decodeIfPresent(String.self, forKey: .replyToPath)
        tags = try container.decodeIfPresent([String].self, forKey: .tags)
        githubPath = try container.decode(String.self, forKey: .githubPath)
        githubSha = try container.decodeIfPresent(String.self, forKey: .githubSha)
        githubSynced = try container.decodeIfPresent(Bool.self, forKey: .githubSynced)
        syncedAt = try container.decodeIfPresent(Date.self, forKey: .syncedAt)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        replyToMessage = nil
    }
}
```

### 4.5 Presence.swift (new)

```swift
// iOS/VibeChannel/Models/Presence.swift

import Foundation

struct Presence: Identifiable, Codable, Equatable {
    let userId: UUID                    // Primary key, foreign key to users
    let repoId: UUID?                   // Current repo
    let channelId: UUID?                // Current channel
    let status: PresenceStatus          // online, away, typing, offline
    let lastSeen: Date

    var id: UUID { userId }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case repoId = "repo_id"
        case channelId = "channel_id"
        case status
        case lastSeen = "last_seen"
    }
}

enum PresenceStatus: String, Codable {
    case online
    case away
    case typing
    case offline
}
```

### 4.6 UnreadCount.swift (new)

```swift
// iOS/VibeChannel/Models/UnreadCount.swift

import Foundation

struct UnreadCount: Codable, Equatable {
    let userId: UUID
    let channelId: UUID
    let lastReadMessageId: UUID?
    let lastReadAt: Date?
    let unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case channelId = "channel_id"
        case lastReadMessageId = "last_read_message_id"
        case lastReadAt = "last_read_at"
        case unreadCount = "unread_count"
    }
}
```

### 4.7 UserRepo.swift (new - for access control)

```swift
// iOS/VibeChannel/Models/UserRepo.swift

import Foundation

struct UserRepo: Codable, Equatable {
    let userId: UUID
    let repoId: UUID
    let role: UserRepoRole
    let joinedAt: Date

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case repoId = "repo_id"
        case role
        case joinedAt = "joined_at"
    }
}

enum UserRepoRole: String, Codable {
    case admin
    case member
    case viewer
}
```

---

## Part 5: Service Layer Rewrite

### 5.1 SupabaseService.swift (new - singleton)

```swift
// iOS/VibeChannel/Services/SupabaseService.swift

import Foundation
import Supabase

@MainActor
final class SupabaseService: ObservableObject {
    static let shared = SupabaseService()

    let client: SupabaseClient

    // Sub-services
    lazy var auth = AuthService(client: client)
    lazy var realtime = RealtimeService(client: client)
    lazy var messages = MessageService(client: client)
    lazy var channels = ChannelService(client: client)
    lazy var repos = RepoService(client: client)
    lazy var presence = PresenceService(client: client)

    private init() {
        client = SupabaseClient(
            supabaseURL: URL(string: Config.supabaseUrl)!,
            supabaseKey: Config.supabaseAnonKey
        )
    }
}

// Configuration
enum Config {
    static let supabaseUrl = "https://mhdkictdllndbsmmnxfp.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oZGtpY3RkbGxuZGJzbW1ueGZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNzk4NDMsImV4cCI6MjA4MDk1NTg0M30.0T62h45Ocoj67KI7ka-H9-noXY-Kw8MPZpI67uxLLlQ"
    static let redirectUrl = "vibechannel://auth/callback"
}
```

### 5.2 AuthService.swift (new - replaces GitHubAuthService)

```swift
// iOS/VibeChannel/Services/AuthService.swift

import Foundation
import Supabase
import Auth

@MainActor
final class AuthService: ObservableObject {
    private let client: SupabaseClient

    @Published var currentUser: User?
    @Published var session: Session?
    @Published var isLoading = false
    @Published var error: String?

    init(client: SupabaseClient) {
        self.client = client

        // Listen for auth state changes
        Task {
            for await state in client.auth.authStateChanges {
                await handleAuthStateChange(state)
            }
        }
    }

    // MARK: - Sign In with GitHub via Supabase

    func signIn() async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        do {
            try await client.auth.signInWithOAuth(
                provider: .github,
                redirectTo: URL(string: Config.redirectUrl)
            )
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    // MARK: - Handle OAuth Callback

    func handleCallback(url: URL) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        do {
            try await client.auth.session(from: url)
            await loadCurrentUser()
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    // MARK: - Sign Out

    func signOut() async throws {
        do {
            try await client.auth.signOut()
            currentUser = nil
            session = nil
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    // MARK: - Load Current User from Database

    func loadCurrentUser() async {
        guard let authUser = client.auth.currentUser else {
            currentUser = nil
            return
        }

        do {
            let user: User = try await client.database
                .from("users")
                .select()
                .eq("id", value: authUser.id)
                .single()
                .execute()
                .value

            currentUser = user
        } catch {
            print("Failed to load user: \(error)")
            // User might not exist yet (trigger hasn't run)
            // Create from auth metadata
            currentUser = User(
                id: authUser.id,
                githubId: authUser.userMetadata["provider_id"] as? Int,
                githubLogin: authUser.userMetadata["user_name"] as? String ?? "unknown",
                githubName: authUser.userMetadata["full_name"] as? String,
                avatarUrl: authUser.userMetadata["avatar_url"] as? String,
                email: authUser.email,
                createdAt: Date(),
                updatedAt: Date()
            )
        }
    }

    // MARK: - Restore Session

    func restoreSession() async {
        do {
            session = try await client.auth.session
            await loadCurrentUser()
        } catch {
            print("No existing session: \(error)")
        }
    }

    // MARK: - Auth State Handler

    private func handleAuthStateChange(_ state: AuthChangeEvent) async {
        switch state {
        case .signedIn:
            session = try? await client.auth.session
            await loadCurrentUser()
        case .signedOut:
            currentUser = nil
            session = nil
        case .tokenRefreshed:
            session = try? await client.auth.session
        default:
            break
        }
    }
}
```

### 5.3 MessageService.swift (new)

```swift
// iOS/VibeChannel/Services/MessageService.swift

import Foundation
import Supabase

final class MessageService {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Fetch Messages

    func fetchMessages(channelId: UUID, limit: Int = 100, before: Date? = nil) async throws -> [Message] {
        var query = client.database
            .from("messages")
            .select()
            .eq("channel_id", value: channelId)
            .order("created_at", ascending: true)
            .limit(limit)

        if let before = before {
            query = query.lt("created_at", value: before.ISO8601Format())
        }

        let messages: [Message] = try await query.execute().value
        return messages
    }

    // MARK: - Send Message

    func sendMessage(
        channelId: UUID,
        sender: String,
        senderUserId: UUID?,
        content: String,
        replyToId: UUID? = nil,
        tags: [String]? = nil
    ) async throws -> Message {
        // Generate GitHub path (for Git sync)
        let now = Date()
        let filename = generateFilename(sender: sender, date: now)
        let channel = try await fetchChannelName(channelId: channelId)
        let githubPath = "\(channel)/\(filename)"

        let newMessage: [String: AnyEncodable] = [
            "channel_id": AnyEncodable(channelId),
            "sender": AnyEncodable(sender),
            "sender_user_id": AnyEncodable(senderUserId),
            "content": AnyEncodable(content),
            "reply_to_id": AnyEncodable(replyToId),
            "tags": AnyEncodable(tags),
            "github_path": AnyEncodable(githubPath),
            "github_synced": AnyEncodable(false),
            "created_at": AnyEncodable(now.ISO8601Format())
        ]

        let message: Message = try await client.database
            .from("messages")
            .insert(newMessage)
            .select()
            .single()
            .execute()
            .value

        return message
    }

    // MARK: - Edit Message

    func editMessage(messageId: UUID, newContent: String) async throws -> Message {
        let updates: [String: AnyEncodable] = [
            "content": AnyEncodable(newContent),
            "updated_at": AnyEncodable(Date().ISO8601Format())
        ]

        let message: Message = try await client.database
            .from("messages")
            .update(updates)
            .eq("id", value: messageId)
            .select()
            .single()
            .execute()
            .value

        return message
    }

    // MARK: - Delete Message

    func deleteMessage(messageId: UUID) async throws {
        try await client.database
            .from("messages")
            .delete()
            .eq("id", value: messageId)
            .execute()
    }

    // MARK: - Helpers

    private func generateFilename(sender: String, date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay, .withTime]
        let timestamp = formatter.string(from: date)
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: ":", with: "")

        let randomId = (0..<6).map { _ in
            "0123456789abcdef".randomElement()!
        }.map(String.init).joined()

        let safeSender = sender.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }

        return "\(timestamp)-\(safeSender)-\(randomId).md"
    }

    private func fetchChannelName(channelId: UUID) async throws -> String {
        struct ChannelName: Decodable {
            let name: String
        }
        let channel: ChannelName = try await client.database
            .from("channels")
            .select("name")
            .eq("id", value: channelId)
            .single()
            .execute()
            .value
        return channel.name
    }
}

// Helper for encoding mixed types
struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init<T: Encodable>(_ value: T?) {
        _encode = { encoder in
            var container = encoder.singleValueContainer()
            if let value = value {
                try container.encode(value)
            } else {
                try container.encodeNil()
            }
        }
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
```

### 5.4 ChannelService.swift (new)

```swift
// iOS/VibeChannel/Services/ChannelService.swift

import Foundation
import Supabase

final class ChannelService {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Fetch Channels for Repo

    func fetchChannels(repoId: UUID) async throws -> [Channel] {
        let channels: [Channel] = try await client.database
            .from("channels")
            .select()
            .eq("repo_id", value: repoId)
            .order("name", ascending: true)
            .execute()
            .value

        return channels
    }

    // MARK: - Create Channel

    func createChannel(repoId: UUID, name: String, description: String? = nil) async throws -> Channel {
        let newChannel: [String: AnyEncodable] = [
            "repo_id": AnyEncodable(repoId),
            "name": AnyEncodable(name),
            "description": AnyEncodable(description)
        ]

        let channel: Channel = try await client.database
            .from("channels")
            .insert(newChannel)
            .select()
            .single()
            .execute()
            .value

        return channel
    }

    // MARK: - Get or Create Channel

    func getOrCreateChannel(repoId: UUID, name: String) async throws -> Channel {
        // Try to find existing
        let existing: [Channel] = try await client.database
            .from("channels")
            .select()
            .eq("repo_id", value: repoId)
            .eq("name", value: name)
            .execute()
            .value

        if let channel = existing.first {
            return channel
        }

        // Create new
        return try await createChannel(repoId: repoId, name: name)
    }

    // MARK: - Fetch Unread Counts

    func fetchUnreadCounts(userId: UUID, repoId: UUID) async throws -> [UUID: Int] {
        struct UnreadResult: Decodable {
            let channelId: UUID
            let unreadCount: Int

            enum CodingKeys: String, CodingKey {
                case channelId = "channel_id"
                case unreadCount = "unread_count"
            }
        }

        let counts: [UnreadResult] = try await client.database
            .from("unread_counts")
            .select("channel_id, unread_count")
            .eq("user_id", value: userId)
            .execute()
            .value

        return Dictionary(uniqueKeysWithValues: counts.map { ($0.channelId, $0.unreadCount) })
    }

    // MARK: - Mark Channel as Read

    func markChannelRead(channelId: UUID) async throws {
        try await client.database
            .rpc("mark_channel_read", params: ["p_channel_id": channelId])
            .execute()
    }
}
```

### 5.5 RepoService.swift (new)

```swift
// iOS/VibeChannel/Services/RepoService.swift

import Foundation
import Supabase

final class RepoService {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Fetch User's Repos

    func fetchUserRepos(userId: UUID) async throws -> [Repo] {
        // Query repos through user_repos junction table
        let repos: [Repo] = try await client.database
            .from("repos")
            .select("""
                *,
                user_repos!inner(user_id)
            """)
            .eq("user_repos.user_id", value: userId)
            .order("full_name", ascending: true)
            .execute()
            .value

        return repos
    }

    // MARK: - Get Single Repo

    func getRepo(repoId: UUID) async throws -> Repo {
        let repo: Repo = try await client.database
            .from("repos")
            .select()
            .eq("id", value: repoId)
            .single()
            .execute()
            .value

        return repo
    }

    // MARK: - Get Repo by Full Name

    func getRepoByFullName(fullName: String) async throws -> Repo? {
        let repos: [Repo] = try await client.database
            .from("repos")
            .select()
            .eq("full_name", value: fullName)
            .execute()
            .value

        return repos.first
    }

    // MARK: - Join Repo (add user access)

    func joinRepo(userId: UUID, repoId: UUID, role: UserRepoRole = .member) async throws {
        let userRepo: [String: AnyEncodable] = [
            "user_id": AnyEncodable(userId),
            "repo_id": AnyEncodable(repoId),
            "role": AnyEncodable(role.rawValue)
        ]

        try await client.database
            .from("user_repos")
            .upsert(userRepo)
            .execute()
    }
}
```

### 5.6 RealtimeService.swift (new)

```swift
// iOS/VibeChannel/Services/RealtimeService.swift

import Foundation
import Supabase
import Realtime

@MainActor
final class RealtimeService: ObservableObject {
    private let client: SupabaseClient
    private var channelSubscription: RealtimeChannelV2?
    private var presenceSubscription: RealtimeChannelV2?

    @Published var onlineUsers: [UUID: PresenceStatus] = [:]

    // Callbacks
    var onMessageInserted: ((Message) -> Void)?
    var onMessageUpdated: ((Message) -> Void)?
    var onMessageDeleted: ((UUID) -> Void)?

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Subscribe to Channel Messages

    func subscribeToChannel(channelId: UUID) async {
        // Unsubscribe from previous
        await unsubscribeFromChannel()

        let channel = client.realtime.channel("messages:\(channelId)")

        // Listen for INSERTs
        channel.onPostgresChange(
            event: .insert,
            schema: "public",
            table: "messages",
            filter: "channel_id=eq.\(channelId)"
        ) { [weak self] payload in
            guard let message = try? payload.decodeRecord(as: Message.self, decoder: JSONDecoder.supabase) else { return }
            Task { @MainActor in
                self?.onMessageInserted?(message)
            }
        }

        // Listen for UPDATEs
        channel.onPostgresChange(
            event: .update,
            schema: "public",
            table: "messages",
            filter: "channel_id=eq.\(channelId)"
        ) { [weak self] payload in
            guard let message = try? payload.decodeRecord(as: Message.self, decoder: JSONDecoder.supabase) else { return }
            Task { @MainActor in
                self?.onMessageUpdated?(message)
            }
        }

        // Listen for DELETEs
        channel.onPostgresChange(
            event: .delete,
            schema: "public",
            table: "messages",
            filter: "channel_id=eq.\(channelId)"
        ) { [weak self] payload in
            guard let id = payload.oldRecord?["id"] as? String,
                  let uuid = UUID(uuidString: id) else { return }
            Task { @MainActor in
                self?.onMessageDeleted?(uuid)
            }
        }

        await channel.subscribe()
        channelSubscription = channel
    }

    func unsubscribeFromChannel() async {
        await channelSubscription?.unsubscribe()
        channelSubscription = nil
    }

    // MARK: - Presence

    func subscribeToPresence(channelId: UUID, userId: UUID) async {
        await presenceSubscription?.unsubscribe()

        let channel = client.realtime.channel("presence:\(channelId)")

        channel.onPresenceSync { [weak self] presences in
            Task { @MainActor in
                var online: [UUID: PresenceStatus] = [:]
                for (key, value) in presences {
                    if let uid = UUID(uuidString: key),
                       let statusStr = value.first?["status"] as? String,
                       let status = PresenceStatus(rawValue: statusStr) {
                        online[uid] = status
                    }
                }
                self?.onlineUsers = online
            }
        }

        await channel.subscribe()

        // Track own presence
        await channel.track(["user_id": userId.uuidString, "status": "online"])

        presenceSubscription = channel
    }

    func updatePresenceStatus(_ status: PresenceStatus) async {
        guard let channel = presenceSubscription else { return }
        await channel.track(["status": status.rawValue])
    }

    func unsubscribeFromPresence() async {
        await presenceSubscription?.unsubscribe()
        presenceSubscription = nil
    }

    // MARK: - Cleanup

    func unsubscribeAll() async {
        await unsubscribeFromChannel()
        await unsubscribeFromPresence()
    }
}

// JSONDecoder extension for Supabase
extension JSONDecoder {
    static var supabase: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
```

### 5.7 PresenceService.swift (new)

```swift
// iOS/VibeChannel/Services/PresenceService.swift

import Foundation
import Supabase

final class PresenceService {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Update Presence in Database

    func updatePresence(repoId: UUID?, channelId: UUID?, status: PresenceStatus) async throws {
        try await client.database
            .rpc("update_presence", params: [
                "p_repo_id": repoId?.uuidString,
                "p_channel_id": channelId?.uuidString,
                "p_status": status.rawValue
            ])
            .execute()
    }

    // MARK: - Get Online Users in Channel

    func getOnlineUsers(channelId: UUID) async throws -> [Presence] {
        let presences: [Presence] = try await client.database
            .from("presence")
            .select()
            .eq("channel_id", value: channelId)
            .neq("status", value: "offline")
            .execute()
            .value

        return presences
    }

    // MARK: - Set Offline

    func setOffline() async throws {
        try await updatePresence(repoId: nil, channelId: nil, status: .offline)
    }
}
```

---

## Part 6: Authentication Flow

### 6.1 URL Scheme Configuration

**Info.plist** - Add URL scheme for OAuth callback:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>vibechannel</string>
        </array>
        <key>CFBundleURLName</key>
        <string>com.vibechannel.ios</string>
    </dict>
</array>
```

### 6.2 App Delegate / Scene Delegate Handler

**VibeChannelApp.swift** - Handle OAuth callback:

```swift
@main
struct VibeChannelApp: App {
    @StateObject private var supabase = SupabaseService.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(supabase)
                .environmentObject(supabase.auth)
                .onOpenURL { url in
                    Task {
                        try? await supabase.auth.handleCallback(url: url)
                    }
                }
        }
    }
}
```

### 6.3 Login Flow Sequence

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   iOS App   │     │  Supabase   │     │   GitHub    │     │   Safari    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │                    │
       │ signInWithOAuth    │                    │                    │
       │───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ OAuth URL          │                    │
       │◄───────────────────│                    │                    │
       │                    │                    │                    │
       │ Open in Safari     │                    │                    │
       │────────────────────┼────────────────────┼───────────────────►│
       │                    │                    │                    │
       │                    │                    │   User logs in     │
       │                    │                    │◄───────────────────│
       │                    │                    │                    │
       │                    │   Redirect         │                    │
       │                    │◄───────────────────│                    │
       │                    │                    │                    │
       │ Callback URL       │                    │                    │
       │◄───────────────────┼────────────────────┼────────────────────│
       │                    │                    │                    │
       │ session(from: url) │                    │                    │
       │───────────────────►│                    │                    │
       │                    │                    │                    │
       │  Session + User    │                    │                    │
       │◄───────────────────│                    │                    │
       │                    │                    │                    │
       │ Query users table  │                    │                    │
       │───────────────────►│                    │                    │
       │                    │                    │                    │
       │  User profile      │                    │                    │
       │◄───────────────────│                    │                    │
       │                    │                    │                    │
       ▼                    ▼                    ▼                    ▼
```

---

## Part 7: Realtime Implementation

### 7.1 Message Subscription Flow

```swift
// In MainViewModel or ChatView

func selectChannel(_ channel: Channel) async {
    selectedChannel = channel

    // Load initial messages
    messages = try await supabase.messages.fetchMessages(channelId: channel.id)

    // Subscribe to realtime updates
    supabase.realtime.onMessageInserted = { [weak self] message in
        self?.messages.append(message)
        self?.scrollToBottom()
    }

    supabase.realtime.onMessageUpdated = { [weak self] message in
        if let index = self?.messages.firstIndex(where: { $0.id == message.id }) {
            self?.messages[index] = message
        }
    }

    supabase.realtime.onMessageDeleted = { [weak self] id in
        self?.messages.removeAll { $0.id == id }
    }

    await supabase.realtime.subscribeToChannel(channelId: channel.id)

    // Mark as read
    try? await supabase.channels.markChannelRead(channelId: channel.id)
}
```

### 7.2 Presence Flow

```swift
// Track user presence when entering channel
func enterChannel(_ channel: Channel, userId: UUID) async {
    // Subscribe to presence updates
    await supabase.realtime.subscribeToPresence(channelId: channel.id, userId: userId)

    // Update database presence
    try? await supabase.presence.updatePresence(
        repoId: selectedRepo?.id,
        channelId: channel.id,
        status: .online
    )
}

// Update typing status
func setTyping(_ isTyping: Bool) async {
    await supabase.realtime.updatePresenceStatus(isTyping ? .typing : .online)
}

// Leave channel
func leaveChannel() async {
    await supabase.realtime.unsubscribeFromPresence()
    try? await supabase.presence.updatePresence(
        repoId: selectedRepo?.id,
        channelId: nil,
        status: .online
    )
}
```

---

## Part 8: View Layer Updates

### 8.1 ContentView.swift Changes

```swift
// iOS/VibeChannel/ContentView.swift

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthService

    var body: some View {
        Group {
            if auth.currentUser != nil {
                MainView()
            } else {
                LoginView()
            }
        }
        .task {
            await auth.restoreSession()
        }
    }
}
```

### 8.2 LoginView.swift Changes

```swift
// iOS/VibeChannel/Views/LoginView.swift

import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthService

    var body: some View {
        VStack(spacing: 24) {
            // Logo and branding
            Image("AppIcon")
                .resizable()
                .frame(width: 100, height: 100)
                .cornerRadius(20)

            Text("VibeChannel")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Real-time team chat\npowered by Git")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            Spacer()

            // Sign in button
            Button {
                Task {
                    try? await auth.signIn()
                }
            } label: {
                HStack {
                    Image(systemName: "person.fill")
                    Text("Sign in with GitHub")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.accentColor)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(auth.isLoading)

            if auth.isLoading {
                ProgressView()
            }

            if let error = auth.error {
                Text(error)
                    .foregroundColor(.red)
                    .font(.caption)
            }
        }
        .padding()
    }
}
```

### 8.3 MainView.swift Changes

The MainView will need significant refactoring:

1. Remove `GitHubAPIClient` references
2. Remove `SyncService` references
3. Remove `MessageRepository` references
4. Use `SupabaseService` instead
5. Subscribe to realtime on channel selection
6. Show online users in sidebar
7. Show typing indicators

### 8.4 ChatView.swift Changes

1. Remove markdown parsing display logic (keep markdown rendering)
2. Add typing indicator UI
3. Add online users indicator
4. Use realtime messages instead of polled

### 8.5 MessageBubble.swift Changes

1. Remove `rawContent`, `sha` references
2. Keep all rendering (markdown, images, attachments)
3. Add "syncing to git" indicator if `githubSynced == false`

---

## Part 9: Files to Delete

These files are no longer needed:

```
iOS/VibeChannel/
├── Services/
│   ├── GitHubAuthService.swift      # Replaced by AuthService
│   ├── GitHubAPIClient.swift        # Replaced by SupabaseService
│   ├── MessageParser.swift          # No longer needed (structured data)
│   └── SyncService.swift            # Replaced by RealtimeService
├── Models/
│   ├── GitHubUser.swift             # Replaced by User.swift
│   └── Repository.swift             # Replaced by Repo.swift
├── Cache/
│   └── MessageRepository.swift      # No longer needed
└── Utilities/
    └── (KeychainService.swift)      # Keep for now, might remove later
```

---

## Part 10: Files to Create

```
iOS/VibeChannel/
├── Config.swift                     # Supabase URL, keys
├── Services/
│   ├── SupabaseService.swift        # Main singleton
│   ├── AuthService.swift            # Authentication
│   ├── MessageService.swift         # Message CRUD
│   ├── ChannelService.swift         # Channel CRUD
│   ├── RepoService.swift            # Repo queries
│   ├── RealtimeService.swift        # WebSocket subscriptions
│   └── PresenceService.swift        # Online status
└── Models/
    ├── User.swift                   # User model
    ├── Repo.swift                   # Repo model
    ├── Presence.swift               # Presence model
    ├── UnreadCount.swift            # Unread count model
    └── UserRepo.swift               # User-Repo junction
```

---

## Part 11: Files to Modify

```
iOS/VibeChannel/
├── VibeChannelApp.swift             # Add onOpenURL handler
├── ContentView.swift                # Use AuthService
├── Info.plist                       # Add URL scheme
├── Models/
│   ├── Channel.swift                # Add repoId, update structure
│   └── Message.swift                # Simplify, remove parsing fields
└── Views/
    ├── LoginView.swift              # Use Supabase Auth
    ├── MainView.swift               # Major refactor
    ├── ChatView.swift               # Add realtime, typing
    ├── MessageBubble.swift          # Minor updates
    ├── ChannelSidebar.swift         # Show online users
    └── MessageInput.swift           # Add typing indicator
```

---

## Part 12: Testing Plan

### 12.1 Unit Tests

| Test | Description |
|------|-------------|
| `AuthServiceTests` | Sign in, sign out, session restore |
| `MessageServiceTests` | CRUD operations |
| `ChannelServiceTests` | Fetch, create channels |
| `RepoServiceTests` | User repos query |

### 12.2 Integration Tests

| Test | Description |
|------|-------------|
| `AuthFlowTests` | Full OAuth flow with callback |
| `RealtimeTests` | Subscribe, receive messages |
| `PresenceTests` | Online status updates |

### 12.3 Manual Test Cases

1. **Sign In**
   - Open app → Tap "Sign in with GitHub"
   - Safari opens → Log in on GitHub
   - Redirected back → User appears in app
   - Close and reopen → Session restored

2. **View Repos**
   - After sign in → See list of repos
   - Only repos with VibeChannel installed appear

3. **View Channels**
   - Select repo → See channels
   - Unread counts displayed

4. **Send Message**
   - Type message → Tap send
   - Message appears immediately
   - Message synced to Git (check GitHub)

5. **Receive Message**
   - Open same channel on VS Code
   - Send message from VS Code
   - iOS receives instantly (no refresh needed)

6. **Presence**
   - Open channel on iOS and VS Code
   - See both users online
   - Start typing → See typing indicator

7. **Offline/Online**
   - Put phone in airplane mode
   - Messages queue locally
   - Restore connection → Messages sync

---

## Part 13: Implementation Checklist

### Phase 1: Foundation
- [ ] Add supabase-swift package to Xcode project
- [ ] Create `Config.swift` with Supabase credentials
- [ ] Create `SupabaseService.swift` singleton
- [ ] Add URL scheme to Info.plist
- [ ] Update `VibeChannelApp.swift` with onOpenURL

### Phase 2: Models
- [ ] Create `User.swift`
- [ ] Create `Repo.swift`
- [ ] Update `Channel.swift`
- [ ] Update `Message.swift`
- [ ] Create `Presence.swift`
- [ ] Create `UnreadCount.swift`
- [ ] Create `UserRepo.swift`

### Phase 3: Services
- [ ] Create `AuthService.swift`
- [ ] Create `MessageService.swift`
- [ ] Create `ChannelService.swift`
- [ ] Create `RepoService.swift`
- [ ] Create `RealtimeService.swift`
- [ ] Create `PresenceService.swift`

### Phase 4: Views
- [ ] Update `LoginView.swift`
- [ ] Update `ContentView.swift`
- [ ] Update `MainView.swift` (major refactor)
- [ ] Update `ChatView.swift`
- [ ] Update `MessageBubble.swift`
- [ ] Update `ChannelSidebar.swift`
- [ ] Update `MessageInput.swift`

### Phase 5: Cleanup
- [ ] Delete `GitHubAuthService.swift`
- [ ] Delete `GitHubAPIClient.swift`
- [ ] Delete `MessageParser.swift`
- [ ] Delete `SyncService.swift`
- [ ] Delete `MessageRepository.swift`
- [ ] Delete `GitHubUser.swift`
- [ ] Delete `Repository.swift`
- [ ] Remove SwiftData imports if not needed

### Phase 6: Testing
- [ ] Test sign in flow
- [ ] Test sign out flow
- [ ] Test session restore
- [ ] Test repo listing
- [ ] Test channel listing
- [ ] Test message sending
- [ ] Test realtime message receiving
- [ ] Test presence/typing
- [ ] Test unread counts
- [ ] Test offline handling

### Phase 7: Polish
- [ ] Add loading states
- [ ] Add error handling UI
- [ ] Add empty states
- [ ] Test on device
- [ ] Profile performance

---

## Appendix A: Database Schema Reference

```sql
-- Users (auto-created via trigger on auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  github_id BIGINT UNIQUE,
  github_login TEXT NOT NULL,
  github_name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Repos (created by GitHub App webhook)
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  github_installation_id BIGINT NOT NULL,
  github_repo_id BIGINT UNIQUE NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT UNIQUE NOT NULL,
  default_branch TEXT DEFAULT 'main',
  vibechannel_branch TEXT DEFAULT 'vibechannel',
  vibechannel_initialized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-Repo Access
CREATE TABLE user_repos (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, repo_id)
);

-- Channels
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (repo_id, name)
);

-- Messages (cache, synced to Git)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  sender_user_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  reply_to_id UUID REFERENCES messages(id),
  reply_to_path TEXT,
  tags TEXT[],
  github_path TEXT NOT NULL,
  github_sha TEXT,
  github_synced BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (channel_id, github_path)
);

-- Presence (transient)
CREATE TABLE presence (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'online' CHECK (status IN ('online', 'away', 'typing', 'offline')),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- Unread Counts (transient)
CREATE TABLE unread_counts (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  last_read_message_id UUID REFERENCES messages(id),
  last_read_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);
```

---

## Appendix B: Supabase Swift SDK Examples

### Authentication

```swift
// Sign in with OAuth
try await supabase.auth.signInWithOAuth(provider: .github)

// Handle callback
try await supabase.auth.session(from: callbackURL)

// Get current user
let user = supabase.auth.currentUser

// Sign out
try await supabase.auth.signOut()
```

### Database Queries

```swift
// Select all
let channels: [Channel] = try await supabase.database
    .from("channels")
    .select()
    .execute()
    .value

// Select with filter
let messages: [Message] = try await supabase.database
    .from("messages")
    .select()
    .eq("channel_id", value: channelId)
    .order("created_at", ascending: true)
    .limit(100)
    .execute()
    .value

// Insert
let newMessage: Message = try await supabase.database
    .from("messages")
    .insert(messageData)
    .select()
    .single()
    .execute()
    .value

// Update
try await supabase.database
    .from("messages")
    .update(["content": newContent])
    .eq("id", value: messageId)
    .execute()

// Delete
try await supabase.database
    .from("messages")
    .delete()
    .eq("id", value: messageId)
    .execute()

// Call RPC function
try await supabase.database
    .rpc("mark_channel_read", params: ["p_channel_id": channelId])
    .execute()
```

### Realtime Subscriptions

```swift
// Subscribe to table changes
let channel = supabase.realtime.channel("messages")

channel.onPostgresChange(
    event: .insert,
    schema: "public",
    table: "messages",
    filter: "channel_id=eq.\(channelId)"
) { payload in
    let message = try? payload.decodeRecord(as: Message.self)
    // Handle new message
}

await channel.subscribe()

// Unsubscribe
await channel.unsubscribe()
```

### Presence

```swift
let channel = supabase.realtime.channel("room:lobby")

channel.onPresenceSync { presences in
    // All current presences
}

channel.onPresenceJoin { key, presence in
    // User joined
}

channel.onPresenceLeave { key, presence in
    // User left
}

await channel.subscribe()
await channel.track(["user_id": myUserId, "status": "online"])
```

---

**End of Implementation Plan**
