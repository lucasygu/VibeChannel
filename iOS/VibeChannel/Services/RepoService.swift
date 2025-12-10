//
//  RepoService.swift
//  VibeChannel
//
//  Repository operations via Supabase
//

import Foundation
import Supabase

final class RepoService {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Fetch User's Repos

    func fetchUserRepos(userId: UUID) async throws -> [Repo] {
        // Query repos through user_repos junction table
        // Using a subquery approach since supabase-swift may have limitations with inner joins
        let userRepos: [UserRepo] = try await client.database
            .from("user_repos")
            .select()
            .eq("user_id", value: userId)
            .execute()
            .value

        let repoIds = userRepos.map { $0.repoId }

        guard !repoIds.isEmpty else {
            return []
        }

        let repos: [Repo] = try await client.database
            .from("repos")
            .select()
            .in("id", values: repoIds)
            .order("full_name", ascending: true)
            .execute()
            .value

        return repos
    }

    // MARK: - Get Single Repo

    func getRepo(repoId: UUID) async throws -> Repo? {
        let repos: [Repo] = try await client.database
            .from("repos")
            .select()
            .eq("id", value: repoId)
            .execute()
            .value

        return repos.first
    }

    // MARK: - Get Repo by Full Name

    func getRepoByFullName(fullName: String) async throws -> Repo? {
        let repos: [Repo] = try await client.database
            .from("repos")
            .select()
            .eq("full_name", value: fullName)
            .execute()
            .value

        return repos.first
    }

    // MARK: - Join Repo (add user access)

    func joinRepo(userId: UUID, repoId: UUID, role: UserRepoRole = .member) async throws {
        struct NewUserRepo: Encodable {
            let user_id: UUID
            let repo_id: UUID
            let role: String
        }

        let userRepo = NewUserRepo(
            user_id: userId,
            repo_id: repoId,
            role: role.rawValue
        )

        try await client.database
            .from("user_repos")
            .upsert(userRepo)
            .execute()
    }

    // MARK: - Leave Repo (remove user access)

    func leaveRepo(userId: UUID, repoId: UUID) async throws {
        try await client.database
            .from("user_repos")
            .delete()
            .eq("user_id", value: userId)
            .eq("repo_id", value: repoId)
            .execute()
    }

    // MARK: - Check User Access

    func hasAccess(userId: UUID, repoId: UUID) async throws -> Bool {
        let userRepos: [UserRepo] = try await client.database
            .from("user_repos")
            .select()
            .eq("user_id", value: userId)
            .eq("repo_id", value: repoId)
            .execute()
            .value

        return !userRepos.isEmpty
    }
}
