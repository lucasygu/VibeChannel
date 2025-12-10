//
//  VibeChannelApp.swift
//  VibeChannel
//
//  Main app entry point with Supabase authentication.
//

import SwiftUI

@main
struct VibeChannelApp: App {
    @StateObject private var supabase = SupabaseService.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(supabase)
                .environmentObject(supabase.auth)
                .environmentObject(supabase.realtime)
                .onOpenURL { url in
                    // Handle OAuth callback
                    Task {
                        try? await supabase.auth.handleCallback(url: url)
                    }
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            Task {
                switch newPhase {
                case .active:
                    // App became active - restore session if needed
                    if supabase.auth.currentUser == nil {
                        await supabase.auth.restoreSession()
                    }
                case .inactive, .background:
                    // App going to background - set presence offline
                    try? await supabase.presence.setOffline()
                    await supabase.realtime.unsubscribeAll()
                @unknown default:
                    break
                }
            }
        }
    }
}
