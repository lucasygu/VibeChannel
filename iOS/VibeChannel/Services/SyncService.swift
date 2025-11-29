//
//  SyncService.swift
//  VibeChannel
//
//  Handles polling for new messages and syncing with GitHub.
//  No backend required - polls GitHub API directly.
//

import Foundation
import Combine

@MainActor
class SyncService: ObservableObject {
    static let shared = SyncService()

    @Published var lastSync: Date?
    @Published var isRefreshing = false
    @Published var error: Error?

    private var pollTask: Task<Void, Never>?
    private var api: GitHubAPIClient?
    private let pollInterval: TimeInterval = 10  // seconds

    private init() {}

    // MARK: - Configure

    func configure(with token: String) {
        self.api = GitHubAPIClient(accessToken: token)
    }

    // MARK: - Polling Control

    func startPolling(owner: String, repo: String, onChange: @escaping () -> Void) {
        stopPolling()

        pollTask = Task {
            while !Task.isCancelled {
                await poll(owner: owner, repo: repo, onChange: onChange)
                try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func poll(owner: String, repo: String, onChange: @escaping () -> Void) async {
        guard let api = api else { return }

        do {
            let hasChanges = try await api.checkForChanges(owner: owner, repo: repo)

            if hasChanges {
                onChange()
            }

            self.lastSync = Date()
            self.error = nil
        } catch {
            self.error = error
        }
    }

    // MARK: - Manual Refresh

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        // Just update the timestamp - the actual data fetching
        // is handled by the view models
        lastSync = Date()
    }

    // MARK: - Fetch Channels

    func fetchChannels(owner: String, repo: String) async throws -> [Channel] {
        print("🔵 [DEBUG] SyncService.fetchChannels: owner=\(owner), repo=\(repo)")

        guard let api = api else {
            print("🔴 [DEBUG] SyncService.fetchChannels: API not configured (unauthorized)")
            throw GitHubAPIError.unauthorized
        }

        print("🔵 [DEBUG] SyncService.fetchChannels: Calling api.listContents...")
        let contents = try await api.listContents(owner: owner, repo: repo)
        print("🟢 [DEBUG] SyncService.fetchChannels: Got \(contents.count) items from API")

        for item in contents {
            print("   📁 [DEBUG] Item: name=\(item.name), type=\(item.type), path=\(item.path)")
        }

        let channels = contents
            .filter { $0.type == "dir" && !$0.name.hasPrefix(".") }
            .map { Channel(id: $0.name) }

        print("🟢 [DEBUG] SyncService.fetchChannels: Filtered to \(channels.count) channels")
        return channels
    }

    // MARK: - Fetch Messages

    func fetchMessages(owner: String, repo: String, channel: String) async throws -> [Message] {
        guard let api = api else {
            throw GitHubAPIError.unauthorized
        }

        let contents = try await api.listContents(owner: owner, repo: repo, path: channel)
        var messages: [Message] = []

        for item in contents {
            guard MessageParser.isMessageFile(item.name) else { continue }

            do {
                let (content, sha) = try await api.getFileContentString(
                    owner: owner,
                    repo: repo,
                    path: "\(channel)/\(item.name)"
                )

                let result = MessageParser.parse(filename: item.name, content: content, sha: sha)

                switch result {
                case .success(let message):
                    messages.append(message)
                case .failure(let error):
                    print("Failed to parse \(item.name): \(error.error)")
                }
            } catch {
                print("Failed to fetch \(item.name): \(error)")
            }
        }

        // Sort by date ascending
        return messages.sorted { $0.date < $1.date }
    }

    // MARK: - Send Message

    func sendMessage(
        owner: String,
        repo: String,
        channel: String,
        content: String,
        from: String
    ) async throws -> Message {
        guard let api = api else {
            throw GitHubAPIError.unauthorized
        }

        let filename = MessageParser.generateFilename(sender: from)
        let fileContent = MessageParser.generateMessageContent(from: from, content: content)
        let path = "\(channel)/\(filename)"

        let response = try await api.createFile(
            owner: owner,
            repo: repo,
            path: path,
            content: fileContent,
            message: "Message from \(from)"
        )

        // Parse the created message
        let result = MessageParser.parse(
            filename: filename,
            content: fileContent,
            sha: response.content.sha
        )

        switch result {
        case .success(let message):
            return message
        case .failure(let error):
            throw NSError(domain: "MessageParser", code: -1, userInfo: [NSLocalizedDescriptionKey: error.error])
        }
    }

    // MARK: - Create Channel

    func createChannel(owner: String, repo: String, name: String) async throws {
        guard let api = api else {
            throw GitHubAPIError.unauthorized
        }

        try await api.createChannel(owner: owner, repo: repo, channelName: name)
    }
}
