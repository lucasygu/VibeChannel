//
//  Channel.swift
//  VibeChannel
//
//  Channel model mapped to Supabase channels table
//

import Foundation

struct Channel: Identifiable, Codable, Equatable, Hashable {
    let id: UUID
    let repoId: UUID
    let name: String
    let description: String?
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
        unreadCount = 0
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(repoId, forKey: .repoId)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
    }

    // For creating new channels
    init(id: UUID = UUID(), repoId: UUID, name: String, description: String? = nil, createdAt: Date = Date(), updatedAt: Date = Date(), unreadCount: Int = 0) {
        self.id = id
        self.repoId = repoId
        self.name = name
        self.description = description
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.unreadCount = unreadCount
    }
}
