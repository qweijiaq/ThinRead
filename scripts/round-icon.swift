import AppKit
import Foundation

let src = CommandLine.arguments[1]
let dst = CommandLine.arguments[2]
guard let image = NSImage(contentsOfFile: src) else { fatalError("cannot read \(src)") }
var proposed = NSRect(x: 0, y: 0, width: 1024, height: 1024)
guard let cg = image.cgImage(forProposedRect: &proposed, context: nil, hints: nil) else { fatalError("no cg") }

// 原图的金色圆角边框在 72..952 之间；裁掉外面的深色方形底。
let cropRect = CGRect(x: 72, y: 72, width: 880, height: 880)
guard let crop = cg.cropping(to: cropRect) else { fatalError("crop failed") }

let side = 1024
let inset: CGFloat = 100
let content: CGFloat = 824
let radius: CGFloat = 170

guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: side,
  pixelsHigh: side,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else { fatalError("bitmap") }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: side, height: side).fill()
let path = NSBezierPath(roundedRect: NSRect(x: inset, y: inset, width: content, height: content), xRadius: radius, yRadius: radius)
path.addClip()
let cropped = NSImage(cgImage: crop, size: NSSize(width: 880, height: 880))
NSGraphicsContext.current?.imageInterpolation = .high
cropped.draw(in: NSRect(x: inset, y: inset, width: content, height: content), from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("png") }
try png.write(to: URL(fileURLWithPath: dst))
print("wrote \(dst)")
