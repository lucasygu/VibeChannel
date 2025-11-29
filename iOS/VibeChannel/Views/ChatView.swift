//
//  ChatView.swift
//  VibeChannel
//
//  Main chat view displaying messages and input.
//

import SwiftUI

struct ChatView: View {
    @ObservedObject var viewModel: MainViewModel
    let channel: Channel

    @State private var messageText = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(groupedMessages, id: \.0) { date, messages in
                            DateSeparator(date: date)
                                .padding(.vertical, 8)

                            ForEach(messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _, _ in
                    if let lastMessage = viewModel.messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    if let lastMessage = viewModel.messages.last {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }

            Divider()

            // Input
            MessageInput(
                text: $messageText,
                channelName: channel.name,
                isFocused: $isInputFocused,
                onSend: sendMessage
            )
        }
        .navigationTitle("#\(channel.name)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 16) {
                    if viewModel.isLoading {
                        ProgressView()
                    }

                    Text("\(viewModel.messages.count) messages")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Grouped Messages

    private var groupedMessages: [(String, [Message])] {
        let grouped = Dictionary(grouping: viewModel.messages) { message in
            formatDateKey(message.date)
        }
        return grouped.sorted { $0.key < $1.key }
    }

    private func formatDateKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    // MARK: - Send Message

    private func sendMessage() {
        let content = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        messageText = ""

        Task {
            await viewModel.sendMessage(content)
        }
    }
}

#Preview {
    NavigationStack {
        ChatView(
            viewModel: MainViewModel(),
            channel: Channel(id: "general")
        )
    }
}
