//
//  MessageInput.swift
//  VibeChannel
//
//  Message input field with send button and typing indicator support.
//

import SwiftUI

struct MessageInput: View {
    @Binding var text: String
    let channelName: String
    var isFocused: FocusState<Bool>.Binding
    var replyingTo: Message?
    let onSend: () -> Void
    var onCancelReply: (() -> Void)?
    var onTypingChanged: ((Bool) -> Void)?

    @State private var isTyping = false
    @State private var typingDebounce: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            // Reply preview bar
            if let replyMessage = replyingTo {
                HStack {
                    Rectangle()
                        .fill(replyColor(replyMessage.sender))
                        .frame(width: 3)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Replying to \(replyMessage.sender)")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundStyle(replyColor(replyMessage.sender))

                        Text(replyMessage.content.prefix(60) + (replyMessage.content.count > 60 ? "..." : ""))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    Button(action: { onCancelReply?() }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color(.systemGray6))

                Divider()
            }

            HStack(spacing: 12) {
                TextField("Message #\(channelName)", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .focused(isFocused)
                    .onChange(of: text) { _, newValue in
                        handleTypingChange(newValue)
                    }
                    .onSubmit {
                        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            onSend()
                            stopTyping()
                        }
                    }

                Button(action: {
                    onSend()
                    stopTyping()
                }) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundStyle(canSend ? .blue : .gray)
                }
                .disabled(!canSend)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .background(.bar)
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func handleTypingChange(_ newValue: String) {
        // Cancel previous debounce
        typingDebounce?.cancel()

        if !newValue.isEmpty && !isTyping {
            // Started typing
            isTyping = true
            onTypingChanged?(true)
        }

        // Debounce to stop typing after 2 seconds of inactivity
        typingDebounce = Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled {
                await MainActor.run {
                    stopTyping()
                }
            }
        }
    }

    private func stopTyping() {
        if isTyping {
            isTyping = false
            onTypingChanged?(false)
        }
        typingDebounce?.cancel()
    }

    private func replyColor(_ sender: String) -> Color {
        let colors: [Color] = [.blue, .green, .orange, .pink, .purple, .teal]
        var hash = 0
        for char in sender.unicodeScalars {
            hash = ((hash << 5) &- hash) &+ Int(char.value)
        }
        return colors[abs(hash) % colors.count]
    }
}

#Preview("Normal Input") {
    struct PreviewWrapper: View {
        @State private var text = ""
        @FocusState private var isFocused: Bool

        var body: some View {
            VStack {
                Spacer()
                MessageInput(
                    text: $text,
                    channelName: "general",
                    isFocused: $isFocused,
                    onSend: { print("Send: \(text)") }
                )
            }
        }
    }

    return PreviewWrapper()
}

#Preview("With Reply") {
    struct PreviewWrapper: View {
        @State private var text = ""
        @FocusState private var isFocused: Bool
        @State private var replyingTo: Message? = Message(
            channelId: UUID(),
            sender: "alice",
            content: "This is the message being replied to with some longer content that might be truncated.",
            githubPath: "general/20250115T103045-alice-abc123.md"
        )

        var body: some View {
            VStack {
                Spacer()
                MessageInput(
                    text: $text,
                    channelName: "general",
                    isFocused: $isFocused,
                    replyingTo: replyingTo,
                    onSend: { print("Send: \(text)") },
                    onCancelReply: { replyingTo = nil }
                )
            }
        }
    }

    return PreviewWrapper()
}
