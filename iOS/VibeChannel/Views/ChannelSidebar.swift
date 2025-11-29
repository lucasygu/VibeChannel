//
//  ChannelSidebar.swift
//  VibeChannel
//
//  Sidebar showing repositories and channels (Slack-like).
//

import SwiftUI

struct ChannelSidebar: View {
    @ObservedObject var viewModel: MainViewModel
    @EnvironmentObject var authService: GitHubAuthService
    let onSignOut: () -> Void

    @State private var showingRepoSelector = false
    @State private var showingNewChannel = false
    @State private var newChannelName = ""

    var body: some View {
        List(selection: Binding(
            get: { viewModel.selectedChannel },
            set: { channel in
                if let channel = channel {
                    Task {
                        await viewModel.selectChannel(channel)
                    }
                }
            }
        )) {
            // Repository Section
            Section {
                Button(action: { showingRepoSelector = true }) {
                    HStack {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(.blue)
                        VStack(alignment: .leading) {
                            Text(viewModel.selectedRepository?.name ?? "Select Repository")
                                .fontWeight(.semibold)
                            if let repo = viewModel.selectedRepository {
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
                        isSelected: channel == viewModel.selectedChannel
                    )
                    .tag(channel)
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
                if let user = authService.currentUser {
                    HStack(spacing: 12) {
                        AsyncImage(url: URL(string: user.avatarUrl)) { image in
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
                            Text("@\(user.login)")
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
}

// MARK: - Channel Row

struct ChannelRow: View {
    let channel: Channel
    let isSelected: Bool

    var body: some View {
        HStack {
            Text("#")
                .foregroundStyle(.secondary)
            Text(channel.name)

            Spacer()

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
    }
}

// MARK: - Repository Selector Sheet

struct RepositorySelectorSheet: View {
    @ObservedObject var viewModel: MainViewModel
    @Binding var isPresented: Bool
    @State private var searchText = ""

    var filteredRepos: [Repository] {
        if searchText.isEmpty {
            return viewModel.repositories
        }
        return viewModel.repositories.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.fullName.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            List(filteredRepos) { repo in
                Button {
                    Task {
                        await viewModel.selectRepository(repo)
                    }
                    isPresented = false
                } label: {
                    HStack {
                        Image(systemName: repo.isPrivate ? "lock.fill" : "folder.fill")
                            .foregroundStyle(repo.isPrivate ? .orange : .blue)

                        VStack(alignment: .leading) {
                            Text(repo.name)
                                .fontWeight(.medium)
                            Text(repo.owner)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        if repo == viewModel.selectedRepository {
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
        .environmentObject(GitHubAuthService.shared)
    }
}
