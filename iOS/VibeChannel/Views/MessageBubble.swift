//
//  MessageBubble.swift
//  VibeChannel
//
//  Individual message display with sender info and content.
//

import SwiftUI

struct MessageBubble: View {
    let message: Message
    var parentMessage: Message?  // The message this is replying to
    var onReply: (() -> Void)?
    var onEdit: (() -> Void)?
    var onDelete: (() -> Void)?
    var onCopy: (() -> Void)?
    var onTapParent: (() -> Void)?
    var onCreateIssue: (() -> Void)?  // Create GitHub issue from this message
    var isHighlighted: Bool = false

    // Repository info for loading images from raw.githubusercontent.com
    var owner: String = ""
    var repo: String = ""

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
                // Reply preview (if this message is a reply)
                if let parent = parentMessage {
                    Button(action: { onTapParent?() }) {
                        HStack(spacing: 6) {
                            Rectangle()
                                .fill(parentSenderColor(parent.from))
                                .frame(width: 2)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(parent.from)
                                    .font(.caption2)
                                    .fontWeight(.semibold)
                                    .foregroundStyle(parentSenderColor(parent.from))

                                Text(parent.content.prefix(50) + (parent.content.count > 50 ? "..." : ""))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.vertical, 4)
                        .padding(.horizontal, 8)
                        .background(Color.secondary.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                    .buttonStyle(.plain)
                }

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

                    if message.edited != nil {
                        Text("(edited)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Content (with markdown rendering)
                RichMessageContent(content: message.content)
                    .font(.body)

                // Images (from .assets/)
                if let images = message.images, !images.isEmpty {
                    MessageImagesView(images: images, owner: owner, repo: repo)
                }

                // File attachments
                if let attachments = message.attachments, !attachments.isEmpty {
                    MessageAttachmentsView(attachments: attachments)
                }

                // Referenced files
                if let files = message.files, !files.isEmpty {
                    MessageFilesView(files: files)
                }

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

                // GitHub Issue Link
                if let issueUrl = message.githubIssue, let url = URL(string: issueUrl) {
                    Link(destination: url) {
                        HStack(spacing: 4) {
                            Image(systemName: "link.circle.fill")
                                .font(.caption)
                            Text("View Issue")
                                .font(.caption)
                        }
                        .foregroundStyle(.purple)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.purple.opacity(0.1))
                        .clipShape(Capsule())
                    }
                    .padding(.top, 4)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .background(isHighlighted ? Color.yellow.opacity(0.2) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .contextMenu {
            Button(action: { onReply?() }) {
                Label("Reply", systemImage: "arrowshape.turn.up.left")
            }

            Button(action: { onCopy?() }) {
                Label("Copy", systemImage: "doc.on.doc")
            }

            // Only show "Create Issue" if no issue is linked yet and callback is provided
            if message.githubIssue == nil, let createIssue = onCreateIssue {
                Button(action: { createIssue() }) {
                    Label("Create GitHub Issue", systemImage: "exclamationmark.bubble")
                }
            }

            // Open existing issue in browser
            if let issueUrl = message.githubIssue, let url = URL(string: issueUrl) {
                Link(destination: url) {
                    Label("View Issue", systemImage: "link")
                }
            }

            if onEdit != nil {
                Button(action: { onEdit?() }) {
                    Label("Edit", systemImage: "pencil")
                }
            }

            if onDelete != nil {
                Button(role: .destructive, action: { onDelete?() }) {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    private func parentSenderColor(_ sender: String) -> Color {
        let colors: [Color] = [.blue, .green, .orange, .pink, .purple, .teal]
        var hash = 0
        for char in sender.unicodeScalars {
            hash = ((hash << 5) &- hash) &+ Int(char.value)
        }
        return colors[abs(hash) % colors.count]
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
    let parentMessage = Message(
        id: "test-1",
        filename: "20250115T103045-alice-abc123.md",
        from: "alice",
        date: Date().addingTimeInterval(-3700),
        content: "Hello, this is the original message!",
        rawContent: ""
    )

    return VStack {
        MessageBubble(message: Message(
            id: "test-1",
            filename: "20250115T103045-alice-abc123.md",
            from: "alice",
            date: Date(),
            content: "Hello, this is a test message!",
            rawContent: ""
        ))

        MessageBubble(
            message: Message(
                id: "test-2",
                filename: "20250115T103145-bob-def456.md",
                from: "bob",
                date: Date().addingTimeInterval(-3600),
                replyTo: "20250115T103045-alice-abc123.md",
                tags: ["important", "review"],
                content: "This is a reply with some **markdown** content.",
                rawContent: ""
            ),
            parentMessage: parentMessage
        )

        MessageBubble(
            message: Message(
                id: "test-3",
                filename: "20250115T103245-charlie-ghi789.md",
                from: "charlie",
                date: Date().addingTimeInterval(-1800),
                edited: Date(),
                content: "This message was edited.",
                rawContent: ""
            )
        )
    }
    .padding()
}
