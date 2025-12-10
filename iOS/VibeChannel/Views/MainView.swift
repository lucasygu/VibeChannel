//
//  MainView.swift
//  VibeChannel
//
//  Main navigation view with sidebar and chat content.
//  Uses Supabase for data and real-time updates.
//

import SwiftUI
import Combine

struct MainView: View {
    @EnvironmentObject var supabase: SupabaseService
    @EnvironmentObject var auth: AuthService
    @EnvironmentObject var realtime: RealtimeService
    @StateObject private var viewModel = MainViewModel()
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            ChannelSidebar(
                viewModel: viewModel,
                onSignOut: {
                    Task {
                        try? await auth.signOut()
                    }
                },
                onChannelSelected: {
                    // On iPhone, show the detail view when a channel is selected
                    columnVisibility = .detailOnly
                }
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
            await viewModel.initialize(
                supabase: supabase,
                user: auth.currentUser
            )
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - View Model

@MainActor
class MainViewModel: ObservableObject {
    @Published var repos: [Repo] = []
    @Published var selectedRepo: Repo?
    @Published var channels: [Channel] = []
    @Published var selectedChannel: Channel?
    @Published var messages: [Message] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var onlineUsers: [UUID: PresenceStatus] = [:]

    // Reply state
    @Published var replyingTo: Message?

    // Typing indicator
    @Published var isTyping = false

    private var supabase: SupabaseService?
    private var currentUser: User?

    var currentUserLogin: String? {
        currentUser?.githubLogin
    }

    var currentUserId: UUID? {
        currentUser?.id
    }

    // MARK: - Initialization

    func initialize(supabase: SupabaseService, user: User?) async {
        guard let user = user else { return }

        self.supabase = supabase
        self.currentUser = user

        // Setup realtime callbacks
        setupRealtimeCallbacks()

        // Load repos
        await loadRepos()
    }

    private func setupRealtimeCallbacks() {
        guard let supabase = supabase else { return }

        supabase.realtime.onMessageInserted = { [weak self] message in
            guard let self = self else { return }
            // Only add if not already present (avoid duplicates from our own sends)
            if !self.messages.contains(where: { $0.id == message.id }) {
                self.messages.append(message)
            }
        }

        supabase.realtime.onMessageUpdated = { [weak self] message in
            guard let self = self else { return }
            if let index = self.messages.firstIndex(where: { $0.id == message.id }) {
                self.messages[index] = message
            }
        }

        supabase.realtime.onMessageDeleted = { [weak self] id in
            guard let self = self else { return }
            self.messages.removeAll { $0.id == id }
        }

        supabase.realtime.onPresenceChanged = { [weak self] presences in
            self?.onlineUsers = presences
        }
    }

    // MARK: - Load Repos

    func loadRepos() async {
        guard let supabase = supabase,
              let userId = currentUser?.id else { return }

        isLoading = true
        error = nil

        do {
            let fetchedRepos = try await supabase.repos.fetchUserRepos(userId: userId)
            self.repos = fetchedRepos

            // Auto-select first repo if none selected
            if selectedRepo == nil, let first = fetchedRepos.first {
                await selectRepo(first)
            }
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Select Repo

    func selectRepo(_ repo: Repo) async {
        selectedRepo = repo
        selectedChannel = nil
        messages = []
        replyingTo = nil
        await loadChannels()
    }

    // MARK: - Load Channels

    func loadChannels() async {
        guard let supabase = supabase,
              let repo = selectedRepo else { return }

        isLoading = true
        error = nil

        do {
            var fetchedChannels = try await supabase.channels.fetchChannels(repoId: repo.id)

            // Fetch unread counts
            if let userId = currentUser?.id {
                let unreadCounts = try await supabase.channels.fetchUnreadCounts(userId: userId, repoId: repo.id)
                for i in fetchedChannels.indices {
                    fetchedChannels[i].unreadCount = unreadCounts[fetchedChannels[i].id] ?? 0
                }
            }

            self.channels = fetchedChannels

            // Auto-select "general" or first channel
            if selectedChannel == nil {
                if let general = fetchedChannels.first(where: { $0.name == "general" }) {
                    await selectChannel(general)
                } else if let first = fetchedChannels.first {
                    await selectChannel(first)
                }
            }
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Select Channel

    func selectChannel(_ channel: Channel) async {
        print("[MainViewModel] selectChannel called for: \(channel.name)")
        print("[MainViewModel] supabase is nil: \(supabase == nil)")

        guard let supabase = supabase else {
            print("[MainViewModel] ERROR: supabase is nil, returning early")
            return
        }

        // Unsubscribe from previous channel
        await supabase.realtime.unsubscribeFromChannel()
        await supabase.realtime.unsubscribeFromPresence()

        print("[MainViewModel] Setting selectedChannel to: \(channel.name)")
        selectedChannel = channel
        replyingTo = nil

        // Load messages
        await loadMessages()

        // Subscribe to realtime updates
        await supabase.realtime.subscribeToChannel(channelId: channel.id)

        // Subscribe to presence
        if let userId = currentUser?.id {
            await supabase.realtime.subscribeToPresence(channelId: channel.id, userId: userId)

            // Update presence in database
            if let repoId = selectedRepo?.id {
                try? await supabase.presence.setOnline(repoId: repoId, channelId: channel.id)
            }
        }

        // Mark channel as read
        try? await supabase.channels.markChannelRead(channelId: channel.id)

        // Clear unread count locally
        if let index = channels.firstIndex(where: { $0.id == channel.id }) {
            channels[index].unreadCount = 0
        }
    }

    // MARK: - Load Messages

    func loadMessages() async {
        guard let supabase = supabase,
              let channel = selectedChannel else { return }

        do {
            let fetchedMessages = try await supabase.messages.fetchMessages(channelId: channel.id)
            self.messages = fetchedMessages
            self.error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Send Message

    func sendMessage(_ content: String) async {
        guard let supabase = supabase,
              let channel = selectedChannel,
              let user = currentUser,
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        do {
            let message = try await supabase.messages.sendMessage(
                channelId: channel.id,
                sender: user.githubLogin,
                senderUserId: user.id,
                content: content,
                replyToId: replyingTo?.id,
                tags: nil
            )

            // Add to local messages immediately (realtime will handle dedup)
            if !messages.contains(where: { $0.id == message.id }) {
                messages.append(message)
            }

            // Clear reply state
            replyingTo = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Edit Message

    func editMessage(_ message: Message, newContent: String) async {
        guard let supabase = supabase else { return }

        do {
            let updatedMessage = try await supabase.messages.editMessage(
                messageId: message.id,
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

    // MARK: - Delete Message

    func deleteMessage(_ message: Message) async {
        guard let supabase = supabase else { return }

        do {
            try await supabase.messages.deleteMessage(messageId: message.id)

            // Remove from local messages
            messages.removeAll { $0.id == message.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Reply

    func setReplyingTo(_ message: Message?) {
        replyingTo = message
    }

    // MARK: - Create Channel

    func createChannel(name: String) async {
        guard let supabase = supabase,
              let repo = selectedRepo else { return }

        do {
            let newChannel = try await supabase.channels.createChannel(
                repoId: repo.id,
                name: name
            )

            // Add to local channels
            channels.append(newChannel)

            // Select the new channel
            await selectChannel(newChannel)
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Refresh

    func refresh() async {
        await loadMessages()
    }

    // MARK: - Typing Indicator

    func setTyping(_ typing: Bool) async {
        guard let supabase = supabase,
              let repo = selectedRepo,
              let channel = selectedChannel else { return }

        isTyping = typing

        if typing {
            try? await supabase.presence.setTyping(repoId: repo.id, channelId: channel.id)
        } else {
            try? await supabase.presence.setOnline(repoId: repo.id, channelId: channel.id)
        }

        await supabase.realtime.updatePresenceStatus(typing ? .typing : .online)
    }
}

#Preview {
    MainView()
        .environmentObject(SupabaseService.shared)
        .environmentObject(SupabaseService.shared.auth)
        .environmentObject(SupabaseService.shared.realtime)
}
