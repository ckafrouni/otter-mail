import Foundation
import FoundationModels

// Apple's on-device model as an agent: a LanguageModelSession whose tools the
// app runs (core's agent tools, apps/desktop agent/apple.ts). `agent` stays
// up and speaks JSON lines:
//   in   {"type":"turn","id","instructions"?,"transcript"?,"tools":[{name,description,parameters}],"prompt"}
//        {"type":"toolResult","callId","output"}
//        {"type":"cancel","id"}
//   out  {"type":"text","id","text"}                               the answer so far
//        {"type":"toolCall","id","callId","name","arguments"}     arguments as a JSON string
//        {"type":"done","id","transcript","error"?}               the chat to keep, however it ended
// A turn starts from `instructions` (a new chat) or the chat's `transcript`.

struct AgentStatus: Encodable {
  let available: Bool
  /// "deviceNotEligible", "appleIntelligenceNotEnabled", "modelNotReady" or "unsupportedOS".
  let reason: String?
}

func agentStatus() -> AgentStatus {
  guard #available(macOS 26, *) else { return AgentStatus(available: false, reason: "unsupportedOS") }
  switch SystemLanguageModel.default.availability {
  case .available: return AgentStatus(available: true, reason: nil)
  case .unavailable(.deviceNotEligible): return AgentStatus(available: false, reason: "deviceNotEligible")
  case .unavailable(.appleIntelligenceNotEnabled): return AgentStatus(available: false, reason: "appleIntelligenceNotEnabled")
  case .unavailable: return AgentStatus(available: false, reason: "modelNotReady")
  }
}

func runAgent() async throws {
  guard #available(macOS 26, *) else { fail("Apple's on-device model needs macOS 26 or later.") }
  let agent = Agent()
  for try await line in FileHandle.standardInput.bytes.lines {
    guard let message = try? JSONDecoder().decode(Incoming.self, from: Data(line.utf8)) else {
      FileHandle.standardError.write(Data("unreadable message: \(line.prefix(200))\n".utf8))
      continue
    }
    await agent.receive(message)
  }
}

@available(macOS 26, *)
struct Incoming: Decodable {
  struct ToolSpec: Decodable {
    let name: String
    let description: String
    let parameters: GenerationSchema
  }

  let type: String
  var id: String?
  var instructions: String?
  var transcript: Transcript?
  var tools: [ToolSpec]?
  var prompt: String?
  var callId: String?
  var output: String?
}

@available(macOS 26, *)
struct Outgoing: Encodable {
  let type: String
  let id: String
  var text: String?
  var callId: String?
  var name: String?
  var arguments: String?
  var transcript: Transcript?
  var error: String?
}

/// The running turns, and their tool calls waiting on the app.
@available(macOS 26, *)
actor Agent {
  private var turns: [String: Task<Void, Never>] = [:]
  private var waiting: [String: CheckedContinuation<String, Never>] = [:]

  func receive(_ message: Incoming) {
    switch message.type {
    case "turn":
      guard let id = message.id else { return }
      turns[id] = Task {
        await run(message, id: id)
        finish(id)
      }
    case "toolResult":
      if let callId = message.callId { waiting.removeValue(forKey: callId)?.resume(returning: message.output ?? "") }
    case "cancel":
      if let id = message.id { turns[id]?.cancel() }
    default:
      break
    }
  }

  /// Asks the app to run a tool, and waits for what it found.
  func call(turn: String, name: String, arguments: String) async -> String {
    let callId = UUID().uuidString
    return await withCheckedContinuation { continuation in
      waiting[callId] = continuation
      send(Outgoing(type: "toolCall", id: turn, callId: callId, name: name, arguments: arguments))
    }
  }

  private func finish(_ id: String) {
    turns[id] = nil
  }

  private func send(_ message: Outgoing) {
    guard let data = try? JSONEncoder().encode(message) else { return }
    FileHandle.standardOutput.write(data + Data("\n".utf8))
  }

  private func run(_ request: Incoming, id: String) async {
    let tools = (request.tools ?? []).map {
      AppTool(name: $0.name, description: $0.description, parameters: $0.parameters, turn: id, agent: self)
    }
    let session = request.transcript.map { LanguageModelSession(tools: tools, transcript: $0) }
      ?? LanguageModelSession(tools: tools, instructions: request.instructions)
    var failure: String?
    do {
      for try await snapshot in session.streamResponse(to: request.prompt ?? "") {
        send(Outgoing(type: "text", id: id, text: snapshot.content))
      }
      // Stopping can end the stream quietly rather than with an error.
      if Task.isCancelled { failure = "cancelled" }
    } catch {
      failure = Self.code(error)
    }
    send(Outgoing(type: "done", id: id, transcript: session.transcript, error: failure))
  }

  /// What went wrong, as the app words it (its ERRORS), or the framework's message.
  private static func code(_ error: Error) -> String {
    if error is CancellationError || Task.isCancelled { return "cancelled" }
    // macOS 27 reports these as LanguageModelError; macOS 26 as GenerationError.
    if #available(macOS 27, *), let error = error as? LanguageModelError {
      switch error {
      case .contextSizeExceeded: return "contextWindow"
      case .guardrailViolation, .refusal: return "refused"
      case .unsupportedLanguageOrLocale: return "unsupportedLanguage"
      default: return error.localizedDescription
      }
    }
    switch error as? LanguageModelSession.GenerationError {
    case .exceededContextWindowSize: return "contextWindow"
    case .guardrailViolation, .refusal: return "refused"
    case .unsupportedLanguageOrLocale: return "unsupportedLanguage"
    default: return error.localizedDescription
    }
  }
}

/// One of the app's tools: the model calls it here, the app runs it.
@available(macOS 26, *)
struct AppTool: Tool {
  let name: String
  let description: String
  let parameters: GenerationSchema
  let turn: String
  let agent: Agent

  func call(arguments: GeneratedContent) async throws -> String {
    await agent.call(turn: turn, name: name, arguments: arguments.jsonString)
  }
}
