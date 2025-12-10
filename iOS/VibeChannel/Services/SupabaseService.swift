//
//  SupabaseService.swift
//  VibeChannel
//
//  Main Supabase service singleton
//

import Foundation
import Combine
import Supabase

@MainActor
final class SupabaseService: ObservableObject {
    static let shared = SupabaseService()

    let client: SupabaseClient

    // Sub-services (lazy initialized)
    lazy var auth = AuthService(client: client)
    lazy var messages = MessageService(client: client)
    lazy var channels = ChannelService(client: client)
    lazy var repos = RepoService(client: client)
    lazy var realtime = RealtimeService(client: client)
    lazy var presence = PresenceService(client: client)

    private init() {
        client = SupabaseClient(
            supabaseURL: URL(string: Config.supabaseUrl)!,
            supabaseKey: Config.supabaseAnonKey,
            options: SupabaseClientOptions(
                auth: SupabaseClientOptions.AuthOptions(
                    redirectToURL: URL(string: Config.redirectUrl)
                )
            )
        )
    }
}

// MARK: - JSON Decoder for Supabase

extension JSONDecoder {
    static var supabase: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    static var supabase: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
