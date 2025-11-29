//
//  VibeChannelApp.swift
//  VibeChannel
//
//  Main app entry point with authentication state management.
//

import SwiftUI

@main
struct VibeChannelApp: App {
    @StateObject private var authService = GitHubAuthService.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authService)
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                // App became active - polling will be managed by views
                break
            case .inactive, .background:
                // App going to background - stop polling
                SyncService.shared.stopPolling()
            @unknown default:
                break
            }
        }
    }
}
