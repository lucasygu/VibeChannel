//
//  MessageService.swift
//  VibeChannel
//
//  Message CRUD operations via Supabase
//

import Foundation
import Supabase

final class MessageService: Sendable {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Fetch Messages

    func fetchMessages(channelId: UUID, limit: Int = 100, before: Date? = nil) async throws -> [Message] {
        if let before = before {
            let messages: [Message] = try await client.database
                .from("messages")
                .select()
                .eq("channel_id", value: channelId)
                .lt("created_at", value: ISO8601DateFormatter().string(from: before))
                .order("created_at", ascending: true)
                .limit(limit)
                .execute()
                .value
            return messages
        } else {
            let messages: [Message] = try await client.database
                .from("messages")
                .select()
                .eq("channel_id", value: channelId)
                .order("created_at", ascending: true)
                .limit(limit)
                .execute()
                .value
            return messages
        }
    }

    // MARK: - Get Single Message

    func getMessage(messageId: UUID) async throws -> Message? {
        let messages: [Message] = try await client.database
            .from("messages")
            .select()
            .eq("id", value: messageId)
            .execute()
            .value

        return messages.first
    }

    // MARK: - Send Message

    func sendMessage(
        channelId: UUID,
        sender: String,
        senderUserId: UUID?,
        content: String,
        replyToId: UUID? = nil,
        tags: [String]? = nil
    ) async throws -> Message {
        // Generate GitHub path (for Git sync)
        let now = Date()
        let filename = generateFilename(sender: sender, date: now)
        let channelName = try await fetchChannelName(channelId: channelId)
        let githubPath = "\(channelName)/\(filename)"

        let newMessage = NewMessage(
            channel_id: channelId,
            sender: sender,
            sender_user_id: senderUserId,
            content: content,
            reply_to_id: replyToId,
            tags: tags,
            github_path: githubPath,
            github_synced: false,
            created_at: ISO8601DateFormatter().string(from: now)
        )

        let message: Message = try await client.database
            .from("messages")
            .insert(newMessage)
            .select()
            .single()
            .execute()
            .value

        return message
    }

    // MARK: - Edit Message

    func editMessage(messageId: UUID, newContent: String) async throws -> Message {
        let updates = UpdateMessage(
            content: newContent,
            updated_at: ISO8601DateFormatter().string(from: Date())
        )

        let message: Message = try await client.database
            .from("messages")
            .update(updates)
            .eq("id", value: messageId)
            .select()
            .single()
            .execute()
            .value

        return message
    }

    // MARK: - Delete Message

    func deleteMessage(messageId: UUID) async throws {
        try await client.database
            .from("messages")
            .delete()
            .eq("id", value: messageId)
            .execute()
    }

    // MARK: - Helpers

    private func generateFilename(sender: String, date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd'T'HHmmss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        let timestamp = formatter.string(from: date)

        let randomId = (0..<6).map { _ in
            "0123456789abcdef".randomElement()!
        }.map(String.init).joined()

        let safeSender = sender.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }

        return "\(timestamp)-\(safeSender)-\(randomId).md"
    }

    private func fetchChannelName(channelId: UUID) async throws -> String {
        let channel: ChannelNameResult = try await client.database
            .from("channels")
            .select("name")
            .eq("id", value: channelId)
            .single()
            .execute()
            .value

        return channel.name
    }
}

// MARK: - Helper Structs (Sendable)

private struct NewMessage: Encodable, Sendable {
    let channel_id: UUID
    let sender: String
    let sender_user_id: UUID?
    let content: String
    let reply_to_id: UUID?
    let tags: [String]?
    let github_path: String
    let github_synced: Bool
    let created_at: String
}

private struct UpdateMessage: Encodable, Sendable {
    let content: String
    let updated_at: String
}

private struct ChannelNameResult: Decodable, Sendable {
    let name: String
}
