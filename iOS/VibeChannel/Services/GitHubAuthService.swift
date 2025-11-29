//
//  GitHubAuthService.swift
//  VibeChannel
//
//  Handles GitHub OAuth authentication using ASWebAuthenticationSession.
//  No backend required - authenticates directly with GitHub.
//

import Foundation
import AuthenticationServices
import Combine

enum AuthError: Error, LocalizedError {
    case missingCode
    case tokenExchangeFailed(String)
    case userFetchFailed
    case cancelled

    var errorDescription: String? {
        switch self {
        case .missingCode:
            return "Missing authorization code"
        case .tokenExchangeFailed(let message):
            return "Token exchange failed: \(message)"
        case .userFetchFailed:
            return "Failed to fetch user info"
        case .cancelled:
            return "Authentication cancelled"
        }
    }
}

@MainActor
class GitHubAuthService: NSObject, ObservableObject {
    static let shared = GitHubAuthService()

    // GitHub OAuth App credentials (loaded from Secrets.swift)
    private let clientId = Secrets.githubClientId
    private let clientSecret = Secrets.githubClientSecret
    private let redirectUri = "vibechannel://oauth/callback"
    private let scope = "read:user repo"

    @Published var currentUser: GitHubUser?
    @Published var isLoading = false
    @Published var error: AuthError?

    private var authSession: ASWebAuthenticationSession?

    override init() {
        super.init()
        // Load saved user on init
        if let savedUser = KeychainService.shared.retrieveUser() {
            self.currentUser = savedUser
        }
    }

    var isSignedIn: Bool {
        currentUser != nil
    }

    // MARK: - Sign In

    func signIn() async throws -> GitHubUser {
        isLoading = true
        error = nil

        defer { isLoading = false }

        // Build OAuth URL
        var components = URLComponents(string: "https://github.com/login/oauth/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectUri),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "state", value: UUID().uuidString)
        ]

        guard let authURL = components.url else {
            throw AuthError.missingCode
        }

        // Start OAuth flow
        let callbackURL = try await startAuthSession(url: authURL)

        // Extract code from callback
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              let code = components.queryItems?.first(where: { $0.name == "code" })?.value else {
            throw AuthError.missingCode
        }

        // Exchange code for token
        let token = try await exchangeCodeForToken(code)

        // Fetch user info
        let user = try await fetchUserInfo(token: token)

        // Save to keychain
        try KeychainService.shared.store(user: user)

        // Update state
        self.currentUser = user

        return user
    }

    private func startAuthSession(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "vibechannel"
            ) { callbackURL, error in
                if let error = error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: AuthError.cancelled)
                    } else {
                        continuation.resume(throwing: error)
                    }
                } else if let callbackURL = callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: AuthError.missingCode)
                }
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false

            self.authSession = session

            if !session.start() {
                continuation.resume(throwing: AuthError.cancelled)
            }
        }
    }

    private func exchangeCodeForToken(_ code: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://github.com/login/oauth/access_token")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = [
            "client_id": clientId,
            "client_secret": clientSecret,
            "code": code
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw AuthError.tokenExchangeFailed(message)
        }

        let tokenResponse = try JSONDecoder().decode(GitHubTokenResponse.self, from: data)
        return tokenResponse.accessToken
    }

    private func fetchUserInfo(token: String) async throws -> GitHubUser {
        var request = URLRequest(url: URL(string: "https://api.github.com/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("VibeChannel-iOS/1.0", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AuthError.userFetchFailed
        }

        let userResponse = try JSONDecoder().decode(GitHubUserResponse.self, from: data)

        return GitHubUser(
            login: userResponse.login,
            name: userResponse.name,
            avatarUrl: userResponse.avatarUrl,
            accessToken: token
        )
    }

    // MARK: - Sign Out

    func signOut() {
        try? KeychainService.shared.delete()
        currentUser = nil
    }

    // MARK: - Refresh User

    func refreshUser() async {
        guard let user = currentUser else { return }

        do {
            let api = GitHubAPIClient(accessToken: user.accessToken)
            let userResponse = try await api.getCurrentUser()

            let updatedUser = GitHubUser(
                login: userResponse.login,
                name: userResponse.name,
                avatarUrl: userResponse.avatarUrl,
                accessToken: user.accessToken
            )

            try KeychainService.shared.store(user: updatedUser)
            self.currentUser = updatedUser
        } catch {
            // Token might be invalid, sign out
            if case GitHubAPIError.unauthorized = error {
                signOut()
            }
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension GitHubAuthService: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return UIWindow()
        }
        return window
    }
}
