//
//  Repository.swift
//  VibeChannel
//
//  Data model for a GitHub repository that contains VibeChannel conversations.
//

import Foundation

struct Repository: Identifiable, Codable, Equatable, Hashable {
    let id: Int
    let name: String
    let fullName: String
    let owner: String
    let isPrivate: Bool
    let defaultBranch: String

    init(id: Int, name: String, fullName: String, owner: String, isPrivate: Bool, defaultBranch: String) {
        self.id = id
        self.name = name
        self.fullName = fullName
        self.owner = owner
        self.isPrivate = isPrivate
        self.defaultBranch = defaultBranch
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case fullName = "full_name"
        case owner
        case isPrivate = "private"
        case defaultBranch = "default_branch"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        fullName = try container.decode(String.self, forKey: .fullName)
        isPrivate = try container.decode(Bool.self, forKey: .isPrivate)
        defaultBranch = try container.decode(String.self, forKey: .defaultBranch)

        // Handle nested owner object
        if let ownerContainer = try? container.nestedContainer(keyedBy: OwnerCodingKeys.self, forKey: .owner) {
            owner = try ownerContainer.decode(String.self, forKey: .login)
        } else {
            owner = try container.decode(String.self, forKey: .owner)
        }
    }

    private enum OwnerCodingKeys: String, CodingKey {
        case login
    }
}

// GitHub API response for repository contents
struct GitHubContentItem: Codable {
    let name: String
    let path: String
    let sha: String
    let type: String  // "file" or "dir"
    let content: String?  // base64 encoded, only for files
    let encoding: String?
    let downloadUrl: String?

    enum CodingKeys: String, CodingKey {
        case name, path, sha, type, content, encoding
        case downloadUrl = "download_url"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        path = try container.decode(String.self, forKey: .path)
        sha = try container.decode(String.self, forKey: .sha)
        type = try container.decode(String.self, forKey: .type)
        content = try container.decodeIfPresent(String.self, forKey: .content)
        encoding = try container.decodeIfPresent(String.self, forKey: .encoding)
        downloadUrl = try container.decodeIfPresent(String.self, forKey: .downloadUrl)
    }
}

// GitHub API response for commits (from list commits API)
struct GitHubCommit: Codable {
    let sha: String
    let commit: CommitDetails

    struct CommitDetails: Codable {
        let message: String
        let author: Author?
        let committer: Author?
    }

    struct Author: Codable {
        let name: String
        let email: String
        let date: String
    }
}

// Commit info in create/update file response (different structure)
struct GitHubCreateCommit: Codable {
    let sha: String
    let message: String
    let author: CommitAuthor?
    let committer: CommitAuthor?

    struct CommitAuthor: Codable {
        let name: String
        let email: String
        let date: String
    }
}

// Response when creating/updating a file
struct GitHubCreateFileResponse: Codable {
    let content: GitHubContentItem
    let commit: GitHubCreateCommit
}
