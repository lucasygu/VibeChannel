//
//  PresenceService.swift
//  VibeChannel
//
//  Presence database operations
//

import Foundation
import Supabase

final class PresenceService: Sendable {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Update Presence in Database

    func updatePresence(repoId: UUID?, channelId: UUID?, status: PresenceStatus) async throws {
        // Use a simple dictionary instead of a struct to avoid Sendable issues
        var params: [String: String] = [:]
        params["p_status"] = status.rawValue
        if let repoId = repoId {
            params["p_repo_id"] = repoId.uuidString
        }
        if let channelId = channelId {
            params["p_channel_id"] = channelId.uuidString
        }

        try await client
            .rpc("update_presence", params: params)
            .execute()
    }

    // MARK: - Get Online Users in Channel

    func getOnlineUsers(channelId: UUID) async throws -> [Presence] {
        let presences: [Presence] = try await client
            .from("presence")
            .select()
            .eq("channel_id", value: channelId)
            .neq("status", value: "offline")
            .execute()
            .value

        return presences
    }

    // MARK: - Get Online Users in Repo

    func getOnlineUsersInRepo(repoId: UUID) async throws -> [Presence] {
        let presences: [Presence] = try await client
            .from("presence")
            .select()
            .eq("repo_id", value: repoId)
            .neq("status", value: "offline")
            .execute()
            .value

        return presences
    }

    // MARK: - Set Offline

    func setOffline() async throws {
        try await updatePresence(repoId: nil, channelId: nil, status: .offline)
    }

    // MARK: - Set Typing

    func setTyping(repoId: UUID, channelId: UUID) async throws {
        try await updatePresence(repoId: repoId, channelId: channelId, status: .typing)
    }

    // MARK: - Set Online

    func setOnline(repoId: UUID, channelId: UUID) async throws {
        try await updatePresence(repoId: repoId, channelId: channelId, status: .online)
    }
}
