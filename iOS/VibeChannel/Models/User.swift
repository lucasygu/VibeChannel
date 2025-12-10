//
//  User.swift
//  VibeChannel
//
//  User model mapped to Supabase users table
//

import Foundation

struct User: Identifiable, Codable, Equatable {
    let id: UUID
    let githubId: Int?
    let githubLogin: String
    let githubName: String?
    let avatarUrl: String?
    let email: String?
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
