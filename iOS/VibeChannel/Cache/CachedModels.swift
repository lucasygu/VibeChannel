//
//  CachedModels.swift
//  VibeChannel
//
//  SwiftData models for local caching.
//  Remote-first architecture: writes go to GitHub API, cache syncs from remote.
//

import Foundation
import SwiftData

// MARK: - Cached Repository

@Model
final class CachedRepository {
    @Attribute(.unique) var id: String  // "owner/repo"
    var owner: String
    var name: String
    var fullName: String
    var lastSyncedAt: Date?
    var lastRemoteCommitSHA: String?
    var lastRemoteCommitDate: Date?

    @Relationship(deleteRule: .cascade, inverse: \CachedChannel.repository)
    var channels: [CachedChannel] = []

    init(id: String, owner: String, name: String) {
        self.id = id
        self.owner = owner
        self.name = name
        self.fullName = "\(owner)/\(name)"
    }

    convenience init(from repository: Repository) {
        self.init(id: "\(repository.owner)/\(repository.name)", owner: repository.owner, name: repository.name)
    }
}

// MARK: - Cached Channel

@Model
final class CachedChannel {
    @Attribute(.unique) var id: String  // "owner/repo/channelName"
    var name: String
    var repositoryId: String  // "owner/repo"
    var lastSyncedAt: Date?
    var unreadCount: Int = 0
    var lastReadMessageId: String?

    @Relationship(deleteRule: .cascade, inverse: \CachedMessage.channel)
    var messages: [CachedMessage] = []

    var repository: CachedRepository?

    init(id: String, name: String, repositoryId: String) {
        self.id = id
        self.name = name
        self.repositoryId = repositoryId
    }

    convenience init(from channel: Channel, repositoryId: String) {
        self.init(
            id: "\(repositoryId)/\(channel.id)",
            name: channel.name,
            repositoryId: repositoryId
        )
    }
}

// MARK: - Cached Message

@Model
final class CachedMessage {
    @Attribute(.unique) var id: String  // filename without .md
    var filename: String
    var from: String
    var date: Date
    var replyTo: String?
    var tags: [String]?
    var edited: Date?
    var content: String
    var rawContent: String
    var sha: String?
    var channelId: String  // "owner/repo/channelName"

    // Attachment metadata
    var files: [String]?
    var images: [String]?
    var attachments: [String]?

    var channel: CachedChannel?

    init(
        id: String,
        filename: String,
        from: String,
        date: Date,
        content: String,
        rawContent: String,
        channelId: String
    ) {
        self.id = id
        self.filename = filename
        self.from = from
        self.date = date
        self.content = content
        self.rawContent = rawContent
        self.channelId = channelId
    }

    convenience init(from message: Message, channelId: String) {
        self.init(
            id: message.id,
            filename: message.filename,
            from: message.from,
            date: message.date,
            content: message.content,
            rawContent: message.rawContent,
            channelId: channelId
        )
        self.replyTo = message.replyTo
        self.tags = message.tags
        self.edited = message.edited
        self.sha = message.sha
        self.files = message.files
        self.images = message.images
        self.attachments = message.attachments
    }

    /// Convert back to Message for UI consumption
    func toMessage() -> Message {
        Message(
            id: id,
            filename: filename,
            from: from,
            date: date,
            replyTo: replyTo,
            tags: tags,
            edited: edited,
            content: content,
            rawContent: rawContent,
            sha: sha,
            files: files,
            images: images,
            attachments: attachments
        )
    }
}

// MARK: - Rate Limit Tracking

@Model
final class RateLimitInfo {
    @Attribute(.unique) var id: String = "github"
    var remaining: Int = 5000
    var limit: Int = 5000
    var resetDate: Date?
    var lastUpdated: Date?

    init() {
        self.id = "github"
    }

    var usagePercentage: Double {
        guard limit > 0 else { return 0 }
        return Double(limit - remaining) / Double(limit) * 100
    }

    var isWarning: Bool {
        usagePercentage >= 80 && usagePercentage < 95
    }

    var isCritical: Bool {
        usagePercentage >= 95 && remaining > 0
    }

    var isExhausted: Bool {
        remaining == 0
    }
}
