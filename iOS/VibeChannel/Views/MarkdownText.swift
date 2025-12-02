//
//  MarkdownText.swift
//  VibeChannel
//
//  Renders markdown content using iOS 15+ AttributedString.
//  Supports basic markdown: bold, italic, code, links, and lists.
//

import SwiftUI

struct MarkdownText: View {
    let content: String

    var body: some View {
        Text(attributedContent)
            .textSelection(.enabled)
    }

    private var attributedContent: AttributedString {
        // Try to parse as markdown
        if let attributed = try? AttributedString(markdown: content, options: .init(
            allowsExtendedAttributes: true,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )) {
            return attributed
        }

        // Fallback to plain text
        return AttributedString(content)
    }
}

// MARK: - Code Block View

struct CodeBlockView: View {
    let code: String
    let language: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let lang = language, !lang.isEmpty {
                Text(lang)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Rich Message Content View

struct RichMessageContent: View {
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(parseBlocks(content), id: \.id) { block in
                switch block.type {
                case .text(let text):
                    MarkdownText(content: text)
                case .codeBlock(let code, let language):
                    CodeBlockView(code: code, language: language)
                }
            }
        }
    }

    private func parseBlocks(_ content: String) -> [ContentBlock] {
        var blocks: [ContentBlock] = []
        var currentText = ""
        var inCodeBlock = false
        var codeBlockContent = ""
        var codeBlockLanguage: String?
        var blockId = 0

        let lines = content.components(separatedBy: "\n")

        for line in lines {
            if line.hasPrefix("```") {
                if inCodeBlock {
                    // End code block
                    blocks.append(ContentBlock(
                        id: blockId,
                        type: .codeBlock(code: codeBlockContent.trimmingCharacters(in: .newlines), language: codeBlockLanguage)
                    ))
                    blockId += 1
                    codeBlockContent = ""
                    codeBlockLanguage = nil
                    inCodeBlock = false
                } else {
                    // Start code block - save any pending text
                    if !currentText.isEmpty {
                        blocks.append(ContentBlock(id: blockId, type: .text(currentText.trimmingCharacters(in: .newlines))))
                        blockId += 1
                        currentText = ""
                    }
                    // Extract language if present
                    let lang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                    codeBlockLanguage = lang.isEmpty ? nil : lang
                    inCodeBlock = true
                }
            } else if inCodeBlock {
                codeBlockContent += line + "\n"
            } else {
                currentText += line + "\n"
            }
        }

        // Handle any remaining content
        if !currentText.isEmpty {
            blocks.append(ContentBlock(id: blockId, type: .text(currentText.trimmingCharacters(in: .newlines))))
        }

        return blocks
    }
}

// MARK: - Content Block Model

private struct ContentBlock: Identifiable {
    let id: Int
    let type: BlockType

    enum BlockType {
        case text(String)
        case codeBlock(code: String, language: String?)
    }
}

#Preview {
    ScrollView {
        VStack(alignment: .leading, spacing: 20) {
            RichMessageContent(content: "Hello **world**! This is *italic* and `inline code`.")

            RichMessageContent(content: """
            Here's a code block:

            ```swift
            func greet() {
                print("Hello!")
            }
            ```

            And some text after.
            """)

            RichMessageContent(content: "Check out [this link](https://github.com)!")

            RichMessageContent(content: """
            - Item 1
            - Item 2
            - Item 3
            """)
        }
        .padding()
    }
}
