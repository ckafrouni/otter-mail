// Renders an iOS app icon from a macOS one. macOS icons are a rounded tile with
// transparent margins; iOS wants a full-bleed opaque square (it rounds it
// itself). So: crop to the tile, fill its transparent corners with the tile's
// own edge color, and scale back up to the source size.
//
//   swift scripts/lib/ios-icon.swift <macos.png> <ios.png>

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  FileHandle.standardError.write(Data("usage: ios-icon <macos.png> <ios.png>\n".utf8))
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
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
var pixels = [UInt8](repeating: 0, count: size * size * 4)
pixels.withUnsafeMutableBytes { buffer in
  let context = CGContext(
    data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: size * 4, space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
}
let alpha = { (x: Int, y: Int) in pixels[(y * size + x) * 4 + 3] }

// The tile's straight edges cross the middle row and column.
let middle = size / 2
let left = (0..<size).first { alpha($0, middle) > 250 } ?? 0
let right = (0..<size).last { alpha($0, middle) > 250 } ?? size - 1
let top = (0..<size).first { alpha(middle, $0) > 250 } ?? 0
let bottom = (0..<size).last { alpha(middle, $0) > 250 } ?? size - 1
// Inside the rim, which some tiles highlight.
let edge = (middle * size + left + 40) * 4
let fill = CGColor(
  srgbRed: CGFloat(pixels[edge]) / 255, green: CGFloat(pixels[edge + 1]) / 255,
  blue: CGFloat(pixels[edge + 2]) / 255, alpha: 1)

let tile = image.cropping(
  to: CGRect(x: left, y: top, width: right - left + 1, height: bottom - top + 1))!
let output = CGContext(
  data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
output.setFillColor(fill)
output.fill(CGRect(x: 0, y: 0, width: size, height: size))
output.interpolationQuality = .high
output.draw(tile, in: CGRect(x: 0, y: 0, width: size, height: size))

let destination = CGImageDestinationCreateWithURL(
  URL(fileURLWithPath: arguments[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, output.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else { exit(1) }
