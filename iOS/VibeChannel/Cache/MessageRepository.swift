//
//  MessageRepository.swift
//  VibeChannel
//
//  Repository pattern for message data access.
//  Provides a single source of truth, reading from cache and writing through to remote.
//

import Foundation
import SwiftData

@MainActor
class MessageRepository {
    static let shared = MessageRepository()

    private var modelContainer: ModelContainer?
    private var modelContext: ModelContext?
    private var api: GitHubAPIClient?

    // Cache staleness threshold
    private let cacheMaxAge: TimeInterval = 60  // 1 minute

    private init() {}

    // MARK: - Configuration

    func configure(with token: String) throws {
        // Initialize SwiftData
        let schema = Schema([
            CachedRepository.self,
            CachedChannel.self,
            CachedMessage.self,
            RateLimitInfo.self
        ])

        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false
        )

        self.modelContainer = try ModelContainer(for: schema, configurations: [modelConfiguration])
        self.modelContext = modelContainer?.mainContext

        let apiClient = GitHubAPIClient(accessToken: token)

        // Hook into rate limit updates
        apiClient.onRateLimitUpdate = { [weak self] rateLimit in
            Task { @MainActor in
                try? self?.updateRateLimit(
                    remaining: rateLimit.remaining,
                    limit: rateLimit.limit,
                    resetDate: rateLimit.resetDate
                )
            }
        }

        self.api = apiClient
    }

    // MARK: - Repository Operations

    func getCachedRepository(owner: String, repo: String) -> CachedRepository? {
        guard let context = modelContext else { return nil }

        let id = "\(owner)/\(repo)"
        let descriptor = FetchDescriptor<CachedRepository>(
            predicate: #Predicate { $0.id == id }
        )

        return try? context.fetch(descriptor).first
    }

    func cacheRepository(_ repository: Repository) throws {
        guard let context = modelContext else { return }

        let id = "\(repository.owner)/\(repository.name)"

        // Check if exists
        let descriptor = FetchDescriptor<CachedRepository>(
            predicate: #Predicate { $0.id == id }
        )

        if let existing = try context.fetch(descriptor).first {
            // Update existing
            existing.lastSyncedAt = Date()
        } else {
            // Create new
            let cached = CachedRepository(from: repository)
            cached.lastSyncedAt = Date()
            context.insert(cached)
        }

        try context.save()
    }

    // MARK: - Channel Operations

    func getCachedChannels(owner: String, repo: String) -> [Channel] {
        guard let context = modelContext else { return [] }

        let repoId = "\(owner)/\(repo)"
        let descriptor = FetchDescriptor<CachedChannel>(
            predicate: #Predicate { $0.repositoryId == repoId },
            sortBy: [SortDescriptor(\.name)]
        )

        guard let cached = try? context.fetch(descriptor) else { return [] }
        return cached.map { Channel(id: $0.name) }
    }

    func isCacheStale(owner: String, repo: String) -> Bool {
        guard let cached = getCachedRepository(owner: owner, repo: repo),
              let lastSync = cached.lastSyncedAt else {
            return true
        }
        return Date().timeIntervalSince(lastSync) > cacheMaxAge
    }

    func fetchChannels(owner: String, repo: String, forceRefresh: Bool = false) async throws -> [Channel] {
        // Return cache if fresh
        if !forceRefresh && !isCacheStale(owner: owner, repo: repo) {
            let cached = getCachedChannels(owner: owner, repo: repo)
            if !cached.isEmpty {
                return cached
            }
        }

        // Fetch from API
        guard let api = api else { throw GitHubAPIError.unauthorized }

        let contents = try await api.listContents(owner: owner, repo: repo)
        let channels = contents
            .filter { $0.type == "dir" && !$0.name.hasPrefix(".") }
            .map { Channel(id: $0.name) }

        // Update cache
        try await cacheChannels(channels, owner: owner, repo: repo)

        return channels
    }

    private func cacheChannels(_ channels: [Channel], owner: String, repo: String) async throws {
        guard let context = modelContext else { return }

        let repoId = "\(owner)/\(repo)"

        // Get or create repository
        let repoDescriptor = FetchDescriptor<CachedRepository>(
            predicate: #Predicate { $0.id == repoId }
        )

        let cachedRepo: CachedRepository
        if let existing = try context.fetch(repoDescriptor).first {
            cachedRepo = existing
        } else {
            cachedRepo = CachedRepository(id: repoId, owner: owner, name: repo)
            context.insert(cachedRepo)
        }

        // Remove old channels that don't exist anymore
        let existingChannelIds = Set(channels.map { "\(repoId)/\($0.id)" })
        for cachedChannel in cachedRepo.channels {
            if !existingChannelIds.contains(cachedChannel.id) {
                context.delete(cachedChannel)
            }
        }

        // Add/update channels
        for channel in channels {
            let channelId = "\(repoId)/\(channel.id)"
            let channelDescriptor = FetchDescriptor<CachedChannel>(
                predicate: #Predicate { $0.id == channelId }
            )

            if try context.fetch(channelDescriptor).first == nil {
                let cached = CachedChannel(from: channel, repositoryId: repoId)
                cached.repository = cachedRepo
                context.insert(cached)
            }
        }

        cachedRepo.lastSyncedAt = Date()
        try context.save()
    }

    // MARK: - Message Operations

    func getCachedMessages(owner: String, repo: String, channel: String) -> [Message] {
        guard let context = modelContext else { return [] }

        let channelId = "\(owner)/\(repo)/\(channel)"
        let descriptor = FetchDescriptor<CachedMessage>(
            predicate: #Predicate { $0.channelId == channelId },
            sortBy: [SortDescriptor(\.date)]
        )

        guard let cached = try? context.fetch(descriptor) else { return [] }
        return cached.map { $0.toMessage() }
    }

    func fetchMessages(owner: String, repo: String, channel: String, forceRefresh: Bool = false) async throws -> [Message] {
        let channelId = "\(owner)/\(repo)/\(channel)"

        // Return cache if fresh
        if !forceRefresh {
            let channelDescriptor = FetchDescriptor<CachedChannel>(
                predicate: #Predicate { $0.id == channelId }
            )

            if let cachedChannel = try? modelContext?.fetch(channelDescriptor).first,
               let lastSync = cachedChannel.lastSyncedAt,
               Date().timeIntervalSince(lastSync) <= cacheMaxAge {
                let messages = getCachedMessages(owner: owner, repo: repo, channel: channel)
                if !messages.isEmpty {
                    return messages
                }
            }
        }

        // Fetch from API
        guard let api = api else { throw GitHubAPIError.unauthorized }

        let contents = try await api.listContents(owner: owner, repo: repo, path: channel)
        var messages: [Message] = []

        for item in contents {
            guard MessageParser.isMessageFile(item.name) else { continue }

            do {
                let (content, sha) = try await api.getFileContentString(
                    owner: owner,
                    repo: repo,
                    path: "\(channel)/\(item.name)"
                )

                let result = MessageParser.parse(filename: item.name, content: content, sha: sha)
                if case .success(let message) = result {
                    messages.append(message)
                }
            } catch {
                print("Failed to fetch \(item.name): \(error)")
            }
        }

        // Sort by date
        messages.sort { $0.date < $1.date }

        // Update cache
        try await cacheMessages(messages, channelId: channelId)

        return messages
    }

    private func cacheMessages(_ messages: [Message], channelId: String) async throws {
        guard let context = modelContext else { return }

        // Get channel
        let channelDescriptor = FetchDescriptor<CachedChannel>(
            predicate: #Predicate { $0.id == channelId }
        )

        guard let cachedChannel = try context.fetch(channelDescriptor).first else { return }

        // Keep only latest 500 messages (per design decision)
        let messagesToCache = messages.suffix(500)

        // Clear existing messages for this channel
        for existingMessage in cachedChannel.messages {
            context.delete(existingMessage)
        }

        // Add new messages
        for message in messagesToCache {
            let cached = CachedMessage(from: message, channelId: channelId)
            cached.channel = cachedChannel
            context.insert(cached)
        }

        cachedChannel.lastSyncedAt = Date()
        try context.save()
    }

    // MARK: - Write-Through Operations

    func sendMessage(
        owner: String,
        repo: String,
        channel: String,
        content: String,
        from: String,
        replyTo: String? = nil
    ) async throws -> Message {
        guard let api = api else { throw GitHubAPIError.unauthorized }

        let filename = MessageParser.generateFilename(sender: from)
        let fileContent = MessageParser.generateMessageContent(
            from: from,
            content: content,
            replyTo: replyTo
        )
        let path = "\(channel)/\(filename)"

        // Write to remote
        let response = try await api.createFile(
            owner: owner,
            repo: repo,
            path: path,
            content: fileContent,
            message: "Message from \(from)"
        )

        // Parse the created message
        guard case .success(var message) = MessageParser.parse(
            filename: filename,
            content: fileContent,
            sha: response.content.sha
        ) else {
            throw NSError(domain: "MessageRepository", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to parse sent message"
            ])
        }

        // Update local cache
        let channelId = "\(owner)/\(repo)/\(channel)"
        try await addMessageToCache(message, channelId: channelId)

        return message
    }

    func editMessage(
        owner: String,
        repo: String,
        channel: String,
        message: Message,
        newContent: String
    ) async throws -> Message {
        guard let api = api,
              let sha = message.sha else {
            throw GitHubAPIError.unauthorized
        }

        // Generate updated content with edited timestamp
        let now = Date()
        let iso8601 = ISO8601DateFormatter()
        iso8601.formatOptions = [.withInternetDateTime]

        var updatedRaw = """
        ---
        from: \(message.from)
        date: \(iso8601.string(from: message.date))
        edited: \(iso8601.string(from: now))
        """

        if let replyTo = message.replyTo {
            updatedRaw += "\nreply_to: \(replyTo)"
        }

        if let tags = message.tags, !tags.isEmpty {
            updatedRaw += "\ntags: [\(tags.joined(separator: ", "))]"
        }

        updatedRaw += "\n---\n\n\(newContent)"

        // Update on remote
        let response = try await api.updateFile(
            owner: owner,
            repo: repo,
            path: "\(channel)/\(message.filename)",
            content: updatedRaw,
            sha: sha,
            message: "Edit message"
        )

        // Create updated message
        let updatedMessage = Message(
            id: message.id,
            filename: message.filename,
            from: message.from,
            date: message.date,
            replyTo: message.replyTo,
            tags: message.tags,
            edited: now,
            content: newContent,
            rawContent: updatedRaw,
            sha: response.content.sha,
            files: message.files,
            images: message.images,
            attachments: message.attachments
        )

        // Update cache
        let channelId = "\(owner)/\(repo)/\(channel)"
        try await updateMessageInCache(updatedMessage, channelId: channelId)

        return updatedMessage
    }

    func deleteMessage(
        owner: String,
        repo: String,
        channel: String,
        message: Message
    ) async throws {
        guard let api = api,
              let sha = message.sha else {
            throw GitHubAPIError.unauthorized
        }

        // Delete on remote
        try await api.deleteFile(
            owner: owner,
            repo: repo,
            path: "\(channel)/\(message.filename)",
            sha: sha,
            message: "Delete message"
        )

        // Remove from cache
        let channelId = "\(owner)/\(repo)/\(channel)"
        try await removeMessageFromCache(message.id, channelId: channelId)
    }

    // MARK: - Cache Helpers

    private func addMessageToCache(_ message: Message, channelId: String) async throws {
        guard let context = modelContext else { return }

        let channelDescriptor = FetchDescriptor<CachedChannel>(
            predicate: #Predicate { $0.id == channelId }
        )

        guard let cachedChannel = try context.fetch(channelDescriptor).first else { return }

        let cached = CachedMessage(from: message, channelId: channelId)
        cached.channel = cachedChannel
        context.insert(cached)

        try context.save()
    }

    private func updateMessageInCache(_ message: Message, channelId: String) async throws {
        guard let context = modelContext else { return }

        let descriptor = FetchDescriptor<CachedMessage>(
            predicate: #Predicate { $0.id == message.id && $0.channelId == channelId }
        )

        if let existing = try context.fetch(descriptor).first {
            existing.content = message.content
            existing.rawContent = message.rawContent
            existing.edited = message.edited
            existing.sha = message.sha
            try context.save()
        }
    }

    private func removeMessageFromCache(_ messageId: String, channelId: String) async throws {
        guard let context = modelContext else { return }

        let descriptor = FetchDescriptor<CachedMessage>(
            predicate: #Predicate { $0.id == messageId && $0.channelId == channelId }
        )

        if let existing = try context.fetch(descriptor).first {
            context.delete(existing)
            try context.save()
        }
    }

    // MARK: - Rate Limit Tracking

    func updateRateLimit(remaining: Int, limit: Int, resetDate: Date?) throws {
        guard let context = modelContext else { return }

        let descriptor = FetchDescriptor<RateLimitInfo>()
        let info: RateLimitInfo

        if let existing = try context.fetch(descriptor).first {
            info = existing
        } else {
            info = RateLimitInfo()
            context.insert(info)
        }

        info.remaining = remaining
        info.limit = limit
        info.resetDate = resetDate
        info.lastUpdated = Date()

        try context.save()
    }

    func getRateLimitInfo() -> RateLimitInfo? {
        guard let context = modelContext else { return nil }
        return try? context.fetch(FetchDescriptor<RateLimitInfo>()).first
    }
}
