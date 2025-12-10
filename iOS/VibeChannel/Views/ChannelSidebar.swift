//
//  ChannelSidebar.swift
//  VibeChannel
//
//  Sidebar showing repositories and channels (Slack-like).
//

import SwiftUI

struct ChannelSidebar: View {
    @ObservedObject var viewModel: MainViewModel
    @EnvironmentObject var auth: AuthService
    let onSignOut: () -> Void
    var onChannelSelected: (() -> Void)? = nil

    @State private var showingRepoSelector = false
    @State private var showingNewChannel = false
    @State private var newChannelName = ""

    var body: some View {
        List {
            // Repository Section
            Section {
                Button(action: { showingRepoSelector = true }) {
                    HStack {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(.blue)
                        VStack(alignment: .leading) {
                            Text(viewModel.selectedRepo?.name ?? "Select Repository")
                                .fontWeight(.semibold)
                            if let repo = viewModel.selectedRepo {
                                Text(repo.owner)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            }

            // Channels Section
            Section {
                ForEach(viewModel.channels) { channel in
                    ChannelRow(
                        channel: channel,
                        isSelected: channel.id == viewModel.selectedChannel?.id,
                        onlineCount: countOnlineInChannel(channel.id),
                        onTap: {
                            Task {
                                await viewModel.selectChannel(channel)
                            }
                            onChannelSelected?()
                        }
                    )
                }
            } header: {
                HStack {
                    Text("Channels")
                    Spacer()
                    Button(action: { showingNewChannel = true }) {
                        Image(systemName: "plus")
                            .font(.caption)
                    }
                }
            }

            // User Section
            Section {
                if let user = auth.currentUser {
                    HStack(spacing: 12) {
                        AsyncImage(url: URL(string: user.avatarUrl ?? "")) { image in
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } placeholder: {
                            Circle()
                                .fill(.gray.opacity(0.3))
                        }
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 6))

                        VStack(alignment: .leading) {
                            Text(user.displayName)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Text("@\(user.githubLogin)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button(role: .destructive, action: onSignOut) {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("VibeChannel")
        .sheet(isPresented: $showingRepoSelector) {
            RepositorySelectorSheet(viewModel: viewModel, isPresented: $showingRepoSelector)
        }
        .alert("New Channel", isPresented: $showingNewChannel) {
            TextField("Channel name", text: $newChannelName)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {
                newChannelName = ""
            }
            Button("Create") {
                let name = newChannelName.lowercased().replacingOccurrences(of: " ", with: "-")
                Task {
                    await viewModel.createChannel(name: name)
                }
                newChannelName = ""
            }
            .disabled(newChannelName.isEmpty)
        } message: {
            Text("Enter a name for the new channel")
        }
    }

    private func countOnlineInChannel(_ channelId: UUID) -> Int {
        // Count users who are online in this channel (excluding self)
        return viewModel.onlineUsers.filter { (userId, status) in
            status != .offline && userId != viewModel.currentUserId
        }.count
    }
}

// MARK: - Channel Row

struct ChannelRow: View {
    let channel: Channel
    let isSelected: Bool
    let onlineCount: Int
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                Text("#")
                    .foregroundStyle(.secondary)
                Text(channel.name)
                    .foregroundStyle(isSelected ? .primary : .primary)

                Spacer()

                // Online indicator
                if onlineCount > 0 {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(.green)
                            .frame(width: 6, height: 6)
                        Text("\(onlineCount)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                if channel.unreadCount > 0 {
                    Text("\(channel.unreadCount)")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.red)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
    }
}

// MARK: - Repository Selector Sheet

struct RepositorySelectorSheet: View {
    @ObservedObject var viewModel: MainViewModel
    @Binding var isPresented: Bool
    @State private var searchText = ""

    var filteredRepos: [Repo] {
        if searchText.isEmpty {
            return viewModel.repos
        }
        return viewModel.repos.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.fullName.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            List(filteredRepos) { repo in
                Button {
                    Task {
                        await viewModel.selectRepo(repo)
                    }
                    isPresented = false
                } label: {
                    HStack {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(.blue)

                        VStack(alignment: .leading) {
                            Text(repo.name)
                                .fontWeight(.medium)
                            Text(repo.owner)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        if repo == viewModel.selectedRepo {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.blue)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .searchable(text: $searchText, prompt: "Search repositories")
            .navigationTitle("Select Repository")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        isPresented = false
                    }
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ChannelSidebar(
            viewModel: MainViewModel(),
            onSignOut: {}
        )
        .environmentObject(SupabaseService.shared.auth)
    }
}
