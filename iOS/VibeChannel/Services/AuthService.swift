//
//  AuthService.swift
//  VibeChannel
//
//  Authentication service using Supabase Auth with GitHub OAuth
//

import Foundation
import Combine
import Supabase
import AuthenticationServices

@MainActor
final class AuthService: NSObject, ObservableObject {
    private let client: SupabaseClient
    private var webAuthSession: ASWebAuthenticationSession?

    @Published var currentUser: User?
    @Published var session: Session?
    @Published var isLoading = false
    @Published var isCheckingSession = true  // True until we check for existing session
    @Published var error: String?

    init(client: SupabaseClient) {
        self.client = client
        super.init()

        // Listen for auth state changes
        Task {
            for await (event, session) in client.auth.authStateChanges {
                await handleAuthStateChange(event: event, session: session)
            }
        }
    }

    // MARK: - Sign In with GitHub via Supabase

    func signIn() async throws {
        isLoading = true
        error = nil

        do {
            // Get the OAuth URL from Supabase
            let url = try client.auth.getOAuthSignInURL(
                provider: .github,
                redirectTo: URL(string: Config.redirectUrl)
            )

            print("OAuth URL: \(url)")

            // Use ASWebAuthenticationSession on iOS
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let session = ASWebAuthenticationSession(
                    url: url,
                    callbackURLScheme: "vibechannel"
                ) { callbackURL, error in
                    if let error = error {
                        if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                            continuation.resume(throwing: NSError(domain: "AuthService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Login cancelled"]))
                        } else {
                            continuation.resume(throwing: error)
                        }
                        return
                    }

                    guard let callbackURL = callbackURL else {
                        continuation.resume(throwing: NSError(domain: "AuthService", code: -1, userInfo: [NSLocalizedDescriptionKey: "No callback URL"]))
                        return
                    }

                    print("Callback URL: \(callbackURL)")

                    // Handle the callback
                    Task { @MainActor in
                        do {
                            try await self.handleCallback(url: callbackURL)
                            continuation.resume()
                        } catch {
                            continuation.resume(throwing: error)
                        }
                    }
                }

                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false

                self.webAuthSession = session

                if !session.start() {
                    continuation.resume(throwing: NSError(domain: "AuthService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to start auth session"]))
                }
            }
        } catch {
            self.error = error.localizedDescription
            print("Sign in error: \(error)")
            isLoading = false
            throw error
        }

        isLoading = false
    }

    // MARK: - Handle OAuth Callback

    func handleCallback(url: URL) async throws {
        print("Handling callback URL: \(url)")

        do {
            try await client.auth.session(from: url)
            await loadCurrentUser()
            print("Session established successfully")
        } catch {
            self.error = error.localizedDescription
            print("Callback error: \(error)")
            throw error
        }
    }

    // MARK: - Sign Out

    func signOut() async throws {
        do {
            try await client.auth.signOut()
            currentUser = nil
            session = nil
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    // MARK: - Load Current User from Database

    func loadCurrentUser() async {
        guard let authUser = client.auth.currentUser else {
            currentUser = nil
            return
        }

        print("Loading user: \(authUser.id)")

        do {
            let users: [User] = try await client
                .from("users")
                .select()
                .eq("id", value: authUser.id)
                .execute()
                .value

            if let user = users.first {
                currentUser = user
                print("Loaded user from database: \(user.githubLogin)")
            } else {
                // User might not exist yet (trigger hasn't run)
                // Create from auth metadata
                currentUser = createUserFromMetadata(authUser: authUser)
                print("Created user from metadata")
            }
        } catch {
            print("Failed to load user: \(error)")
            // Create from auth metadata as fallback
            currentUser = createUserFromMetadata(authUser: authUser)
        }
    }

    private func createUserFromMetadata(authUser: Supabase.User) -> User {
        let metadata = authUser.userMetadata

        let githubLogin = metadata["user_name"]?.stringValue
            ?? metadata["preferred_username"]?.stringValue
            ?? "unknown"

        return User(
            id: authUser.id,
            githubId: metadata["provider_id"]?.intValue,
            githubLogin: githubLogin,
            githubName: metadata["full_name"]?.stringValue ?? metadata["name"]?.stringValue,
            avatarUrl: metadata["avatar_url"]?.stringValue,
            email: authUser.email,
            createdAt: Date(),
            updatedAt: Date()
        )
    }

    // MARK: - Restore Session

    func restoreSession() async {
        isCheckingSession = true
        defer { isCheckingSession = false }

        do {
            session = try await client.auth.session
            await loadCurrentUser()
            print("[AuthService] Session restored for user: \(currentUser?.githubLogin ?? "unknown")")
        } catch {
            print("[AuthService] No existing session: \(error)")
            session = nil
            currentUser = nil
        }
    }

    // MARK: - Auth State Handler

    private func handleAuthStateChange(event: AuthChangeEvent, session: Session?) async {
        print("Auth state change: \(event)")
        switch event {
        case .signedIn:
            self.session = session
            await loadCurrentUser()
        case .signedOut:
            currentUser = nil
            self.session = nil
        case .tokenRefreshed:
            self.session = session
        case .userUpdated:
            await loadCurrentUser()
        default:
            break
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Get the first connected window scene
        let windowScene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first

        // Return existing window from scene, or create a new one with the scene
        if let scene = windowScene {
            return scene.windows.first ?? UIWindow(windowScene: scene)
        }

        // Fallback: create window with any available scene (should always exist)
        let fallbackScene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first!
        return UIWindow(windowScene: fallbackScene)
    }
}

// MARK: - AnyJSON Extension

extension AnyJSON {
    var stringValue: String? {
        switch self {
        case .string(let value):
            return value
        default:
            return nil
        }
    }

    var intValue: Int? {
        switch self {
        case .integer(let value):
            return value
        case .double(let value):
            return Int(value)
        default:
            return nil
        }
    }
}
