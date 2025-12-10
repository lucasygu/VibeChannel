//
//  Presence.swift
//  VibeChannel
//
//  Presence model mapped to Supabase presence table
//

import Foundation

struct Presence: Identifiable, Codable, Equatable {
    let userId: UUID
    let repoId: UUID?
    let channelId: UUID?
    let status: PresenceStatus
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
