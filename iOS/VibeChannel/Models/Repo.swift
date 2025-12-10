//
//  Repo.swift
//  VibeChannel
//
//  Repository model mapped to Supabase repos table
//

import Foundation

struct Repo: Identifiable, Codable, Equatable, Hashable {
    let id: UUID
    let githubInstallationId: Int
    let githubRepoId: Int
    let owner: String
    let name: String
    let fullName: String
    let defaultBranch: String
    let vibechannelBranch: String
    let vibechannelInitialized: Bool?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case githubInstallationId = "github_installation_id"
        case githubRepoId = "github_repo_id"
        case owner
        case name
        case fullName = "full_name"
        case defaultBranch = "default_branch"
        case vibechannelBranch = "vibechannel_branch"
        case vibechannelInitialized = "vibechannel_initialized"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
