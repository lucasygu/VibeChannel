//
//  Message.swift
//  VibeChannel
//
//  Data model for a VibeChannel message.
//  Matches the format from the VSCode extension.
//

import Foundation

struct Message: Identifiable, Codable, Equatable {
    let id: String           // filename without .md
    let filename: String     // Full filename: 20250115T103045-alice-abc123.md
    let from: String         // Sender username
    let date: Date           // ISO 8601 timestamp
    let replyTo: String?     // Optional: filename of parent message
    let tags: [String]?      // Optional: array of tags
    let edited: Date?        // Optional: last edit timestamp
    let content: String      // Markdown content (body after frontmatter)
    let rawContent: String   // Full file content including frontmatter
    var sha: String?         // GitHub file SHA (for updates/deletes)
    var isPending: Bool = false  // True if not yet synced to GitHub

    // Attachments (matching VS Code extension)
    var files: [String]?       // @ referenced files (paths in repo)
    var images: [String]?      // Pasted images (paths in .assets/)
    var attachments: [String]? // Pasted files (paths in .assets/)

    init(
        id: String,
        filename: String,
        from: String,
        date: Date,
        replyTo: String? = nil,
        tags: [String]? = nil,
        edited: Date? = nil,
        content: String,
        rawContent: String,
        sha: String? = nil,
        isPending: Bool = false,
        files: [String]? = nil,
        images: [String]? = nil,
        attachments: [String]? = nil
    ) {
        self.id = id
        self.filename = filename
        self.from = from
        self.date = date
        self.replyTo = replyTo
        self.tags = tags
        self.edited = edited
        self.content = content
        self.rawContent = rawContent
        self.sha = sha
        self.isPending = isPending
        self.files = files
        self.images = images
        self.attachments = attachments
    }
}
