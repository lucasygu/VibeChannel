//
//  ChatView.swift
//  VibeChannel
//
//  Main chat view displaying messages and input.
//

import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct ChatView: View {
    @ObservedObject var viewModel: MainViewModel
    let channel: Channel

    @State private var messageText = ""
    @FocusState private var isInputFocused: Bool
    @State private var highlightedMessageId: UUID?
    @State private var editingMessage: Message?
    @State private var showDeleteConfirmation = false
    @State private var messageToDelete: Message?

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
                                MessageBubble(
                                    message: message,
                                    parentMessage: findParentMessage(for: message),
                                    onReply: { viewModel.setReplyingTo(message) },
                                    onEdit: canEdit(message) ? { startEditing(message) } : nil,
                                    onDelete: canDelete(message) ? { confirmDelete(message) } : nil,
                                    onCopy: { copyToClipboard(message.content) },
                                    onTapParent: {
                                        if let parentId = message.replyToId {
                                            scrollToMessage(id: parentId, proxy: proxy)
                                        }
                                    },
                                    isHighlighted: highlightedMessageId == message.id
                                )
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

            // Typing indicator
            if !viewModel.onlineUsers.filter({ $0.value == .typing && $0.key != viewModel.currentUserId }).isEmpty {
                HStack {
                    TypingIndicator()
                    Text("Someone is typing...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.vertical, 4)
            }

            Divider()

            // Input
            MessageInput(
                text: $messageText,
                channelName: channel.name,
                isFocused: $isInputFocused,
                replyingTo: viewModel.replyingTo,
                onSend: sendMessage,
                onCancelReply: { viewModel.setReplyingTo(nil) },
                onTypingChanged: { isTyping in
                    Task {
                        await viewModel.setTyping(isTyping)
                    }
                }
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

                    // Online users count
                    let onlineCount = viewModel.onlineUsers.filter { $0.value != .offline }.count
                    if onlineCount > 0 {
                        HStack(spacing: 4) {
                            Circle()
                                .fill(.green)
                                .frame(width: 8, height: 8)
                            Text("\(onlineCount) online")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text("\(viewModel.messages.count) messages")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .alert("Delete Message?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) {
                messageToDelete = nil
            }
            Button("Delete", role: .destructive) {
                if let message = messageToDelete {
                    Task {
                        await viewModel.deleteMessage(message)
                    }
                }
                messageToDelete = nil
            }
        } message: {
            Text("This action cannot be undone.")
        }
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(
                message: message,
                onSave: { newContent in
                    Task {
                        await viewModel.editMessage(message, newContent: newContent)
                    }
                }
            )
        }
    }

    // MARK: - Helper Functions

    private func findParentMessage(for message: Message) -> Message? {
        guard let replyToId = message.replyToId else { return nil }
        return viewModel.messages.first { $0.id == replyToId }
    }

    private func canEdit(_ message: Message) -> Bool {
        // Can only edit your own messages
        guard let currentUser = viewModel.currentUserLogin else { return false }
        return message.sender.lowercased() == currentUser.lowercased()
    }

    private func canDelete(_ message: Message) -> Bool {
        // Can only delete your own messages
        guard let currentUser = viewModel.currentUserLogin else { return false }
        return message.sender.lowercased() == currentUser.lowercased()
    }

    private func scrollToMessage(id: UUID, proxy: ScrollViewProxy) {
        withAnimation {
            proxy.scrollTo(id, anchor: .center)
        }

        // Highlight the message briefly
        highlightedMessageId = id
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation {
                highlightedMessageId = nil
            }
        }
    }

    private func copyToClipboard(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #endif
    }

    private func startEditing(_ message: Message) {
        editingMessage = message
    }

    private func confirmDelete(_ message: Message) {
        messageToDelete = message
        showDeleteConfirmation = true
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

// MARK: - Typing Indicator

struct TypingIndicator: View {
    @State private var animationOffset = 0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(.secondary)
                    .frame(width: 6, height: 6)
                    .offset(y: animationOffset == index ? -3 : 0)
            }
        }
        .onAppear {
            withAnimation(Animation.easeInOut(duration: 0.5).repeatForever()) {
                animationOffset = (animationOffset + 1) % 3
            }
        }
    }
}

// MARK: - Edit Message Sheet

struct EditMessageSheet: View {
    let message: Message
    let onSave: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var editedContent: String

    init(message: Message, onSave: @escaping (String) -> Void) {
        self.message = message
        self.onSave = onSave
        self._editedContent = State(initialValue: message.content)
    }

    var body: some View {
        NavigationStack {
            VStack {
                TextEditor(text: $editedContent)
                    .padding()
            }
            .navigationTitle("Edit Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(editedContent)
                        dismiss()
                    }
                    .disabled(editedContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ChatView(
            viewModel: MainViewModel(),
            channel: Channel(repoId: UUID(), name: "general")
        )
    }
}
