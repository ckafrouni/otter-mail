// Colorizes the existing silver brand mark using three tonal anchors, keeping
// its shading, silhouette and the Mac tile's alpha. Input: export-theme-icons.ts.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Job: Decodable {
    let source, output, background, accent: String
    let opaque: Bool
}

func rgb(_ css: String) -> [Double] {
    if css.hasPrefix("#") {
        let value = UInt64(css.dropFirst(), radix: 16)!
        return [16, 8, 0].map { Double((value >> $0) & 255) / 255 }
    }
    let parts = css.dropFirst(6).dropLast().split(separator: " ").map { Double($0)! }
    let (L, a, b) = (parts[0], parts[1] * cos(parts[2] * .pi / 180), parts[1] * sin(parts[2] * .pi / 180))
    let l = pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
    let m = pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
    let s = pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map {
        let c = min(max($0, 0), 1)
        return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055
    }
}

let jobs = try JSONDecoder().decode([Job].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let space = CGColorSpace(name: CGColorSpace.sRGB)!
for job in jobs {
    let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: job.source) as CFURL, nil)!
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
    let size = image.width
    var pixels = [UInt8](repeating: 0, count: size * size * 4)
    let background = rgb(job.background)
    let accent = rgb(job.accent)
    let highlight = accent.map { $0 * 0.18 + 0.82 }
    let result = pixels.withUnsafeMutableBytes { buffer -> CGImage in
        let context = CGContext(data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8,
                                bytesPerRow: size * 4, space: space,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
        let bytes = buffer.bindMemory(to: UInt8.self)
        for i in stride(from: 0, to: bytes.count, by: 4) {
            let alpha = Double(bytes[i + 3]) / 255
            guard alpha > 0 else { continue }
            let shade = min(1, (0.2126 * Double(bytes[i]) + 0.7152 * Double(bytes[i + 1]) + 0.0722 * Double(bytes[i + 2])) / 255 / alpha)
            let t = shade < 0.6 ? shade / 0.6 : (shade - 0.6) / 0.4
            let low = shade < 0.6 ? background : accent
            let high = shade < 0.6 ? accent : highlight
            for c in 0..<3 {
                bytes[i + c] = UInt8(((low[c] * (1 - t) + high[c] * t) * alpha * 255).rounded())
            }
        }
        // App Store icons must have no alpha channel, even when every pixel is opaque.
        if job.opaque {
            return CGContext(data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8,
                             bytesPerRow: size * 4, space: space,
                             bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!.makeImage()!
        }
        return context.makeImage()!
    }
    let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: job.output) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, result, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Couldn't write \(job.output)") }
}
