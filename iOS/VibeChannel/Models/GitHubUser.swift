//
//  GitHubUser.swift
//  VibeChannel
//
//  Data model for authenticated GitHub user.
//

import Foundation

struct GitHubUser: Codable, Equatable {
    let login: String           // "lucasygu"
    let name: String?           // "Lucas Gu"
    let avatarUrl: String       // "https://avatars.githubusercontent.com/..."
    var accessToken: String     // OAuth token

    enum CodingKeys: String, CodingKey {
        case login
        case name
        case avatarUrl = "avatar_url"
        case accessToken = "access_token"
    }

    var displayName: String {
        name ?? login
    }
}

// Response from GitHub API /user endpoint
struct GitHubUserResponse: Codable {
    let login: String
    let name: String?
    let avatarUrl: String

    enum CodingKeys: String, CodingKey {
        case login
        case name
        case avatarUrl = "avatar_url"
    }
}

// Response from OAuth token exchange
struct GitHubTokenResponse: Codable {
    let accessToken: String
    let tokenType: String
    let scope: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case scope
    }
}
