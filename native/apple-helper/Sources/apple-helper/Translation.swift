import Foundation
import NaturalLanguage
import Translation

// Apple's on-device translator (the one behind Safari's "Translate page").
// Language packs are managed by macOS in System Settings → General →
// Language & Region → Translation Languages.

struct Detection: Codable {
  /// BCP-47 code ("de", "fr", "zh-Hans"), or nil when undetermined.
  let language: String?
  let confidence: Double
}

struct Translated: Codable {
  /// "ok", "notInstalled" (the language pack needs downloading),
  /// "unsupported" (no model for this pair), or "unavailable" (macOS < 26).
  let status: String
  /// One per input text, in order; empty unless status is "ok".
  let texts: [String]
}

struct DetectRequest: Decodable { let text: String }
struct TranslateRequest: Decodable {
  let texts: [String]
  let source: String
  let target: String
}

/// The most likely language of `text`.
func detectLanguage(text: String) -> Detection {
  let recognizer = NLLanguageRecognizer()
  recognizer.processString(text)
  guard
    let best = recognizer.languageHypotheses(withMaximum: 1).max(by: { $0.value < $1.value }),
    best.key != .undetermined
  else { return Detection(language: nil, confidence: 0) }
  return Detection(language: best.key.rawValue, confidence: best.value)
}

/// Translates `texts` from `source` into `target` in one batch.
func translate(texts: [String], source: String, target: String) async throws -> Translated {
  guard #available(macOS 26, *) else { return Translated(status: "unavailable", texts: []) }
  let from = Locale.Language(identifier: source)
  let to = Locale.Language(identifier: target)
  switch await LanguageAvailability().status(from: from, to: to) {
  case .installed: break
  case .supported: return Translated(status: "notInstalled", texts: [])
  default: return Translated(status: "unsupported", texts: [])
  }
  let requests = texts.enumerated().map {
    TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
  }
  // A freshly installed pack can report .installed while its model is still
  // loading, and the first batch then fails; one retry covers that.
  for attempt in 1...2 {
    do {
      let session = TranslationSession(installedSource: from, target: to)
      var out = texts
      for try await response in session.translate(batch: requests) {
        if let id = response.clientIdentifier, let index = Int(id), out.indices.contains(index) {
          out[index] = response.targetText
        }
      }
      return Translated(status: "ok", texts: out)
    } catch where attempt == 1 {
      try await Task.sleep(nanoseconds: 500_000_000)
    }
  }
  return Translated(status: "unsupported", texts: [])
}

