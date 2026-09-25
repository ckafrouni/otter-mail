// Renders the development ("blueprint") variant of the app icon, like T3 Code's
// assets/dev icons: the same mark in white on a blue drafting sheet with a grid
// and measurement ticks, inside the same rounded shape as the source icon.
//
//   swift scripts/lib/blueprint-icon.swift <source.png> <output.png>
//
// The source must be the production icon: a light mark on a dark tile with
// transparent corners (the tile's alpha gives the shape, its luminance the mark).

import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  FileHandle.standardError.write(Data("usage: blueprint-icon <source.png> <output.png>\n".utf8))
  exit(2)
}

guard
  let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: arguments[1]) as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  FileHandle.standardError.write(Data("Couldn't read \(arguments[1])\n".utf8))
  exit(1)
}

let size = image.width
let bytesPerRow = size * 4
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

// Source pixels, premultiplied RGBA.
var sourcePixels = [UInt8](repeating: 0, count: size * size * 4)
sourcePixels.withUnsafeMutableBytes { buffer in
  let context = CGContext(
    data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: bitmapInfo)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
}

// The blueprint sheet: a vertical blue gradient, a fine grid, a coarser grid,
// and a few dimension lines with end ticks, all in translucent white.
var sheet = [UInt8](repeating: 0, count: size * size * 4)
sheet.withUnsafeMutableBytes { buffer in
  let context = CGContext(
    data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: bitmapInfo)!
  let s = CGFloat(size)
  let gradient = CGGradient(
    colorsSpace: colorSpace,
    colors: [
      CGColor(srgbRed: 0.20, green: 0.49, blue: 0.97, alpha: 1),
      CGColor(srgbRed: 0.08, green: 0.30, blue: 0.80, alpha: 1),
    ] as CFArray,
    locations: [0, 1])!
  context.drawLinearGradient(
    gradient, start: CGPoint(x: 0, y: s), end: CGPoint(x: 0, y: 0), options: [])

  func line(_ from: CGPoint, _ to: CGPoint, alpha: CGFloat, width: CGFloat) {
    context.setStrokeColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: alpha))
    context.setLineWidth(width * s / 1024)
    context.move(to: from)
    context.addLine(to: to)
    context.strokePath()
  }
  let fine = s / 32
  for i in 1..<32 {
    let p = CGFloat(i) * fine
    let major = i % 4 == 0
    line(CGPoint(x: p, y: 0), CGPoint(x: p, y: s), alpha: major ? 0.16 : 0.07, width: major ? 2 : 1)
    line(CGPoint(x: 0, y: p), CGPoint(x: s, y: p), alpha: major ? 0.16 : 0.07, width: major ? 2 : 1)
  }
  // Dimension lines with ticks, like a technical drawing's measurements.
  func dimension(horizontal: Bool, at offset: CGFloat, from a: CGFloat, to b: CGFloat) {
    let tick = s * 0.018
    if horizontal {
      line(CGPoint(x: a, y: offset), CGPoint(x: b, y: offset), alpha: 0.5, width: 3)
      line(CGPoint(x: a, y: offset - tick), CGPoint(x: a, y: offset + tick), alpha: 0.5, width: 3)
      line(CGPoint(x: b, y: offset - tick), CGPoint(x: b, y: offset + tick), alpha: 0.5, width: 3)
    } else {
      line(CGPoint(x: offset, y: a), CGPoint(x: offset, y: b), alpha: 0.5, width: 3)
      line(CGPoint(x: offset - tick, y: a), CGPoint(x: offset + tick, y: a), alpha: 0.5, width: 3)
      line(CGPoint(x: offset - tick, y: b), CGPoint(x: offset + tick, y: b), alpha: 0.5, width: 3)
    }
  }
  dimension(horizontal: true, at: s * 0.155, from: s * 0.26, to: s * 0.74)
  dimension(horizontal: false, at: s * 0.155, from: s * 0.26, to: s * 0.74)
  // Crosshair marks near the corners.
  for (x, y) in [(0.27, 0.80), (0.80, 0.80), (0.80, 0.27)] {
    let c = CGPoint(x: s * x, y: s * y)
    let r = s * 0.014
    line(CGPoint(x: c.x - r, y: c.y), CGPoint(x: c.x + r, y: c.y), alpha: 0.45, width: 3)
    line(CGPoint(x: c.x, y: c.y - r), CGPoint(x: c.x, y: c.y + r), alpha: 0.45, width: 3)
  }
}

// Composite: keep the source's shape (alpha); inside it, the sheet, with the
// mark drawn in white wherever the source is light.
var output = [UInt8](repeating: 0, count: size * size * 4)
func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
  let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
for i in stride(from: 0, to: output.count, by: 4) {
  let alpha = Double(sourcePixels[i + 3]) / 255
  guard alpha > 0 else { continue }
  // Un-premultiply to read the source's real luminance.
  let r = Double(sourcePixels[i]) / 255 / alpha
  let g = Double(sourcePixels[i + 1]) / 255 / alpha
  let b = Double(sourcePixels[i + 2]) / 255 / alpha
  let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  let mark = smoothstep(0.18, 0.75, luminance)
  for c in 0..<3 {
    let background = Double(sheet[i + c]) / 255
    let value = background * (1 - mark) + 1 * mark
    output[i + c] = UInt8((value * alpha * 255).rounded())
  }
  output[i + 3] = sourcePixels[i + 3]
}

let result = output.withUnsafeMutableBytes { buffer -> CGImage in
  let context = CGContext(
    data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: bitmapInfo)!
  return context.makeImage()!
}
let destination = CGImageDestinationCreateWithURL(
  URL(fileURLWithPath: arguments[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, result, nil)
guard CGImageDestinationFinalize(destination) else {
  FileHandle.standardError.write(Data("Couldn't write \(arguments[2])\n".utf8))
  exit(1)
}
