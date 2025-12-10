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
            if auth.currentUser != nil {
                MainView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut, value: auth.currentUser != nil)
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
