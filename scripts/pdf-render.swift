import Foundation
import AppKit
import PDFKit

// Render selected PDF pages to JPEG for inline figure previews.
// usage: pdf-render.swift <pdf> <output-dir> <comma-separated-pages> [scale] [quality]

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: pdf-render.swift <pdf> <output-dir> <pages> [scale] [quality]\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: args[1])
guard let document = PDFDocument(url: url) else {
    FileHandle.standardError.write("cannot open pdf\n".data(using: .utf8)!)
    exit(1)
}
let outputDir = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
let pages = args[3]
    .split(separator: ",")
    .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    .filter { $0 > 0 }
let scale = args.count >= 5 ? (Double(args[4]) ?? 1.25) : 1.25
let quality = args.count >= 6 ? (Double(args[5]) ?? 0.75) : 0.75

for pageNumber in pages {
    guard let page = document.page(at: pageNumber - 1) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let width = max(1, Int(bounds.width * scale))
    let height = max(1, Int(bounds.height * scale))
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else { continue }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    NSGraphicsContext.restoreGraphicsState()
    guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]) else { continue }
    let file = outputDir.appendingPathComponent("page-\(pageNumber).jpg")
    try? data.write(to: file)
    print(file.path)
}
