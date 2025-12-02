//
//  MessageAttachments.swift
//  VibeChannel
//
//  Views for displaying message attachments: images, files, and references.
//

import SwiftUI

// MARK: - Message Images View

struct MessageImagesView: View {
    let images: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(images, id: \.self) { imagePath in
                MessageImageView(path: imagePath)
            }
        }
        .padding(.top, 4)
    }
}

struct MessageImageView: View {
    let path: String
    @State private var showFullScreen = false

    var body: some View {
        // For now, show a placeholder - actual image loading would require
        // fetching from GitHub's raw content URL
        Button(action: { showFullScreen = true }) {
            HStack(spacing: 8) {
                Image(systemName: "photo")
                    .font(.title2)
                    .foregroundStyle(.blue)

                VStack(alignment: .leading, spacing: 2) {
                    Text(filename(from: path))
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Text(path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: "arrow.up.right.square")
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func filename(from path: String) -> String {
        (path as NSString).lastPathComponent
    }
}

// MARK: - Message Attachments View (Files in .assets/)

struct MessageAttachmentsView: View {
    let attachments: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(attachments, id: \.self) { attachment in
                AttachmentRow(path: attachment)
            }
        }
        .padding(.top, 4)
    }
}

struct AttachmentRow: View {
    let path: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconForFile(path))
                .font(.title3)
                .foregroundStyle(colorForFile(path))
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(filename(from: path))
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text("Attachment")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: "arrow.down.circle")
                .foregroundStyle(.blue)
        }
        .padding(10)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func filename(from path: String) -> String {
        (path as NSString).lastPathComponent
    }

    private func iconForFile(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "pdf":
            return "doc.text.fill"
        case "doc", "docx":
            return "doc.fill"
        case "xls", "xlsx":
            return "tablecells.fill"
        case "ppt", "pptx":
            return "rectangle.split.3x3.fill"
        case "zip", "tar", "gz":
            return "doc.zipper"
        case "mp3", "wav", "m4a":
            return "waveform"
        case "mp4", "mov", "avi":
            return "play.rectangle.fill"
        default:
            return "doc.fill"
        }
    }

    private func colorForFile(_ path: String) -> Color {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "pdf":
            return .red
        case "doc", "docx":
            return .blue
        case "xls", "xlsx":
            return .green
        case "ppt", "pptx":
            return .orange
        case "zip", "tar", "gz":
            return .purple
        case "mp3", "wav", "m4a":
            return .pink
        case "mp4", "mov", "avi":
            return .teal
        default:
            return .gray
        }
    }
}

// MARK: - Message Files View (@ referenced files)

struct MessageFilesView: View {
    let files: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(files, id: \.self) { file in
                FileReferenceRow(path: file)
            }
        }
        .padding(.top, 4)
    }
}

struct FileReferenceRow: View {
    let path: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "at")
                .font(.caption)
                .foregroundStyle(.blue)

            Text(path)
                .font(.subheadline)
                .foregroundStyle(.primary)

            Spacer()
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 10)
        .background(Color.blue.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

#Preview {
    ScrollView {
        VStack(alignment: .leading, spacing: 20) {
            Text("Images")
                .font(.headline)
            MessageImagesView(images: [
                ".assets/screenshot-001.png",
                ".assets/diagram.jpg"
            ])

            Divider()

            Text("Attachments")
                .font(.headline)
            MessageAttachmentsView(attachments: [
                ".assets/report.pdf",
                ".assets/data.xlsx",
                ".assets/archive.zip"
            ])

            Divider()

            Text("File References")
                .font(.headline)
            MessageFilesView(files: [
                "src/main.swift",
                "README.md"
            ])
        }
        .padding()
    }
}
