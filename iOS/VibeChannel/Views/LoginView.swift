//
//  LoginView.swift
//  VibeChannel
//
//  Login screen with Supabase + GitHub OAuth authentication.
//

import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthService

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Logo and title
            VStack(spacing: 16) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.blue)

                Text("VibeChannel")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Real-time team chat\npowered by Git")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            // Sign in button
            VStack(spacing: 16) {
                Button(action: signIn) {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.right.circle.fill")
                            .font(.title2)

                        Text("Sign in with GitHub")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(auth.isLoading)

                if auth.isLoading {
                    ProgressView("Signing in...")
                }

                if let error = auth.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 32)

            Spacer()

            // Footer
            VStack(spacing: 8) {
                Text("Instant messaging with Git sync")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("Powered by Supabase")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.bottom, 32)
        }
    }

    private func signIn() {
        Task {
            try? await auth.signIn()
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(SupabaseService.shared.auth)
}
