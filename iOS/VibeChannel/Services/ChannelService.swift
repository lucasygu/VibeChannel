//
//  ChannelService.swift
//  VibeChannel
//
//  Channel CRUD operations via Supabase
//

import Foundation
import Supabase

final class ChannelService {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Fetch Channels for Repo

    func fetchChannels(repoId: UUID) async throws -> [Channel] {
        let channels: [Channel] = try await client
            .from("channels")
            .select()
            .eq("repo_id", value: repoId)
            .order("name", ascending: true)
            .execute()
            .value

        return channels
    }

    // MARK: - Get Single Channel

    func getChannel(channelId: UUID) async throws -> Channel? {
        let channels: [Channel] = try await client
            .from("channels")
            .select()
            .eq("id", value: channelId)
            .execute()
            .value

        return channels.first
    }

    // MARK: - Create Channel

    func createChannel(repoId: UUID, name: String, description: String? = nil) async throws -> Channel {
        struct NewChannel: Encodable {
            let repo_id: UUID
            let name: String
            let description: String?
        }

        let newChannel = NewChannel(
            repo_id: repoId,
            name: name,
            description: description
        )

        let channel: Channel = try await client
            .from("channels")
            .insert(newChannel)
            .select()
            .single()
            .execute()
            .value

        return channel
    }

    // MARK: - Get or Create Channel

    func getOrCreateChannel(repoId: UUID, name: String) async throws -> Channel {
        // Try to find existing
        let existing: [Channel] = try await client
            .from("channels")
            .select()
            .eq("repo_id", value: repoId)
            .eq("name", value: name)
            .execute()
            .value

        if let channel = existing.first {
            return channel
        }

        // Create new
        return try await createChannel(repoId: repoId, name: name)
    }

    // MARK: - Fetch Unread Counts

    func fetchUnreadCounts(userId: UUID, repoId: UUID) async throws -> [UUID: Int] {
        struct UnreadResult: Decodable {
            let channelId: UUID
            let unreadCount: Int

            enum CodingKeys: String, CodingKey {
                case channelId = "channel_id"
                case unreadCount = "unread_count"
            }
        }

        // Get channels for this repo first
        let channels = try await fetchChannels(repoId: repoId)
        let channelIds = channels.map { $0.id }

        guard !channelIds.isEmpty else {
            return [:]
        }

        let counts: [UnreadResult] = try await client
            .from("unread_counts")
            .select("channel_id, unread_count")
            .eq("user_id", value: userId)
            .in("channel_id", values: channelIds)
            .execute()
            .value

        return Dictionary(uniqueKeysWithValues: counts.map { ($0.channelId, $0.unreadCount) })
    }

    // MARK: - Mark Channel as Read

    func markChannelRead(channelId: UUID) async throws {
        try await client
            .rpc("mark_channel_read", params: ["p_channel_id": channelId])
            .execute()
    }
}
