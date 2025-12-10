//
//  Message.swift
//  VibeChannel
//
//  Message model mapped to Supabase messages table
//

import Foundation

struct Message: Identifiable, Codable, Equatable {
    let id: UUID
    let channelId: UUID
    let sender: String
    let senderUserId: UUID?
    let content: String
    let replyToId: UUID?
    let replyToPath: String?
    let tags: [String]?
    let githubPath: String
    let githubSha: String?
    let githubSynced: Bool?
    let syncedAt: Date?
    let createdAt: Date
    let updatedAt: Date

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

    // Convenience computed properties for compatibility with existing views
    var from: String { sender }
    var date: Date { createdAt }
    var filename: String {
        githubPath.components(separatedBy: "/").last ?? githubPath
    }

    // For creating new messages locally
    init(
        id: UUID = UUID(),
        channelId: UUID,
        sender: String,
        senderUserId: UUID? = nil,
        content: String,
        replyToId: UUID? = nil,
        replyToPath: String? = nil,
        tags: [String]? = nil,
        githubPath: String,
        githubSha: String? = nil,
        githubSynced: Bool? = false,
        syncedAt: Date? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.channelId = channelId
        self.sender = sender
        self.senderUserId = senderUserId
        self.content = content
        self.replyToId = replyToId
        self.replyToPath = replyToPath
        self.tags = tags
        self.githubPath = githubPath
        self.githubSha = githubSha
        self.githubSynced = githubSynced
        self.syncedAt = syncedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
