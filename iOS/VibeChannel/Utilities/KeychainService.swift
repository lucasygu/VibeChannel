//
//  KeychainService.swift
//  VibeChannel
//
//  Secure storage for GitHub OAuth token using iOS Keychain.
//

import Foundation
import Security

enum KeychainError: Error {
    case unableToStore
    case unableToRetrieve
    case unableToDelete
    case unexpectedData
}

class KeychainService {
    static let shared = KeychainService()

    private let service = "com.vibechannel.ios"
    private let userAccount = "github_user"

    private init() {}

    // MARK: - Store User

    func store(user: GitHubUser) throws {
        let data = try JSONEncoder().encode(user)

        // Delete existing item first
        try? delete()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: userAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            throw KeychainError.unableToStore
        }
    }

    // MARK: - Retrieve User

    func retrieveUser() -> GitHubUser? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: userAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let user = try? JSONDecoder().decode(GitHubUser.self, from: data) else {
            return nil
        }

        return user
    }

    // MARK: - Delete User

    func delete() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: userAccount
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unableToDelete
        }
    }

    // MARK: - Check if logged in

    var isLoggedIn: Bool {
        retrieveUser() != nil
    }
}
