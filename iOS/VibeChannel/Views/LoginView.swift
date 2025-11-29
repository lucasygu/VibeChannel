//
//  LoginView.swift
//  VibeChannel
//
//  Login screen with GitHub OAuth authentication.
//

import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authService: GitHubAuthService
    @State private var isSigningIn = false
    @State private var errorMessage: String?

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

                Text("Git-powered team conversations")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
                .disabled(isSigningIn)

                if isSigningIn {
                    ProgressView("Signing in...")
                }

                if let error = errorMessage {
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
                Text("Your conversations, stored in Git")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("No backend required")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.bottom, 32)
        }
    }

    private func signIn() {
        isSigningIn = true
        errorMessage = nil

        Task {
            do {
                _ = try await authService.signIn()
            } catch AuthError.cancelled {
                // User cancelled, don't show error
            } catch {
                errorMessage = error.localizedDescription
            }
            isSigningIn = false
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(GitHubAuthService.shared)
}
