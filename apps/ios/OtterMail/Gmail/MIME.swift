import Foundation

/**
 * An RFC 5322 message to hand Gmail (`raw`) or an SMTP server: plain text and
 * HTML, UTF-8, replies threaded. `stamped` adds the Date and Message-ID that
 * Gmail would add itself (an IMAP copy keeps the message as written).
 */
nonisolated enum MIME {
    static func message(
        from: Person,
        to: [Person],
        cc: [Person],
        subject: String,
        text: String,
        html: String,
        inReplyTo: String? = nil,
        references: String? = nil,
        stamped: Bool = false
    ) -> Data {
        let boundary = "otter-\(UUID().uuidString)"
        var headers = [
            "From: \(address(from))",
            "To: \(to.map(address).joined(separator: ", "))",
        ]
        if !cc.isEmpty { headers.append("Cc: \(cc.map(address).joined(separator: ", "))") }
        if stamped {
            headers.append("Date: \(rfc5322Date.string(from: .now))")
            let domain = from.email.split(separator: "@").last.map(String.init) ?? "otterware.app"
            headers.append("Message-ID: <\(UUID().uuidString.lowercased())@\(domain)>")
        }
        headers.append("Subject: \(encoded(subject))")
        if let inReplyTo {
            headers.append("In-Reply-To: \(inReplyTo)")
            headers.append("References: \([references, inReplyTo].compactMap { $0 }.joined(separator: " "))")
        }
        headers += [
            "MIME-Version: 1.0",
            "Content-Type: multipart/alternative; boundary=\"\(boundary)\"",
        ]
        let part = { (type: String, body: String) in
            [
                "--\(boundary)",
                "Content-Type: \(type); charset=\"UTF-8\"",
                "Content-Transfer-Encoding: base64",
                "",
                Data(body.utf8).base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed]),
                "",
            ].joined(separator: "\r\n")
        }
        let message = headers.joined(separator: "\r\n") + "\r\n\r\n"
            + part("text/plain", text) + part("text/html", html) + "--\(boundary)--\r\n"
        return Data(message.utf8)
    }

    private static let rfc5322Date = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        return formatter
    }()

    private static func address(_ person: Person) -> String {
        person.name.isEmpty ? person.email : "\(encoded(person.name, quoted: true)) <\(person.email)>"
    }

    /** RFC 2047 for anything not plain ASCII. */
    private static func encoded(_ text: String, quoted: Bool = false) -> String {
        if text.allSatisfy({ $0.isASCII }) {
            return quoted && text.contains(where: { ",;:<>@\"".contains($0) })
                ? "\"\(text.replacingOccurrences(of: "\"", with: "\\\""))\"" : text
        }
        return "=?UTF-8?B?\(Data(text.utf8).base64EncodedString())?="
    }
}
