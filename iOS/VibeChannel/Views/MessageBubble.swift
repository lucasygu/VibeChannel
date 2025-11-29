//
//  MessageBubble.swift
//  VibeChannel
//
//  Individual message display with sender info and content.
//

import SwiftUI

struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Avatar
            AsyncImage(url: URL(string: "https://github.com/\(message.from).png?size=72")) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Circle()
                    .fill(senderColor.opacity(0.3))
                    .overlay {
                        Text(String(message.from.prefix(1)).uppercased())
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundStyle(senderColor)
                    }
            }
            .frame(width: 36, height: 36)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                // Header
                HStack(spacing: 8) {
                    Text(message.from)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(senderColor)

                    Text(formatTimestamp(message.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if message.isPending {
                        Image(systemName: "clock")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }

                    if message.replyTo != nil {
                        Image(systemName: "arrowshape.turn.up.left.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Content
                Text(message.content)
                    .font(.body)
                    .textSelection(.enabled)

                // Tags
                if let tags = message.tags, !tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.2))
                                .clipShape(Capsule())
                        }
                    }
                    .padding(.top, 4)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .background(Color.clear)
        .contentShape(Rectangle())
    }

    // MARK: - Sender Color

    private var senderColor: Color {
        let colors: [Color] = [.blue, .green, .orange, .pink, .purple, .teal]
        var hash = 0
        for char in message.from.unicodeScalars {
            hash = ((hash << 5) &- hash) &+ Int(char.value)
        }
        return colors[abs(hash) % colors.count]
    }

    // MARK: - Timestamp Formatting

    private func formatTimestamp(_ date: Date) -> String {
        let now = Date()
        let diff = now.timeIntervalSince(date)

        if diff < 60 {
            return "just now"
        }
        if diff < 3600 {
            let mins = Int(diff / 60)
            return "\(mins)m ago"
        }
        if diff < 86400 {
            let hours = Int(diff / 3600)
            return "\(hours)h ago"
        }
        if diff < 604800 {
            let days = Int(diff / 86400)
            return "\(days)d ago"
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: date)
    }
}

#Preview {
    VStack {
        MessageBubble(message: Message(
            id: "test-1",
            filename: "20250115T103045-alice-abc123.md",
            from: "alice",
            date: Date(),
            content: "Hello, this is a test message!",
            rawContent: ""
        ))

        MessageBubble(message: Message(
            id: "test-2",
            filename: "20250115T103145-bob-def456.md",
            from: "bob",
            date: Date().addingTimeInterval(-3600),
            tags: ["important", "review"],
            content: "This is a longer message with some **markdown** content that might wrap to multiple lines.",
            rawContent: ""
        ))
    }
    .padding()
}
