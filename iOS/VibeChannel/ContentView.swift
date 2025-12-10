//
//  ContentView.swift
//  VibeChannel
//
//  Root view that switches between login and main content.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthService

    var body: some View {
        Group {
            if auth.isCheckingSession {
                // Show loading while checking for existing session
                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.5)
                    Text("Loading...")
                        .foregroundStyle(.secondary)
                }
            } else if auth.currentUser != nil {
                MainView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut, value: auth.currentUser != nil)
        .animation(.easeInOut, value: auth.isCheckingSession)
        .task {
            await auth.restoreSession()
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(SupabaseService.shared)
        .environmentObject(SupabaseService.shared.auth)
        .environmentObject(SupabaseService.shared.realtime)
}
