//
//  UnreadCount.swift
//  VibeChannel
//
//  UnreadCount model mapped to Supabase unread_counts table
//

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
