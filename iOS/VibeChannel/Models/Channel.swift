//
//  Channel.swift
//  VibeChannel
//
//  Data model for a channel (folder in the repository).
//

import Foundation

struct Channel: Identifiable, Codable, Equatable, Hashable {
    let id: String      // folder name: "general"
    let name: String    // display name: "general"
    var unreadCount: Int = 0

    init(id: String, name: String? = nil, unreadCount: Int = 0) {
        self.id = id
        self.name = name ?? id
        self.unreadCount = unreadCount
    }
}
