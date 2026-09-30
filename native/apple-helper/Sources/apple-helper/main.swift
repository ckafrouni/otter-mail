import Foundation

// The Mac app's way into Apple's on-device frameworks. Nothing leaves the Mac.
//
// Usage: `apple-helper <command>`. The one-shot commands read a JSON request
// on stdin and print a JSON response; failures print a message to stderr and
// exit 1.
//   detect        {"text": "…"}                                  → Detection    (Translation.swift)
//   translate     {"texts": ["…"], "source": "de", "target": "en"} → Translated
//   agent-status                                                  → AgentStatus  (Agent.swift)
//   agent         stays up, JSON lines both ways: Apple's on-device model as an agent

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func respond<T: Encodable>(_ value: T) {
  do {
    FileHandle.standardOutput.write(try JSONEncoder().encode(value))
  } catch {
    fail("Couldn't encode the response: \(error)")
  }
}

func request<T: Decodable>(_ type: T.Type) throws -> T {
  try JSONDecoder().decode(type, from: FileHandle.standardInput.readDataToEndOfFile())
}

do {
  switch CommandLine.arguments.dropFirst().first {
  case "detect":
    respond(detectLanguage(text: try request(DetectRequest.self).text))
  case "translate":
    let r = try request(TranslateRequest.self)
    respond(try await translate(texts: r.texts, source: r.source, target: r.target))
  case "agent-status":
    respond(agentStatus())
  case "agent":
    try await runAgent()
  default:
    fail("usage: apple-helper detect|translate|agent-status|agent")
  }
} catch {
  fail("\(error)")
}
