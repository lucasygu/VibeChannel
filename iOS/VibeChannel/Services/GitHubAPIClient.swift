//
//  GitHubAPIClient.swift
//  VibeChannel
//
//  GitHub REST API client for all GitHub operations.
//  This is the main transport layer - no local Git needed.
//

import Foundation

enum GitHubAPIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, message: String?)
    case decodingError(Error)
    case encodingError
    case notFound
    case unauthorized
    case rateLimited
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let code, let message):
            return "HTTP error \(code): \(message ?? "Unknown error")"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .encodingError:
            return "Failed to encode request"
        case .notFound:
            return "Resource not found"
        case .unauthorized:
            return "Unauthorized - please sign in again"
        case .rateLimited:
            return "Rate limit exceeded - please try again later"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

/// Rate limit information from GitHub API
struct GitHubRateLimit {
    let remaining: Int
    let limit: Int
    let resetDate: Date?
}

class GitHubAPIClient {
    private let baseURL = "https://api.github.com"
    private let session = URLSession.shared
    private var accessToken: String

    /// The branch where all VibeChannel content lives
    static let vibeChannelBranch = "vibechannel"

    /// Last rate limit info from API response
    private(set) var lastRateLimit: GitHubRateLimit?

    /// Callback when rate limit is updated
    var onRateLimitUpdate: ((GitHubRateLimit) -> Void)?

    init(accessToken: String) {
        self.accessToken = accessToken
    }

    func updateToken(_ token: String) {
        self.accessToken = token
    }

    private func extractRateLimit(from response: HTTPURLResponse) {
        guard let remainingStr = response.value(forHTTPHeaderField: "X-RateLimit-Remaining"),
              let limitStr = response.value(forHTTPHeaderField: "X-RateLimit-Limit"),
              let remaining = Int(remainingStr),
              let limit = Int(limitStr) else {
            return
        }

        var resetDate: Date?
        if let resetStr = response.value(forHTTPHeaderField: "X-RateLimit-Reset"),
           let resetTimestamp = Double(resetStr) {
            resetDate = Date(timeIntervalSince1970: resetTimestamp)
        }

        let rateLimit = GitHubRateLimit(remaining: remaining, limit: limit, resetDate: resetDate)
        self.lastRateLimit = rateLimit
        onRateLimitUpdate?(rateLimit)
    }

    // MARK: - Generic Request

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        decodeAs: T.Type
    ) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw GitHubAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("VibeChannel-iOS/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")

        if let body = body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GitHubAPIError.invalidResponse
        }

        // Extract rate limit info from response headers
        extractRateLimit(from: httpResponse)

        print("🌐 [DEBUG] HTTP \(method) \(path) -> Status: \(httpResponse.statusCode)")

        switch httpResponse.statusCode {
        case 200..<300:
            do {
                let decoder = JSONDecoder()
                return try decoder.decode(T.self, from: data)
            } catch {
                print("🔴 [DEBUG] Decode error. Raw response: \(String(data: data, encoding: .utf8) ?? "nil")")
                throw GitHubAPIError.decodingError(error)
            }
        case 401:
            print("🔴 [DEBUG] 401 Unauthorized")
            throw GitHubAPIError.unauthorized
        case 403:
            if httpResponse.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0" {
                print("🔴 [DEBUG] 403 Rate Limited")
                throw GitHubAPIError.rateLimited
            }
            print("🔴 [DEBUG] 403 Forbidden: \(String(data: data, encoding: .utf8) ?? "nil")")
            throw GitHubAPIError.httpError(statusCode: 403, message: "Forbidden")
        case 404:
            print("🔴 [DEBUG] 404 Not Found: \(String(data: data, encoding: .utf8) ?? "nil")")
            throw GitHubAPIError.notFound
        default:
            let message = String(data: data, encoding: .utf8)
            print("🔴 [DEBUG] HTTP Error \(httpResponse.statusCode): \(message ?? "nil")")
            throw GitHubAPIError.httpError(statusCode: httpResponse.statusCode, message: message)
        }
    }

    // MARK: - User

    func getCurrentUser() async throws -> GitHubUserResponse {
        try await request("/user", decodeAs: GitHubUserResponse.self)
    }

    // MARK: - Repositories

    func listUserRepos() async throws -> [Repository] {
        try await request("/user/repos?sort=updated&per_page=100", decodeAs: [Repository].self)
    }

    func getRepository(owner: String, repo: String) async throws -> Repository {
        try await request("/repos/\(owner)/\(repo)", decodeAs: Repository.self)
    }

    // MARK: - Contents (Channels & Messages)

    func listContents(owner: String, repo: String, path: String = "", branch: String = vibeChannelBranch) async throws -> [GitHubContentItem] {
        let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        let basePath = encodedPath.isEmpty ? "/repos/\(owner)/\(repo)/contents" : "/repos/\(owner)/\(repo)/contents/\(encodedPath)"
        let fullPath = "\(basePath)?ref=\(branch)"
        print("🌐 [DEBUG] GitHubAPIClient.listContents: URL = \(baseURL)\(fullPath)")
        do {
            let result = try await request(fullPath, decodeAs: [GitHubContentItem].self)
            print("🟢 [DEBUG] GitHubAPIClient.listContents: SUCCESS - got \(result.count) items")
            return result
        } catch {
            print("🔴 [DEBUG] GitHubAPIClient.listContents: ERROR - \(error)")
            throw error
        }
    }

    func getFileContent(owner: String, repo: String, path: String, branch: String = vibeChannelBranch) async throws -> GitHubContentItem {
        let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return try await request("/repos/\(owner)/\(repo)/contents/\(encodedPath)?ref=\(branch)", decodeAs: GitHubContentItem.self)
    }

    func getFileContentString(owner: String, repo: String, path: String, branch: String = vibeChannelBranch) async throws -> (content: String, sha: String) {
        let item = try await getFileContent(owner: owner, repo: repo, path: path, branch: branch)

        guard let base64Content = item.content,
              let data = Data(base64Encoded: base64Content.replacingOccurrences(of: "\n", with: "")),
              let content = String(data: data, encoding: .utf8) else {
            throw GitHubAPIError.decodingError(NSError(domain: "GitHubAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to decode file content"]))
        }

        return (content, item.sha)
    }

    // MARK: - Create Message (equivalent to git add + commit + push)

    func createFile(
        owner: String,
        repo: String,
        path: String,
        content: String,
        message: String,
        branch: String = vibeChannelBranch
    ) async throws -> GitHubCreateFileResponse {
        let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path

        let body: [String: Any] = [
            "message": message,
            "content": Data(content.utf8).base64EncodedString(),
            "branch": branch
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else {
            throw GitHubAPIError.encodingError
        }

        return try await request(
            "/repos/\(owner)/\(repo)/contents/\(encodedPath)",
            method: "PUT",
            body: jsonData,
            decodeAs: GitHubCreateFileResponse.self
        )
    }

    // MARK: - Update File

    func updateFile(
        owner: String,
        repo: String,
        path: String,
        content: String,
        sha: String,
        message: String,
        branch: String = vibeChannelBranch
    ) async throws -> GitHubCreateFileResponse {
        let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path

        let body: [String: Any] = [
            "message": message,
            "content": Data(content.utf8).base64EncodedString(),
            "sha": sha,
            "branch": branch
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else {
            throw GitHubAPIError.encodingError
        }

        return try await request(
            "/repos/\(owner)/\(repo)/contents/\(encodedPath)",
            method: "PUT",
            body: jsonData,
            decodeAs: GitHubCreateFileResponse.self
        )
    }

    // MARK: - Delete File

    func deleteFile(
        owner: String,
        repo: String,
        path: String,
        sha: String,
        message: String,
        branch: String = vibeChannelBranch
    ) async throws {
        let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path

        let body: [String: Any] = [
            "message": message,
            "sha": sha,
            "branch": branch
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else {
            throw GitHubAPIError.encodingError
        }

        // DELETE returns the deleted file info, but we don't need it
        _ = try await request(
            "/repos/\(owner)/\(repo)/contents/\(encodedPath)",
            method: "DELETE",
            body: jsonData,
            decodeAs: GitHubCreateFileResponse.self
        )
    }

    // MARK: - Commits (for polling changes)

    func getLatestCommit(owner: String, repo: String, path: String? = nil, branch: String = vibeChannelBranch) async throws -> GitHubCommit {
        var urlPath = "/repos/\(owner)/\(repo)/commits?per_page=1&sha=\(branch)"
        if let path = path {
            urlPath += "&path=\(path)"
        }

        let commits: [GitHubCommit] = try await request(urlPath, decodeAs: [GitHubCommit].self)
        guard let latest = commits.first else {
            throw GitHubAPIError.notFound
        }
        return latest
    }

    // MARK: - Check for changes (efficient polling with ETag)

    private var lastEtag: String?

    func checkForChanges(owner: String, repo: String, branch: String = vibeChannelBranch) async throws -> Bool {
        guard let url = URL(string: "\(baseURL)/repos/\(owner)/\(repo)/commits?per_page=1&sha=\(branch)") else {
            throw GitHubAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("VibeChannel-iOS/1.0", forHTTPHeaderField: "User-Agent")

        if let etag = lastEtag {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GitHubAPIError.invalidResponse
        }

        // 304 = Not Modified
        if httpResponse.statusCode == 304 {
            return false
        }

        // Update ETag for next request
        if let newEtag = httpResponse.value(forHTTPHeaderField: "ETag") {
            lastEtag = newEtag
        }

        return httpResponse.statusCode == 200
    }

    // MARK: - Create Directory (Channel)

    func createChannel(
        owner: String,
        repo: String,
        channelName: String,
        branch: String = vibeChannelBranch
    ) async throws {
        // GitHub doesn't support empty directories, so create with a .gitkeep file
        _ = try await createFile(
            owner: owner,
            repo: repo,
            path: "\(channelName)/.gitkeep",
            content: "",
            message: "Create #\(channelName) channel",
            branch: branch
        )
    }

    // MARK: - Repository Info

    /// Get repository numeric ID (needed for CDN upload)
    func getRepoId(owner: String, repo: String) async throws -> Int {
        let repository = try await getRepository(owner: owner, repo: repo)
        return repository.id
    }

    // MARK: - GitHub CDN Upload

    /// Upload an image to GitHub's CDN (same mechanism as pasting images in GitHub web UI)
    /// This works for both public and private repos
    /// - Parameters:
    ///   - imageData: The image data to upload
    ///   - filename: The filename for the image
    ///   - contentType: The MIME type (e.g., "image/png")
    ///   - repoId: The numeric repository ID
    /// - Returns: The CDN URL for the uploaded image, or nil if upload failed
    func uploadImageToGitHubCDN(
        imageData: Data,
        filename: String,
        contentType: String,
        repoId: Int
    ) async throws -> String {
        // Step 1: Get upload policy from GitHub
        guard let policyURL = URL(string: "https://github.com/upload/policies/assets") else {
            throw GitHubAPIError.invalidURL
        }

        var policyRequest = URLRequest(url: policyURL)
        policyRequest.httpMethod = "POST"
        policyRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        policyRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        policyRequest.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        policyRequest.setValue("VibeChannel-iOS/1.0", forHTTPHeaderField: "User-Agent")

        let policyBody: [String: Any] = [
            "name": filename,
            "size": imageData.count,
            "content_type": contentType,
            "repository_id": repoId
        ]

        policyRequest.httpBody = try JSONSerialization.data(withJSONObject: policyBody)

        let (policyData, policyResponse) = try await session.data(for: policyRequest)

        guard let httpResponse = policyResponse as? HTTPURLResponse,
              httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
            let statusCode = (policyResponse as? HTTPURLResponse)?.statusCode ?? -1
            print("🔴 [DEBUG] Failed to get upload policy: \(statusCode)")
            throw GitHubAPIError.httpError(statusCode: statusCode, message: "Failed to get upload policy")
        }

        // Parse the policy response
        guard let policyJSON = try JSONSerialization.jsonObject(with: policyData) as? [String: Any],
              let uploadURL = policyJSON["upload_url"] as? String,
              let form = policyJSON["form"] as? [String: String],
              let asset = policyJSON["asset"] as? [String: Any],
              let assetId = asset["id"] as? String else {
            throw GitHubAPIError.decodingError(NSError(domain: "GitHubAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid upload policy response"]))
        }

        // Step 2: Upload to S3 using multipart form data
        guard let s3URL = URL(string: uploadURL) else {
            throw GitHubAPIError.invalidURL
        }

        let boundary = UUID().uuidString
        var uploadRequest = URLRequest(url: s3URL)
        uploadRequest.httpMethod = "POST"
        uploadRequest.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()

        // Add form fields from policy
        for (key, value) in form {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }

        // Add file data
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(contentType)\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        uploadRequest.httpBody = body

        let (_, uploadResponse) = try await session.data(for: uploadRequest)

        guard let uploadHttpResponse = uploadResponse as? HTTPURLResponse,
              uploadHttpResponse.statusCode == 200 || uploadHttpResponse.statusCode == 201 || uploadHttpResponse.statusCode == 204 else {
            let statusCode = (uploadResponse as? HTTPURLResponse)?.statusCode ?? -1
            print("🔴 [DEBUG] Failed to upload to S3: \(statusCode)")
            throw GitHubAPIError.httpError(statusCode: statusCode, message: "Failed to upload image to S3")
        }

        // Return the CDN URL
        return "https://github.com/user-attachments/assets/\(assetId)"
    }

    /// Get content type for image based on file extension
    static func contentType(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        default: return "application/octet-stream"
        }
    }

    // MARK: - GitHub Issues

    /// Create a GitHub issue from a message
    /// - Parameters:
    ///   - owner: Repository owner
    ///   - repo: Repository name
    ///   - title: Issue title
    ///   - body: Issue body (markdown)
    /// - Returns: The created issue with html_url and number
    func createIssue(
        owner: String,
        repo: String,
        title: String,
        body: String
    ) async throws -> GitHubIssueResponse {
        let requestBody: [String: Any] = [
            "title": title,
            "body": body
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: requestBody) else {
            throw GitHubAPIError.encodingError
        }

        return try await request(
            "/repos/\(owner)/\(repo)/issues",
            method: "POST",
            body: jsonData,
            decodeAs: GitHubIssueResponse.self
        )
    }
}

// MARK: - GitHub Issue Response

struct GitHubIssueResponse: Codable {
    let id: Int
    let number: Int
    let htmlUrl: String
    let title: String
    let body: String?
    let state: String

    enum CodingKeys: String, CodingKey {
        case id
        case number
        case htmlUrl = "html_url"
        case title
        case body
        case state
    }
}
