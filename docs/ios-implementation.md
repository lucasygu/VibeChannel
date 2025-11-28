# VibeChannel iOS Implementation

> A complete technical specification for building an iOS client that is 100% compatible with the VSCode extension.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Principle: Same Data, Different Transport](#core-principle-same-data-different-transport)
3. [Data Models](#data-models)
4. [GitHub Authentication](#github-authentication)
5. [GitHub API Mapping](#github-api-mapping)
6. [Real-Time Updates](#real-time-updates)
7. [Local Caching & Offline Support](#local-caching--offline-support)
8. [UI/UX Design (Slack-like)](#uiux-design-slack-like)
9. [Implementation Phases](#implementation-phases)
10. [API Reference](#api-reference)

---

## Architecture Overview

### Zero Backend Architecture

**Key Decision:** The iOS app is a pure GitHub client with **no backend server**.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                        GitHub Repository                             │
│                      (lucasygu/team-chat)                            │
│                                                                      │
│     ┌───────────────────────────────────────────────────────┐       │
│     │  general/                                              │       │
│     │    ├── schema.md                                       │       │
│     │    ├── 20250115T103045-alice-abc123.md                 │       │
│     │    └── 20250115T103122-bob-def456.md                   │       │
│     │  random/                                               │       │
│     │    └── ...                                             │       │
│     └───────────────────────────────────────────────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                    ▲                           ▲
                    │                           │
          Direct Git                    Direct GitHub API
                    │                           │
         ┌──────────┴──────────┐     ┌──────────┴──────────┐
         │   VSCode Extension   │     │      iOS App        │
         │                      │     │                     │
         │  • Local Git         │     │  • GitHub REST API  │
         │  • File watcher      │     │  • Foreground poll  │
         │  • Always instant    │     │  • Background fetch │
         └──────────────────────┘     └─────────────────────┘

                         NO BACKEND SERVER
                         NO WEBHOOKS
                         NO PUSH NOTIFICATIONS
                         NO DATABASE
                         NO INFRASTRUCTURE
```

### Why No Backend?

| Aspect | With Backend | Without Backend |
|--------|--------------|-----------------|
| Infrastructure | Webhook server, database, APNs | None |
| Cost | Server hosting, maintenance | $0 |
| Security concerns | Token storage, access verification | None (GitHub handles it) |
| Complexity | High | Low |
| Update latency (foreground) | Instant | 5-10 seconds |
| Update latency (background) | Instant | 15-60 min (iOS controlled) |

**Tradeoff:** No instant background notifications, but dramatically simpler architecture.

### Two Clients, Same Protocol

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GitHub Repository                             │
│                    (lucasygu/team-chat)                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  general/                                                    │    │
│  │    ├── schema.md                                             │    │
│  │    ├── 20250115T103045-alice-abc123.md                       │    │
│  │    └── 20250115T103122-bob-def456.md                         │    │
│  │  random/                                                     │    │
│  │    ├── schema.md                                             │    │
│  │    └── ...                                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                    ▲                           ▲
                    │                           │
         ┌──────────┴──────────┐     ┌──────────┴──────────┐
         │   VSCode Extension   │     │      iOS App        │
         │                      │     │                     │
         │  ┌────────────────┐  │     │  ┌───────────────┐  │
         │  │  Git Worktree  │  │     │  │  GitHub API   │  │
         │  │  (Local Files) │  │     │  │  (REST/HTTP)  │  │
         │  └────────────────┘  │     │  └───────────────┘  │
         │         │            │     │         │           │
         │         ▼            │     │         ▼           │
         │  ┌────────────────┐  │     │  ┌───────────────┐  │
         │  │ File Watcher   │  │     │  │   Polling     │  │
         │  │ (Real-time)    │  │     │  │ (Foreground)  │  │
         │  └────────────────┘  │     │  └───────────────┘  │
         │         │            │     │         │           │
         │         ▼            │     │         ▼           │
         │  ┌────────────────┐  │     │  ┌───────────────┐  │
         │  │ Chat Webview   │  │     │  │ SwiftUI View  │  │
         │  └────────────────┘  │     │  └───────────────┘  │
         └──────────────────────┘     └─────────────────────┘
```

### Key Insight

The **message file format is the protocol**. Both clients:
- Read the same markdown files
- Parse the same YAML frontmatter
- Render the same content
- Produce identical commits

The only difference is the **transport mechanism**:
- VSCode: Local filesystem + Git CLI
- iOS: GitHub REST API (which creates commits on GitHub's servers)

---

## Core Principle: Same Data, Different Transport

### Message File Format (Identical)

**Filename:** `{YYYYMMDDTHHMMSS}-{sender}-{6-char-id}.md`

```markdown
---
from: lucasygu
date: 2025-01-15T10:30:45Z
reply_to: optional-filename.md  # optional
tags: [optional, tags]          # optional
edited: 2025-01-15T10:35:00Z    # optional
---

Message content in **markdown**.
```

### What VSCode Does

```typescript
// 1. Write file to local worktree
fs.writeFileSync(filepath, content);

// 2. Git add + commit
await gitService.commitChanges(`Message from ${sender}`);

// 3. Push to remote
await syncService.queuePush();
```

### What iOS Does (Equivalent)

```swift
// 1. Create file via GitHub API (includes commit)
let response = try await github.createFile(
    repo: "lucasygu/team-chat",
    path: "general/\(filename)",
    content: content.base64Encoded,
    message: "Message from \(sender)",
    branch: "main"
)
// Response includes the commit SHA - identical result!
```

**The result is exactly the same**: A commit in the repository with the message file.

---

## Data Models

### Swift Models (Matching TypeScript Exactly)

```swift
// MARK: - Message (matches extension/src/messageParser.ts)

struct Message: Identifiable, Codable {
    let id: String           // filename without .md
    let filename: String     // Full filename: 20250115T103045-alice-abc123.md
    let from: String         // Sender username
    let date: Date           // ISO 8601 timestamp
    let replyTo: String?     // Optional: filename of parent message
    let tags: [String]?      // Optional: array of tags
    let edited: Date?        // Optional: last edit timestamp
    let content: String      // Markdown content (body after frontmatter)
    let rawContent: String   // Full file content including frontmatter
}

// MARK: - ParseError (matches extension/src/messageParser.ts)

struct ParseError: Identifiable {
    let id: String           // filename
    let filename: String
    let error: String
}

// MARK: - SchemaConfig (matches extension/src/schemaParser.ts)

struct SchemaConfig: Codable {
    struct Metadata: Codable {
        let name: String
        let description: String?
        let created: String?
        let version: String?
    }

    struct Rendering: Codable {
        let sortBy: String      // "date"
        let order: SortOrder    // "ascending" | "descending"
        let groupBy: String?    // "date"
        let timestampDisplay: TimestampDisplay?  // "relative" | "absolute"
    }

    struct Participant: Codable {
        let name: String
        let displayName: String?
    }

    enum SortOrder: String, Codable {
        case ascending
        case descending
    }

    enum TimestampDisplay: String, Codable {
        case relative
        case absolute
    }

    let metadata: Metadata
    let filenamePattern: String      // "{timestamp}-{sender}-{id}.md"
    let timestampFormat: String      // "%Y%m%dT%H%M%S"
    let idLength: Int                // 6
    let idCharset: String            // "a-z0-9"
    let requiredFields: [FieldDef]
    let optionalFields: [FieldDef]
    let rendering: Rendering
    let participants: [Participant]
}

struct FieldDef: Codable {
    let name: String
    let type: String
    let description: String?
}

// MARK: - Conversation (matches extension/src/conversationLoader.ts)

struct Conversation {
    let folderPath: String           // "general" or "random"
    let schema: SchemaConfig
    let messages: [Message]
    let errors: [ParseError]
    let grouped: [String: [Message]] // Date string -> messages
}

// MARK: - Channel

struct Channel: Identifiable {
    let id: String      // folder name: "general"
    let name: String    // display name: "general"
    var unreadCount: Int = 0
}

// MARK: - GitHub User (matches extension/src/githubAuth.ts)

struct GitHubUser: Codable {
    let login: String           // "lucasygu"
    let name: String?           // "Lucas Gu"
    let avatarUrl: String       // "https://avatars.githubusercontent.com/..."
    var accessToken: String     // OAuth token
}
```

### Filename Parsing (Identical Logic)

```swift
// MARK: - Filename Parser (matches parseFilename in messageParser.ts)

struct FilenameComponents {
    let timestamp: String    // "20250115T103045"
    let sender: String       // "alice"
    let id: String           // "abc123"
}

func parseFilename(_ filename: String) -> FilenameComponents? {
    // Remove .md extension
    let baseName = filename.replacingOccurrences(of: ".md", with: "", options: .caseInsensitive)

    // Match pattern: YYYYMMDDTHHMMSS-sender-id
    let pattern = #"^(\d{8}T\d{6})-([a-z0-9]+)-([a-z0-9]+)$"#
    guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
          let match = regex.firstMatch(in: baseName, range: NSRange(baseName.startIndex..., in: baseName)),
          match.numberOfRanges == 4 else {
        return nil
    }

    return FilenameComponents(
        timestamp: String(baseName[Range(match.range(at: 1), in: baseName)!]),
        sender: String(baseName[Range(match.range(at: 2), in: baseName)!]),
        id: String(baseName[Range(match.range(at: 3), in: baseName)!])
    )
}

// MARK: - Timestamp Parsing (matches parseTimestamp in messageParser.ts)

func parseTimestamp(_ timestamp: String) -> Date? {
    // Format: YYYYMMDDTHHMMSS
    let pattern = #"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$"#
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: timestamp, range: NSRange(timestamp.startIndex..., in: timestamp)),
          match.numberOfRanges == 7 else {
        return nil
    }

    var components = DateComponents()
    components.year = Int(String(timestamp[Range(match.range(at: 1), in: timestamp)!]))
    components.month = Int(String(timestamp[Range(match.range(at: 2), in: timestamp)!]))
    components.day = Int(String(timestamp[Range(match.range(at: 3), in: timestamp)!]))
    components.hour = Int(String(timestamp[Range(match.range(at: 4), in: timestamp)!]))
    components.minute = Int(String(timestamp[Range(match.range(at: 5), in: timestamp)!]))
    components.second = Int(String(timestamp[Range(match.range(at: 6), in: timestamp)!]))

    return Calendar.current.date(from: components)
}

// MARK: - Message File Filter (matches isMessageFile in messageParser.ts)

func isMessageFile(_ filename: String) -> Bool {
    let lowerFilename = filename.lowercased()
    return filename.hasSuffix(".md") &&
           lowerFilename != "schema.md" &&
           lowerFilename != "agent.md" &&
           lowerFilename != "readme.md"
}
```

### YAML Frontmatter Parsing

```swift
import Yams  // Swift YAML parser

func parseMessage(filename: String, content: String) -> Result<Message, ParseError> {
    // Split frontmatter from content
    let parts = content.components(separatedBy: "---")
    guard parts.count >= 3 else {
        return .failure(ParseError(id: filename, filename: filename, error: "Invalid frontmatter format"))
    }

    let yamlString = parts[1]
    let markdownContent = parts.dropFirst(2).joined(separator: "---").trimmingCharacters(in: .whitespacesAndNewlines)

    // Parse YAML
    guard let yaml = try? Yams.load(yaml: yamlString) as? [String: Any] else {
        return .failure(ParseError(id: filename, filename: filename, error: "Failed to parse YAML frontmatter"))
    }

    // Validate required fields
    guard let from = yaml["from"] as? String else {
        return .failure(ParseError(id: filename, filename: filename, error: "Missing required field: from"))
    }

    guard let dateString = yaml["date"] as? String,
          let date = ISO8601DateFormatter().date(from: dateString) else {
        return .failure(ParseError(id: filename, filename: filename, error: "Missing or invalid required field: date"))
    }

    // Parse optional fields
    let replyTo = yaml["reply_to"] as? String
    let edited: Date? = (yaml["edited"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }

    var tags: [String]? = nil
    if let tagsArray = yaml["tags"] as? [String] {
        tags = tagsArray
    } else if let tagsString = yaml["tags"] as? String {
        tags = tagsString.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    return .success(Message(
        id: filename.replacingOccurrences(of: ".md", with: ""),
        filename: filename,
        from: from,
        date: date,
        replyTo: replyTo,
        tags: tags,
        edited: edited,
        content: markdownContent,
        rawContent: content
    ))
}
```

---

## GitHub Authentication

### OAuth 2.0 for iOS

Two approaches are available:

#### Option 1: Web-Based OAuth (Recommended)

Uses `ASWebAuthenticationSession` for a secure OAuth flow.

```swift
import AuthenticationServices

class GitHubAuthService: NSObject, ASWebAuthenticationPresentationContextProviding {

    // Register your app at https://github.com/settings/developers
    private let clientId = "YOUR_GITHUB_OAUTH_CLIENT_ID"
    private let clientSecret = "YOUR_GITHUB_OAUTH_CLIENT_SECRET"  // Store securely!
    private let redirectUri = "vibechannel://oauth/callback"
    private let scope = "read:user repo"  // repo scope needed for private repos

    func signIn() async throws -> GitHubUser {
        let authUrl = URL(string: "https://github.com/login/oauth/authorize?client_id=\(clientId)&redirect_uri=\(redirectUri)&scope=\(scope)")!

        let callbackUrl = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authUrl,
                callbackURLScheme: "vibechannel"
            ) { callbackURL, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let callbackURL = callbackURL {
                    continuation.resume(returning: callbackURL)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }

        // Extract code from callback URL
        guard let code = URLComponents(url: callbackUrl, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value else {
            throw AuthError.missingCode
        }

        // Exchange code for access token
        let token = try await exchangeCodeForToken(code)

        // Fetch user info
        var user = try await fetchUserInfo(token: token)
        user.accessToken = token

        // Store in Keychain
        try KeychainService.shared.store(user: user)

        return user
    }

    private func exchangeCodeForToken(_ code: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://github.com/login/oauth/access_token")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = [
            "client_id": clientId,
            "client_secret": clientSecret,
            "code": code
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(TokenResponse.self, from: data)

        return response.accessToken
    }

    private func fetchUserInfo(token: String) async throws -> GitHubUser {
        var request = URLRequest(url: URL(string: "https://api.github.com/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("VibeChannel-iOS", forHTTPHeaderField: "User-Agent")

        let (data, _) = try await URLSession.shared.data(for: request)
        let userData = try JSONDecoder().decode(GitHubUserResponse.self, from: data)

        return GitHubUser(
            login: userData.login,
            name: userData.name,
            avatarUrl: userData.avatarUrl,
            accessToken: token
        )
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}
```

#### Option 2: Device Flow (Better for CLI-like UX)

No redirect needed - user enters code on github.com.

```swift
class GitHubDeviceFlow {
    private let clientId = "YOUR_GITHUB_OAUTH_CLIENT_ID"

    struct DeviceCodeResponse: Codable {
        let deviceCode: String
        let userCode: String
        let verificationUri: String
        let expiresIn: Int
        let interval: Int

        enum CodingKeys: String, CodingKey {
            case deviceCode = "device_code"
            case userCode = "user_code"
            case verificationUri = "verification_uri"
            case expiresIn = "expires_in"
            case interval
        }
    }

    func startDeviceFlow() async throws -> DeviceCodeResponse {
        var request = URLRequest(url: URL(string: "https://github.com/login/device/code")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["client_id": clientId, "scope": "read:user repo"]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(DeviceCodeResponse.self, from: data)
    }

    func pollForToken(deviceCode: String, interval: Int) async throws -> String {
        while true {
            try await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000_000)

            var request = URLRequest(url: URL(string: "https://github.com/login/oauth/access_token")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")

            let body = [
                "client_id": clientId,
                "device_code": deviceCode,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            ]
            request.httpBody = try JSONEncoder().encode(body)

            let (data, _) = try await URLSession.shared.data(for: request)

            if let tokenResponse = try? JSONDecoder().decode(TokenResponse.self, from: data) {
                return tokenResponse.accessToken
            }

            // Check for error (authorization_pending means keep polling)
            let errorResponse = try JSONDecoder().decode(DeviceFlowError.self, from: data)
            if errorResponse.error != "authorization_pending" {
                throw AuthError.deviceFlowFailed(errorResponse.error)
            }
        }
    }
}
```

### Token Storage (Keychain)

```swift
import Security

class KeychainService {
    static let shared = KeychainService()

    private let service = "com.vibechannel.ios"
    private let account = "github_user"

    func store(user: GitHubUser) throws {
        let data = try JSONEncoder().encode(user)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data
        ]

        SecItemDelete(query as CFDictionary)  // Remove existing

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unableToStore
        }
    }

    func retrieveUser() -> GitHubUser? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let user = try? JSONDecoder().decode(GitHubUser.self, from: data) else {
            return nil
        }

        return user
    }

    func deleteUser() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

---

## GitHub API Mapping

### VSCode Operations → GitHub API

| VSCode Operation | GitHub API Equivalent |
|-----------------|----------------------|
| `fs.readdirSync(folder)` | `GET /repos/:owner/:repo/contents/:path` |
| `fs.readFileSync(file)` | `GET /repos/:owner/:repo/contents/:path` (returns base64 content) |
| `fs.writeFileSync(file)` + git commit | `PUT /repos/:owner/:repo/contents/:path` (creates commit) |
| `fs.unlinkSync(file)` + git commit | `DELETE /repos/:owner/:repo/contents/:path` (creates commit) |
| `git log` | `GET /repos/:owner/:repo/commits` |
| `git pull` | `GET /repos/:owner/:repo/contents/:path` (always latest) |
| File watcher | Polling `GET /repos/:owner/:repo/commits` or webhooks |

### GitHub API Client

```swift
class GitHubAPIClient {
    private let baseURL = "https://api.github.com"
    private let session = URLSession.shared
    private var accessToken: String

    init(accessToken: String) {
        self.accessToken = accessToken
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        var request = URLRequest(url: URL(string: "\(baseURL)\(path)")!)
        request.httpMethod = method
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("VibeChannel-iOS/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")

        if let body = body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              200..<300 ~= httpResponse.statusCode else {
            throw GitHubAPIError.requestFailed(response)
        }

        return data
    }

    // MARK: - List Channels (Directories)

    func listChannels(owner: String, repo: String) async throws -> [Channel] {
        let data = try await request("/repos/\(owner)/\(repo)/contents")
        let items = try JSONDecoder().decode([GitHubContentItem].self, from: data)

        return items
            .filter { $0.type == "dir" && !$0.name.hasPrefix(".") }
            .map { Channel(id: $0.name, name: $0.name) }
    }

    // MARK: - List Messages in Channel

    func listMessages(owner: String, repo: String, channel: String) async throws -> [GitHubContentItem] {
        let data = try await request("/repos/\(owner)/\(repo)/contents/\(channel)")
        let items = try JSONDecoder().decode([GitHubContentItem].self, from: data)

        return items.filter { isMessageFile($0.name) }
    }

    // MARK: - Get File Content

    func getFileContent(owner: String, repo: String, path: String) async throws -> String {
        let data = try await request("/repos/\(owner)/\(repo)/contents/\(path)")
        let item = try JSONDecoder().decode(GitHubContentItem.self, from: data)

        guard let content = item.content,
              let decoded = Data(base64Encoded: content.replacingOccurrences(of: "\n", with: "")),
              let string = String(data: decoded, encoding: .utf8) else {
            throw GitHubAPIError.invalidContent
        }

        return string
    }

    // MARK: - Create Message (Equivalent to git add + commit + push)

    func createMessage(
        owner: String,
        repo: String,
        channel: String,
        filename: String,
        content: String,
        commitMessage: String,
        branch: String = "main"
    ) async throws -> GitHubCommitResponse {
        let path = "\(channel)/\(filename)"

        let body: [String: Any] = [
            "message": commitMessage,
            "content": Data(content.utf8).base64EncodedString(),
            "branch": branch
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let data = try await request("/repos/\(owner)/\(repo)/contents/\(path)", method: "PUT", body: jsonData)

        return try JSONDecoder().decode(GitHubCommitResponse.self, from: data)
    }

    // MARK: - Update Message (Edit)

    func updateMessage(
        owner: String,
        repo: String,
        channel: String,
        filename: String,
        content: String,
        sha: String,  // Required: current file SHA
        commitMessage: String,
        branch: String = "main"
    ) async throws -> GitHubCommitResponse {
        let path = "\(channel)/\(filename)"

        let body: [String: Any] = [
            "message": commitMessage,
            "content": Data(content.utf8).base64EncodedString(),
            "sha": sha,
            "branch": branch
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let data = try await request("/repos/\(owner)/\(repo)/contents/\(path)", method: "PUT", body: jsonData)

        return try JSONDecoder().decode(GitHubCommitResponse.self, from: data)
    }

    // MARK: - Delete Message

    func deleteMessage(
        owner: String,
        repo: String,
        channel: String,
        filename: String,
        sha: String,
        commitMessage: String,
        branch: String = "main"
    ) async throws {
        let path = "\(channel)/\(filename)"

        let body: [String: Any] = [
            "message": commitMessage,
            "sha": sha,
            "branch": branch
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: body)
        _ = try await request("/repos/\(owner)/\(repo)/contents/\(path)", method: "DELETE", body: jsonData)
    }

    // MARK: - Get Latest Commits (For Polling)

    func getCommits(owner: String, repo: String, path: String? = nil, since: Date? = nil) async throws -> [GitHubCommit] {
        var queryItems: [String] = []
        if let path = path {
            queryItems.append("path=\(path)")
        }
        if let since = since {
            queryItems.append("since=\(ISO8601DateFormatter().string(from: since))")
        }

        let query = queryItems.isEmpty ? "" : "?\(queryItems.joined(separator: "&"))"
        let data = try await request("/repos/\(owner)/\(repo)/commits\(query)")

        return try JSONDecoder().decode([GitHubCommit].self, from: data)
    }

    // MARK: - Get Repository Info

    func getRepository(owner: String, repo: String) async throws -> GitHubRepository {
        let data = try await request("/repos/\(owner)/\(repo)")
        return try JSONDecoder().decode(GitHubRepository.self, from: data)
    }

    // MARK: - Create Channel (Directory with .gitkeep)

    func createChannel(
        owner: String,
        repo: String,
        channelName: String,
        branch: String = "main"
    ) async throws {
        // GitHub doesn't support empty directories, so create with a .gitkeep file
        let path = "\(channelName)/.gitkeep"

        let body: [String: Any] = [
            "message": "Create #\(channelName) channel",
            "content": Data("".utf8).base64EncodedString(),
            "branch": branch
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: body)
        _ = try await request("/repos/\(owner)/\(repo)/contents/\(path)", method: "PUT", body: jsonData)
    }
}

// MARK: - Response Models

struct GitHubContentItem: Codable {
    let name: String
    let path: String
    let sha: String
    let type: String  // "file" or "dir"
    let content: String?  // base64 encoded, only for files
    let encoding: String?
}

struct GitHubCommit: Codable {
    let sha: String
    let commit: CommitDetails

    struct CommitDetails: Codable {
        let message: String
        let author: Author
        let committer: Author
    }

    struct Author: Codable {
        let name: String
        let email: String
        let date: String
    }
}

struct GitHubCommitResponse: Codable {
    let content: GitHubContentItem
    let commit: GitHubCommit
}

struct GitHubRepository: Codable {
    let id: Int
    let name: String
    let fullName: String
    let `private`: Bool
    let defaultBranch: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case fullName = "full_name"
        case `private`
        case defaultBranch = "default_branch"
    }
}
```

---

## Real-Time Updates

### No Backend = Polling Only

Since we're not running a backend server, updates happen through:
1. **Foreground polling** - When app is on screen
2. **Background App Refresh** - When iOS decides (15-60 min)
3. **Manual refresh** - Pull-to-refresh

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Update Methods                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────┐                                                   │
│   │   App Open      │ ──▶ Poll GitHub API every 5-10 seconds            │
│   │   (Foreground)  │     Works perfectly ✓                             │
│   └─────────────────┘                                                   │
│                                                                          │
│   ┌─────────────────┐                                                   │
│   │   App in        │ ──▶ iOS Background App Refresh                    │
│   │   Background    │     iOS decides when (15-60+ min)                 │
│   └─────────────────┘     We can't control it                           │
│                                                                          │
│   ┌─────────────────┐                                                   │
│   │   App Killed    │ ──▶ Nothing until user opens app                  │
│   │                 │                                                   │
│   └─────────────────┘                                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### When Updates Happen

| App State | How Updates Work | Latency |
|-----------|------------------|---------|
| **Foreground (app open)** | Poll every 5-10 seconds | 5-10 seconds |
| **Background** | iOS Background App Refresh | 15-60 minutes (iOS decides) |
| **Killed** | Nothing | Until user opens app |
| **Manual** | Pull-to-refresh | Instant |

### This Is Fine For Async Communication

VibeChannel is designed for **asynchronous team communication** (like email), not real-time chat (like iMessage). The polling approach works well for:

- ✅ Team discussions
- ✅ Project conversations
- ✅ Async collaboration
- ❌ Urgent real-time chat (use Slack/Discord for this)

### Implementation: Foreground Polling

```swift
class SyncService: ObservableObject {
    @Published var lastSync: Date?
    @Published var isRefreshing = false

    private var pollTask: Task<Void, Never>?
    private var etag: String?
    private let pollInterval: TimeInterval = 10

    private let api: GitHubAPIClient
    private let owner: String
    private let repo: String

    // MARK: - Start/Stop (tied to app lifecycle)

    func startPolling() {
        guard pollTask == nil else { return }

        pollTask = Task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    // MARK: - Manual refresh (pull-to-refresh)

    func refresh() async {
        await MainActor.run { isRefreshing = true }

        do {
            let hasChanges = try await checkForChanges()

            if hasChanges {
                await MainActor.run {
                    NotificationCenter.default.post(name: .vibeChannelNewMessages, object: nil)
                }
            }

            await MainActor.run {
                self.lastSync = Date()
                self.isRefreshing = false
            }
        } catch {
            await MainActor.run { isRefreshing = false }
            print("Refresh error: \(error)")
        }
    }

    private func checkForChanges() async throws -> Bool {
        // Use conditional request with ETag for efficiency
        // Returns 304 Not Modified if nothing changed (saves bandwidth)
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(owner)/\(repo)/commits?per_page=1")!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(api.accessToken)", forHTTPHeaderField: "Authorization")

        if let etag = etag {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            return false
        }

        // 304 = Not Modified (no new commits, no data transferred)
        if httpResponse.statusCode == 304 {
            return false
        }

        // Update ETag for next request
        if let newEtag = httpResponse.value(forHTTPHeaderField: "ETag") {
            self.etag = newEtag
        }

        return true
    }
}

extension Notification.Name {
    static let vibeChannelNewMessages = Notification.Name("vibeChannelNewMessages")
}
```

### Implementation: App Lifecycle Integration

```swift
@main
struct VibeChannelApp: App {
    @Environment(\.scenePhase) var scenePhase
    @StateObject private var syncService = SyncService.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(syncService)
        }
        .onChange(of: scenePhase) { newPhase in
            switch newPhase {
            case .active:
                // App came to foreground - start polling
                syncService.startPolling()
            case .inactive, .background:
                // App going to background - stop polling
                syncService.stopPolling()
            @unknown default:
                break
            }
        }
    }
}
```

### Implementation: Background App Refresh (Optional)

iOS can wake your app periodically in the background. You can't control when - iOS decides based on user behavior.

```swift
// In AppDelegate
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Register for background fetch
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: "com.vibechannel.refresh",
            using: nil
        ) { task in
            self.handleBackgroundRefresh(task: task as! BGAppRefreshTask)
        }
        return true
    }

    func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: "com.vibechannel.refresh")
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)  // 15 min minimum
        try? BGTaskScheduler.shared.submit(request)
    }

    func handleBackgroundRefresh(task: BGAppRefreshTask) {
        // Schedule next refresh
        scheduleBackgroundRefresh()

        Task {
            await SyncService.shared.refresh()
            task.setTaskCompleted(success: true)
        }
    }
}
```

### Future Option: Add Push Notifications Later

If you later decide you need instant background updates, you can add a backend server. The iOS app code won't need to change much - you'd just add push notification handling alongside the existing polling.

```
Current (No Backend):
iOS App ←────────────────────────▶ GitHub API

Future (With Backend):
iOS App ←────────────────────────▶ GitHub API
    ▲
    │
    └─── Push from Backend (optional addition)
```

---

## Local Caching & Offline Support

### Cache Architecture

```swift
import CoreData

// MARK: - Cache Manager

class CacheManager {
    static let shared = CacheManager()

    private let container: NSPersistentContainer

    init() {
        container = NSPersistentContainer(name: "VibeChannelCache")
        container.loadPersistentStores { _, error in
            if let error = error {
                fatalError("Failed to load cache: \(error)")
            }
        }
    }

    // MARK: - Messages

    func cacheMessages(_ messages: [Message], for channel: String, in repo: String) {
        let context = container.viewContext

        for message in messages {
            let cached = CachedMessage(context: context)
            cached.id = message.id
            cached.filename = message.filename
            cached.from = message.from
            cached.date = message.date
            cached.replyTo = message.replyTo
            cached.tags = message.tags?.joined(separator: ",")
            cached.content = message.content
            cached.rawContent = message.rawContent
            cached.channel = channel
            cached.repo = repo
            cached.cachedAt = Date()
        }

        try? context.save()
    }

    func getCachedMessages(for channel: String, in repo: String) -> [Message] {
        let context = container.viewContext
        let request = CachedMessage.fetchRequest()
        request.predicate = NSPredicate(format: "channel == %@ AND repo == %@", channel, repo)
        request.sortDescriptors = [NSSortDescriptor(keyPath: \CachedMessage.date, ascending: true)]

        guard let cached = try? context.fetch(request) else {
            return []
        }

        return cached.map { $0.toMessage() }
    }

    // MARK: - Pending Messages (Offline Queue)

    func queuePendingMessage(_ message: PendingMessage) {
        let context = container.viewContext

        let pending = PendingMessageEntity(context: context)
        pending.id = UUID()
        pending.filename = message.filename
        pending.content = message.content
        pending.channel = message.channel
        pending.repo = message.repo
        pending.createdAt = Date()

        try? context.save()
    }

    func getPendingMessages(for repo: String) -> [PendingMessage] {
        let context = container.viewContext
        let request = PendingMessageEntity.fetchRequest()
        request.predicate = NSPredicate(format: "repo == %@", repo)
        request.sortDescriptors = [NSSortDescriptor(keyPath: \PendingMessageEntity.createdAt, ascending: true)]

        guard let pending = try? context.fetch(request) else {
            return []
        }

        return pending.map { $0.toPendingMessage() }
    }

    func removePendingMessage(id: UUID) {
        let context = container.viewContext
        let request = PendingMessageEntity.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)

        if let results = try? context.fetch(request), let entity = results.first {
            context.delete(entity)
            try? context.save()
        }
    }
}

// MARK: - Offline Message Creation

extension ChatViewModel {
    func sendMessage(_ content: String) async {
        let filename = generateFilename()
        let fullContent = generateMessageContent(content)

        // 1. Optimistically add to local state
        let optimisticMessage = Message(
            id: filename.replacingOccurrences(of: ".md", with: ""),
            filename: filename,
            from: currentUser.login,
            date: Date(),
            replyTo: nil,
            tags: nil,
            edited: nil,
            content: content,
            rawContent: fullContent
        )

        await MainActor.run {
            self.messages.append(optimisticMessage)
        }

        // 2. Try to send immediately
        do {
            try await api.createMessage(
                owner: repoOwner,
                repo: repoName,
                channel: currentChannel,
                filename: filename,
                content: fullContent,
                commitMessage: "Message from \(currentUser.login)"
            )
        } catch {
            // 3. If offline, queue for later
            CacheManager.shared.queuePendingMessage(PendingMessage(
                filename: filename,
                content: fullContent,
                channel: currentChannel,
                repo: "\(repoOwner)/\(repoName)"
            ))

            await MainActor.run {
                // Mark message as pending in UI
                if let index = self.messages.firstIndex(where: { $0.id == optimisticMessage.id }) {
                    self.messages[index].isPending = true
                }
            }
        }
    }

    func syncPendingMessages() async {
        let pending = CacheManager.shared.getPendingMessages(for: "\(repoOwner)/\(repoName)")

        for message in pending {
            do {
                try await api.createMessage(
                    owner: repoOwner,
                    repo: repoName,
                    channel: message.channel,
                    filename: message.filename,
                    content: message.content,
                    commitMessage: "Message from \(currentUser.login)"
                )
                CacheManager.shared.removePendingMessage(id: message.id)
            } catch {
                // Still offline, keep in queue
                break
            }
        }
    }
}
```

---

## UI/UX Design (Slack-like)

### Main App Structure

```swift
import SwiftUI

@main
struct VibeChannelApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            if appState.isAuthenticated {
                MainView()
                    .environmentObject(appState)
            } else {
                LoginView()
                    .environmentObject(appState)
            }
        }
    }
}

// MARK: - Main View (Slack-like Layout)

struct MainView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ChatViewModel()

    var body: some View {
        NavigationSplitView {
            // Sidebar: Channels list
            ChannelSidebar(
                channels: viewModel.channels,
                selectedChannel: $viewModel.currentChannel,
                onCreateChannel: { viewModel.showCreateChannel = true }
            )
        } detail: {
            // Main content: Chat view
            ChatView(viewModel: viewModel)
        }
        .navigationSplitViewStyle(.balanced)
    }
}

// MARK: - Channel Sidebar

struct ChannelSidebar: View {
    let channels: [Channel]
    @Binding var selectedChannel: String?
    let onCreateChannel: () -> Void

    var body: some View {
        List(selection: $selectedChannel) {
            Section {
                ForEach(channels) { channel in
                    HStack {
                        Text("#")
                            .foregroundColor(.secondary)
                        Text(channel.name)
                        Spacer()
                        if channel.unreadCount > 0 {
                            Text("\(channel.unreadCount)")
                                .font(.caption)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.red)
                                .foregroundColor(.white)
                                .clipShape(Capsule())
                        }
                    }
                    .tag(channel.id)
                }
            } header: {
                HStack {
                    Text("Channels")
                    Spacer()
                    Button(action: onCreateChannel) {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("VibeChannel")
    }
}

// MARK: - Chat View

struct ChatView: View {
    @ObservedObject var viewModel: ChatViewModel
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Header
            ChatHeader(
                channelName: viewModel.currentChannel ?? "general",
                messageCount: viewModel.messages.count
            )

            Divider()

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(groupedMessages, id: \.0) { date, messages in
                            DateSeparator(date: date)

                            ForEach(messages) { message in
                                MessageBubble(message: message)
                            }
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _ in
                    if let lastMessage = viewModel.messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Input
            MessageInput(
                text: $viewModel.inputText,
                channelName: viewModel.currentChannel ?? "general",
                onSend: viewModel.sendMessage
            )
            .focused($isInputFocused)
        }
    }

    private var groupedMessages: [(String, [Message])] {
        let grouped = Dictionary(grouping: viewModel.messages) { message in
            formatDateKey(message.date)
        }
        return grouped.sorted { $0.key < $1.key }
    }

    private func formatDateKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Avatar
            AsyncImage(url: URL(string: "https://github.com/\(message.from).png")) { image in
                image.resizable()
            } placeholder: {
                Circle().fill(.gray.opacity(0.3))
            }
            .frame(width: 36, height: 36)
            .clipShape(RoundedRectangle(cornerRadius: 4))

            VStack(alignment: .leading, spacing: 4) {
                // Header
                HStack(spacing: 8) {
                    Text(message.from)
                        .font(.headline)
                        .foregroundColor(senderColor(for: message.from))

                    Text(formatTimestamp(message.date))
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if message.isPending {
                        Image(systemName: "clock")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                // Content (Markdown)
                MarkdownView(content: message.content)

                // Tags
                if let tags = message.tags, !tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.2))
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 4)
        .background(Color.clear)
        .contentShape(Rectangle())
    }

    private func senderColor(for sender: String) -> Color {
        let colors: [Color] = [.blue, .green, .orange, .pink, .purple, .teal]
        var hash = 0
        for char in sender.unicodeScalars {
            hash = ((hash << 5) &- hash) &+ Int(char.value)
        }
        return colors[abs(hash) % colors.count]
    }

    private func formatTimestamp(_ date: Date) -> String {
        let now = Date()
        let diff = now.timeIntervalSince(date)

        if diff < 60 { return "just now" }
        if diff < 3600 { return "\(Int(diff / 60))m ago" }
        if diff < 86400 { return "\(Int(diff / 3600))h ago" }
        if diff < 604800 { return "\(Int(diff / 86400))d ago" }

        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: date)
    }
}

// MARK: - Message Input

struct MessageInput: View {
    @Binding var text: String
    let channelName: String
    let onSend: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            TextField("Message #\(channelName)", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .onSubmit {
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onSend()
                    }
                }

            Button(action: onSend) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding()
    }
}

// MARK: - Date Separator

struct DateSeparator: View {
    let date: String

    var body: some View {
        HStack {
            VStack { Divider() }
            Text(formatDateDisplay(date))
                .font(.caption)
                .foregroundColor(.secondary)
            VStack { Divider() }
        }
        .padding(.vertical, 8)
    }

    private func formatDateDisplay(_ dateStr: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"

        guard let date = formatter.date(from: dateStr) else {
            return dateStr
        }

        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Today"
        }
        if calendar.isDateInYesterday(date) {
            return "Yesterday"
        }

        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "EEEE, MMMM d"
        return displayFormatter.string(from: date)
    }
}
```

---

## Implementation Phases

### Phase 1: Core MVP (2 weeks)

- [ ] GitHub OAuth authentication
- [ ] List repositories (user's repos with VibeChannel format)
- [ ] List channels within a repository
- [ ] Display messages in a channel
- [ ] Send new messages
- [ ] Foreground polling for updates
- [ ] Pull-to-refresh

> **This is a fully functional app!** No backend required.

### Phase 2: Polish & UX (2 weeks)

- [ ] Markdown rendering
- [ ] User avatars from GitHub
- [ ] ETag-based conditional polling (reduce bandwidth)
- [ ] Better error handling
- [ ] Loading states
- [ ] Empty states

### Phase 3: Offline Support (1-2 weeks)

- [ ] Local cache with CoreData
- [ ] Offline message queue (send when back online)
- [ ] Optimistic UI updates
- [ ] Background App Refresh (iOS controlled)

### Phase 4: Advanced Features (2-3 weeks)

- [ ] Create new channels
- [ ] Reply threads (reply_to support)
- [ ] Message editing
- [ ] Search messages
- [ ] Multiple repository support
- [ ] Dark mode

### Future: Push Notifications (Optional)

If you later need instant background updates:
- [ ] Set up webhook server
- [ ] APNs integration
- [ ] Device token registration

This is **optional** - the app works without it.

---

## API Reference

### Rate Limits

| Auth Type | Requests/Hour | Notes |
|-----------|--------------|-------|
| Unauthenticated | 60 | Not useful |
| OAuth Token | 5,000 | ✅ Use this |
| GitHub App | 15,000 | For future |

### Key Endpoints Used

```
# Authentication
POST https://github.com/login/oauth/authorize
POST https://github.com/login/oauth/access_token

# User Info
GET https://api.github.com/user

# Repository Contents
GET https://api.github.com/repos/:owner/:repo/contents/:path
PUT https://api.github.com/repos/:owner/:repo/contents/:path
DELETE https://api.github.com/repos/:owner/:repo/contents/:path

# Commits (for polling)
GET https://api.github.com/repos/:owner/:repo/commits

# Repository Info
GET https://api.github.com/repos/:owner/:repo
```

### Response Caching Headers

```
ETag: "abc123..."           # Use for conditional requests
X-RateLimit-Remaining: 4999 # Check before making requests
X-RateLimit-Reset: 1234567  # Unix timestamp when limit resets
```

---

## Summary

### Architecture Comparison

| Aspect | VSCode Extension | iOS App |
|--------|-----------------|---------|
| **Transport** | Local Git + Filesystem | GitHub REST API |
| **Authentication** | VSCode GitHub Provider | OAuth 2.0 (direct to GitHub) |
| **Real-time (Foreground)** | File system watcher | Polling every 5-10s |
| **Real-time (Background)** | N/A (desktop always active) | Background App Refresh (iOS controlled) |
| **Offline** | Full (local Git) | Partial (cache + queue) |
| **Message Format** | Identical | Identical |
| **Commit Result** | Same | Same |
| **UI** | Webview (HTML/CSS) | Native SwiftUI |
| **Backend Required** | No | **No** |

### Key Takeaway: Zero Backend Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   What We're NOT Building:              What We ARE Building:        │
│                                                                      │
│   ❌ Webhook server                     ✅ Pure GitHub client        │
│   ❌ Database                           ✅ Local cache only          │
│   ❌ Push notification service          ✅ Foreground polling        │
│   ❌ User management                    ✅ GitHub OAuth direct       │
│   ❌ Any backend infrastructure         ✅ Zero infrastructure       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### The Tradeoff

| With Backend | Without Backend (Our Choice) |
|--------------|------------------------------|
| Instant background updates | Updates when app is open |
| Complex infrastructure | Zero infrastructure |
| Ongoing server costs | $0 cost |
| Security concerns | GitHub handles everything |
| Maintenance burden | No maintenance |

**VibeChannel is for async communication** - the polling approach is perfect for team discussions, project conversations, and async collaboration. It's not designed to compete with real-time chat apps like Slack or iMessage.

---

The beauty of VibeChannel is that **the protocol is the file format**. Both clients produce and consume identical markdown files, making them fully interoperable. A message sent from iOS appears (after sync) on VSCode, and vice versa.

**Total infrastructure required: None. Just the iOS app talking directly to GitHub.**
