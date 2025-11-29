//
//  MessageParser.swift
//  VibeChannel
//
//  Parses VibeChannel message files (YAML frontmatter + Markdown content).
//  Matches the parsing logic from the VSCode extension.
//

import Foundation

struct ParseError: Error, LocalizedError {
    let id: String
    let filename: String
    let error: String

    var errorDescription: String? {
        "\(filename): \(error)"
    }
}

class MessageParser {

    // MARK: - Parse Message

    static func parse(filename: String, content: String, sha: String? = nil) -> Result<Message, ParseError> {
        // Split frontmatter from content
        let parts = content.components(separatedBy: "---")

        guard parts.count >= 3 else {
            return .failure(ParseError(
                id: filename,
                filename: filename,
                error: "Invalid frontmatter format - expected '---' delimiters"
            ))
        }

        let yamlString = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
        let markdownContent = parts.dropFirst(2).joined(separator: "---").trimmingCharacters(in: .whitespacesAndNewlines)

        // Parse YAML frontmatter manually (simple key: value parsing)
        let yaml = parseYAML(yamlString)

        // Validate required fields
        guard let from = yaml["from"] else {
            return .failure(ParseError(
                id: filename,
                filename: filename,
                error: "Missing required field: from"
            ))
        }

        guard let dateString = yaml["date"],
              let date = parseDate(dateString) else {
            return .failure(ParseError(
                id: filename,
                filename: filename,
                error: "Missing or invalid required field: date"
            ))
        }

        // Parse optional fields
        let replyTo = yaml["reply_to"]
        let edited: Date? = yaml["edited"].flatMap { parseDate($0) }
        let tags: [String]? = parseTags(yaml["tags"])

        let id = filename.replacingOccurrences(of: ".md", with: "")

        return .success(Message(
            id: id,
            filename: filename,
            from: from,
            date: date,
            replyTo: replyTo,
            tags: tags,
            edited: edited,
            content: markdownContent,
            rawContent: content,
            sha: sha
        ))
    }

    // MARK: - Simple YAML Parser

    private static func parseYAML(_ yaml: String) -> [String: String] {
        var result: [String: String] = [:]

        for line in yaml.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") {
                continue
            }

            if let colonIndex = trimmed.firstIndex(of: ":") {
                let key = String(trimmed[..<colonIndex]).trimmingCharacters(in: .whitespaces)
                let value = String(trimmed[trimmed.index(after: colonIndex)...]).trimmingCharacters(in: .whitespaces)

                // Remove quotes if present
                let cleanValue = value
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))

                result[key] = cleanValue
            }
        }

        return result
    }

    // MARK: - Date Parsing

    private static func parseDate(_ dateString: String) -> Date? {
        // Try ISO 8601 format first
        let iso8601 = ISO8601DateFormatter()
        iso8601.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso8601.date(from: dateString) {
            return date
        }

        // Try without fractional seconds
        iso8601.formatOptions = [.withInternetDateTime]
        if let date = iso8601.date(from: dateString) {
            return date
        }

        // Try custom format without timezone
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        formatter.timeZone = TimeZone(identifier: "UTC")
        if let date = formatter.date(from: dateString) {
            return date
        }

        return nil
    }

    // MARK: - Tags Parsing

    private static func parseTags(_ tagsString: String?) -> [String]? {
        guard let tagsString = tagsString, !tagsString.isEmpty else {
            return nil
        }

        // Handle array format: [tag1, tag2]
        if tagsString.hasPrefix("[") && tagsString.hasSuffix("]") {
            let inner = String(tagsString.dropFirst().dropLast())
            return inner
                .components(separatedBy: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        }

        // Handle comma-separated string
        return tagsString
            .components(separatedBy: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    // MARK: - Filename Parsing

    struct FilenameComponents {
        let timestamp: String    // "20250115T103045"
        let sender: String       // "alice"
        let id: String           // "abc123"
    }

    static func parseFilename(_ filename: String) -> FilenameComponents? {
        // Remove .md extension
        let baseName = filename.replacingOccurrences(of: ".md", with: "", options: .caseInsensitive)

        // Match pattern: YYYYMMDDTHHMMSS-sender-id
        let pattern = #"^(\d{8}T\d{6})-([a-z0-9]+)-([a-z0-9]+)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: baseName, range: NSRange(baseName.startIndex..., in: baseName)),
              match.numberOfRanges == 4 else {
            return nil
        }

        guard let timestampRange = Range(match.range(at: 1), in: baseName),
              let senderRange = Range(match.range(at: 2), in: baseName),
              let idRange = Range(match.range(at: 3), in: baseName) else {
            return nil
        }

        return FilenameComponents(
            timestamp: String(baseName[timestampRange]),
            sender: String(baseName[senderRange]),
            id: String(baseName[idRange])
        )
    }

    // MARK: - Is Message File

    static func isMessageFile(_ filename: String) -> Bool {
        let lowerFilename = filename.lowercased()
        return filename.hasSuffix(".md") &&
               lowerFilename != "schema.md" &&
               lowerFilename != "agent.md" &&
               lowerFilename != "readme.md" &&
               lowerFilename != ".gitkeep"
    }

    // MARK: - Generate Message Content

    static func generateMessageContent(from: String, content: String, replyTo: String? = nil, tags: [String]? = nil) -> String {
        let now = Date()
        let iso8601 = ISO8601DateFormatter()
        iso8601.formatOptions = [.withInternetDateTime]
        let dateString = iso8601.string(from: now)

        var frontmatter = """
        ---
        from: \(from)
        date: \(dateString)
        """

        if let replyTo = replyTo {
            frontmatter += "\nreply_to: \(replyTo)"
        }

        if let tags = tags, !tags.isEmpty {
            frontmatter += "\ntags: [\(tags.joined(separator: ", "))]"
        }

        frontmatter += "\n---\n\n"

        return frontmatter + content
    }

    // MARK: - Generate Filename

    static func generateFilename(sender: String) -> String {
        let now = Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd'T'HHmmss"
        // Match VSCode: toISOString() uses UTC
        formatter.timeZone = TimeZone(identifier: "UTC")

        let timestamp = formatter.string(from: now)
        let randomId = generateRandomId(length: 6)

        return "\(timestamp)-\(sender.lowercased())-\(randomId).md"
    }

    private static func generateRandomId(length: Int) -> String {
        // Match VSCode: crypto.randomBytes(3).toString('hex') produces hex chars
        let characters = "0123456789abcdef"
        return String((0..<length).map { _ in characters.randomElement()! })
    }
}
