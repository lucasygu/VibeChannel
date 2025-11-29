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
        .task {
            await viewModel.initialize(with: authService.currentUser)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
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

    private var api: GitHubAPIClient?
    private var currentUser: GitHubUser?

    var owner: String {
        selectedRepository?.owner ?? ""
    }

    var repo: String {
        selectedRepository?.name ?? ""
    }

    func initialize(with user: GitHubUser?) async {
        guard let user = user else { return }

        self.currentUser = user
        self.api = GitHubAPIClient(accessToken: user.accessToken)
        SyncService.shared.configure(with: user.accessToken)

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
            let fetchedChannels = try await SyncService.shared.fetchChannels(
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

            // Start polling
            SyncService.shared.startPolling(owner: repo.owner, repo: repo.name) { [weak self] in
                Task { @MainActor in
                    await self?.loadMessages()
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
        await loadMessages()
    }

    func loadMessages() async {
        guard let repo = selectedRepository,
              let channel = selectedChannel else { return }

        do {
            let fetchedMessages = try await SyncService.shared.fetchMessages(
                owner: repo.owner,
                repo: repo.name,
                channel: channel.id
            )
            self.messages = fetchedMessages
            self.error = nil
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
            let message = try await SyncService.shared.sendMessage(
                owner: repo.owner,
                repo: repo.name,
                channel: channel.id,
                content: content,
                from: user.login
            )

            // Add to local messages immediately
            messages.append(message)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createChannel(name: String) async {
        guard let repo = selectedRepository else { return }

        do {
            try await SyncService.shared.createChannel(
                owner: repo.owner,
                repo: repo.name,
                name: name
            )

            // Reload channels
            await loadChannels()

            // Select the new channel
            if let newChannel = channels.first(where: { $0.id == name }) {
                await selectChannel(newChannel)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refresh() async {
        await loadMessages()
    }
}

#Preview {
    MainView()
        .environmentObject(GitHubAuthService.shared)
}
