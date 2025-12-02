//
//  MainView.swift
//  VibeChannel
//
//  Main navigation view with sidebar and chat content.
//

import SwiftUI
import Combine

struct MainView: View {
    @EnvironmentObject var authService: GitHubAuthService
    @StateObject private var viewModel = MainViewModel()

    var body: some View {
        ZStack(alignment: .top) {
            NavigationSplitView {
                ChannelSidebar(
                    viewModel: viewModel,
                    onSignOut: { authService.signOut() }
                )
            } detail: {
                if let channel = viewModel.selectedChannel {
                    ChatView(viewModel: viewModel, channel: channel)
                } else {
                    ContentUnavailableView(
                        "Select a Channel",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text("Choose a channel from the sidebar to start chatting")
                    )
                }
            }
            .navigationSplitViewStyle(.balanced)

            // Rate limit warning banner
            if let rateLimitWarning = viewModel.rateLimitWarning {
                RateLimitBanner(warning: rateLimitWarning)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .task {
            await viewModel.initialize(with: authService.currentUser)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Rate Limit Banner

struct RateLimitBanner: View {
    let warning: RateLimitWarning

    var body: some View {
        HStack {
            Image(systemName: warning.isCritical ? "exclamationmark.triangle.fill" : "exclamationmark.circle.fill")
            Text(warning.message)
                .font(.subheadline)
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(warning.isCritical ? Color.red : Color.orange)
        .foregroundColor(.white)
    }
}

struct RateLimitWarning {
    let message: String
    let isCritical: Bool
}

// MARK: - View Model

@MainActor
class MainViewModel: ObservableObject {
    @Published var repositories: [Repository] = []
    @Published var selectedRepository: Repository?
    @Published var channels: [Channel] = []
    @Published var selectedChannel: Channel?
    @Published var messages: [Message] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var rateLimitWarning: RateLimitWarning?

    // Reply state
    @Published var replyingTo: Message?

    private var api: GitHubAPIClient?
    private var currentUser: GitHubUser?
    private let repository = MessageRepository.shared

    var owner: String {
        selectedRepository?.owner ?? ""
    }

    var repo: String {
        selectedRepository?.name ?? ""
    }

    /// The current user's login (username)
    var currentUserLogin: String? {
        currentUser?.login
    }

    func initialize(with user: GitHubUser?) async {
        guard let user = user else { return }

        self.currentUser = user
        self.api = GitHubAPIClient(accessToken: user.accessToken)
        SyncService.shared.configure(with: user.accessToken)

        // Configure MessageRepository with SwiftData
        do {
            try repository.configure(with: user.accessToken)
        } catch {
            print("🔴 [DEBUG] Failed to configure MessageRepository: \(error)")
            self.error = "Failed to initialize cache: \(error.localizedDescription)"
        }

        await loadRepositories()
    }

    func loadRepositories() async {
        guard let api = api else { return }

        isLoading = true
        error = nil

        do {
            let repos = try await api.listUserRepos()
            self.repositories = repos

            // Auto-select first repo if none selected
            if selectedRepository == nil, let first = repos.first {
                await selectRepository(first)
            }
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func selectRepository(_ repo: Repository) async {
        print("🔵 [DEBUG] selectRepository called: \(repo.fullName)")
        selectedRepository = repo
        selectedChannel = nil
        messages = []
        replyingTo = nil
        await loadChannels()
    }

    func loadChannels() async {
        guard let repo = selectedRepository else {
            print("🔴 [DEBUG] loadChannels: No repository selected")
            return
        }

        print("🔵 [DEBUG] loadChannels: Loading channels for \(repo.owner)/\(repo.name)")
        isLoading = true
        error = nil

        do {
            // Use MessageRepository with caching
            let fetchedChannels = try await repository.fetchChannels(
                owner: repo.owner,
                repo: repo.name
            )
            print("🟢 [DEBUG] loadChannels: Found \(fetchedChannels.count) channels: \(fetchedChannels.map { $0.name })")
            self.channels = fetchedChannels

            // Auto-select "general" or first channel
            if selectedChannel == nil {
                if let general = fetchedChannels.first(where: { $0.name == "general" }) {
                    print("🔵 [DEBUG] Auto-selecting 'general' channel")
                    await selectChannel(general)
                } else if let first = fetchedChannels.first {
                    print("🔵 [DEBUG] Auto-selecting first channel: \(first.name)")
                    await selectChannel(first)
                } else {
                    print("🟡 [DEBUG] No channels found to select")
                }
            }

            // Start polling for changes
            SyncService.shared.startPolling(owner: repo.owner, repo: repo.name) { [weak self] in
                Task { @MainActor in
                    await self?.loadMessages(forceRefresh: true)
                }
            }
        } catch {
            print("🔴 [DEBUG] loadChannels ERROR: \(error)")
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func selectChannel(_ channel: Channel) async {
        selectedChannel = channel
        replyingTo = nil
        await loadMessages()
    }

    func loadMessages(forceRefresh: Bool = false) async {
        guard let repo = selectedRepository,
              let channel = selectedChannel else { return }

        do {
            // Use MessageRepository with caching
            let fetchedMessages = try await repository.fetchMessages(
                owner: repo.owner,
                repo: repo.name,
                channel: channel.id,
                forceRefresh: forceRefresh
            )
            self.messages = fetchedMessages
            self.error = nil

            // Update rate limit warning
            updateRateLimitWarning()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func sendMessage(_ content: String) async {
        guard let repo = selectedRepository,
              let channel = selectedChannel,
              let user = currentUser,
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        do {
            // Use MessageRepository write-through
            let message = try await repository.sendMessage(
                owner: repo.owner,
                repo: repo.name,
                channel: channel.id,
                content: content,
                from: user.login,
                replyTo: replyingTo?.filename
            )

            // Add to local messages immediately
            messages.append(message)

            // Clear reply state
            replyingTo = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func editMessage(_ message: Message, newContent: String) async {
        guard let repo = selectedRepository,
              let channel = selectedChannel else { return }

        do {
            let updatedMessage = try await repository.editMessage(
                owner: repo.owner,
                repo: repo.name,
                channel: channel.id,
                message: message,
                newContent: newContent
            )

            // Update in local messages
            if let index = messages.firstIndex(where: { $0.id == message.id }) {
                messages[index] = updatedMessage
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteMessage(_ message: Message) async {
        guard let repo = selectedRepository,
              let channel = selectedChannel else { return }

        do {
            try await repository.deleteMessage(
                owner: repo.owner,
                repo: repo.name,
                channel: channel.id,
                message: message
            )

            // Remove from local messages
            messages.removeAll { $0.id == message.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setReplyingTo(_ message: Message?) {
        replyingTo = message
    }

    func createChannel(name: String) async {
        guard let repo = selectedRepository else { return }

        do {
            try await SyncService.shared.createChannel(
                owner: repo.owner,
                repo: repo.name,
                name: name
            )

            // Reload channels (force refresh to get new channel)
            let fetchedChannels = try await repository.fetchChannels(
                owner: repo.owner,
                repo: repo.name,
                forceRefresh: true
            )
            self.channels = fetchedChannels

            // Select the new channel
            if let newChannel = channels.first(where: { $0.id == name }) {
                await selectChannel(newChannel)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refresh() async {
        await loadMessages(forceRefresh: true)
    }

    // MARK: - Rate Limit

    private func updateRateLimitWarning() {
        guard let info = repository.getRateLimitInfo() else {
            rateLimitWarning = nil
            return
        }

        if info.isExhausted {
            let resetTime = info.resetDate.map { formatResetTime($0) } ?? "soon"
            rateLimitWarning = RateLimitWarning(
                message: "Rate limit exhausted. Resets \(resetTime)",
                isCritical: true
            )
        } else if info.isCritical {
            rateLimitWarning = RateLimitWarning(
                message: "Rate limit critical: \(info.remaining) requests remaining",
                isCritical: true
            )
        } else if info.isWarning {
            rateLimitWarning = RateLimitWarning(
                message: "Rate limit warning: \(info.remaining) requests remaining",
                isCritical: false
            )
        } else {
            rateLimitWarning = nil
        }
    }

    private func formatResetTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    // MARK: - GitHub Issue Creation

    /// Create a GitHub issue from a message
    /// - Parameter message: The message to create an issue from
    /// - Returns: The URL of the created issue, or nil if failed
    func createGitHubIssue(from message: Message) async -> String? {
        guard let repo = selectedRepository,
              let channel = selectedChannel else {
            error = "No repository or channel selected"
            return nil
        }

        // Build issue title (first line, truncated to 80 chars)
        let firstLine = message.content.components(separatedBy: .newlines).first ?? "VibeChannel Message"
        let title = firstLine.count > 80 ? String(firstLine.prefix(77)) + "..." : firstLine

        // Build issue body with images/files/attachments
        var issueBody = message.content

        // Append images as markdown
        if let images = message.images, !images.isEmpty {
            issueBody += "\n\n---\n\n**Attached Images:**\n\n"
            for imagePath in images {
                let imageUrl = "https://raw.githubusercontent.com/\(repo.owner)/\(repo.name)/vibechannel/\(imagePath)"
                let filename = (imagePath as NSString).lastPathComponent
                issueBody += "![\(filename)](\(imageUrl))\n\n"
            }
        }

        // Append file references as links
        if let files = message.files, !files.isEmpty {
            issueBody += "\n\n---\n\n**Referenced Files:**\n\n"
            for filePath in files {
                let fileUrl = "https://github.com/\(repo.owner)/\(repo.name)/blob/HEAD/\(filePath)"
                issueBody += "- [\(filePath)](\(fileUrl))\n"
            }
        }

        // Append attachments as links
        if let attachments = message.attachments, !attachments.isEmpty {
            issueBody += "\n\n---\n\n**Attachments:**\n\n"
            for attachmentPath in attachments {
                let attachmentUrl = "https://raw.githubusercontent.com/\(repo.owner)/\(repo.name)/vibechannel/\(attachmentPath)"
                let filename = (attachmentPath as NSString).lastPathComponent
                issueBody += "- [\(filename)](\(attachmentUrl))\n"
            }
        }

        do {
            // Create the issue via API
            let issue = try await repository.createGitHubIssue(
                owner: repo.owner,
                repo: repo.name,
                title: title,
                body: issueBody
            )

            // Update the message file to add github_issue field
            let updatedMessage = try await repository.updateMessageWithIssue(
                owner: repo.owner,
                repo: repo.name,
                channel: channel.id,
                message: message,
                issueUrl: issue.htmlUrl
            )

            // Update in local messages
            if let index = messages.firstIndex(where: { $0.id == message.id }) {
                messages[index] = updatedMessage
            }

            return issue.htmlUrl
        } catch {
            self.error = "Failed to create issue: \(error.localizedDescription)"
            return nil
        }
    }
}

#Preview {
    MainView()
        .environmentObject(GitHubAuthService.shared)
}
