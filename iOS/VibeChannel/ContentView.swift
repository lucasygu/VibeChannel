//
//  ContentView.swift
//  VibeChannel
//
//  Root view that switches between login and main content.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: GitHubAuthService

    var body: some View {
        Group {
            if authService.isSignedIn {
                MainView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut, value: authService.isSignedIn)
    }
}

#Preview {
    ContentView()
        .environmentObject(GitHubAuthService.shared)
}
