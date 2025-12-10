//
//  RealtimeService.swift
//  VibeChannel
//
//  WebSocket subscriptions for real-time updates
//

import Foundation
import Combine
import Supabase

@MainActor
final class RealtimeService: ObservableObject {
    private let client: SupabaseClient
    private var messageChannel: RealtimeChannelV2?

    @Published var onlineUsers: [UUID: PresenceStatus] = [:]
    @Published var isConnected = false

    // Callbacks for message events
    var onMessageInserted: ((Message) -> Void)?
    var onMessageUpdated: ((Message) -> Void)?
    var onMessageDeleted: ((UUID) -> Void)?

    // Callbacks for presence events
    var onPresenceChanged: (([UUID: PresenceStatus]) -> Void)?

    init(client: SupabaseClient) {
        self.client = client
    }

    // MARK: - Subscribe to Channel Messages

    func subscribeToChannel(channelId: UUID) async {
        // Unsubscribe from previous
        await unsubscribeFromChannel()

        let channel = client.realtimeV2.channel("messages:\(channelId.uuidString)")

        // Listen for INSERTs using new filter syntax
        let insertions = channel.postgresChange(
            InsertAction.self,
            schema: "public",
            table: "messages",
            filter: .eq("channel_id", value: channelId.uuidString)
        )

        // Listen for UPDATEs using new filter syntax
        let updates = channel.postgresChange(
            UpdateAction.self,
            schema: "public",
            table: "messages",
            filter: .eq("channel_id", value: channelId.uuidString)
        )

        // Listen for DELETEs using new filter syntax
        let deletions = channel.postgresChange(
            DeleteAction.self,
            schema: "public",
            table: "messages",
            filter: .eq("channel_id", value: channelId.uuidString)
        )

        do {
            try await channel.subscribeWithError()
            messageChannel = channel
            isConnected = true
        } catch {
            print("[RealtimeService] Failed to subscribe: \(error)")
            return
        }

        // Handle insertions
        Task {
            for await insertion in insertions {
                if let message = try? insertion.decodeRecord(as: Message.self, decoder: .supabase) {
                    await MainActor.run {
                        self.onMessageInserted?(message)
                    }
                }
            }
        }

        // Handle updates
        Task {
            for await update in updates {
                if let message = try? update.decodeRecord(as: Message.self, decoder: .supabase) {
                    await MainActor.run {
                        self.onMessageUpdated?(message)
                    }
                }
            }
        }

        // Handle deletions
        Task {
            for await deletion in deletions {
                // Try to extract id from oldRecord
                let record = deletion.oldRecord
                // AnyJSON uses different access pattern
                if let idJSON = record["id"] {
                    // Convert AnyJSON to string
                    let idString: String?
                    switch idJSON {
                    case .string(let s):
                        idString = s
                    default:
                        idString = nil
                    }
                    if let idStr = idString, let id = UUID(uuidString: idStr) {
                        await MainActor.run {
                            self.onMessageDeleted?(id)
                        }
                    }
                }
            }
        }
    }

    func unsubscribeFromChannel() async {
        await messageChannel?.unsubscribe()
        messageChannel = nil
    }

    // MARK: - Presence (Simplified - uses database polling instead of realtime presence)
    // For real-time presence, we rely on the database presence table and periodic refresh

    func subscribeToPresence(channelId: UUID, userId: UUID) async {
        // Presence is handled via database updates rather than realtime channels
        // This avoids complex presence API compatibility issues
    }

    func updatePresenceStatus(_ status: PresenceStatus) async {
        // Handled by PresenceService directly
    }

    func unsubscribeFromPresence() async {
        onlineUsers = [:]
    }

    // MARK: - Cleanup

    func unsubscribeAll() async {
        await unsubscribeFromChannel()
        await unsubscribeFromPresence()
        isConnected = false
    }
}
