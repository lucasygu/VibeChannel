//
//  UserRepo.swift
//  VibeChannel
//
//  UserRepo model mapped to Supabase user_repos table
//  Junction table for user <-> repo access
//

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
