import Foundation
import AppKit
import PDFKit
import Vision

func ocr(image: CGImage) -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try? handler.perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}

let args = CommandLine.arguments
guard args.count >= 3, let pageNumber = Int(args[2]), pageNumber > 0 else {
    FileHandle.standardError.write("usage: pdf-page.swift <pdf> <page> [output.png]\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: args[1])
guard let document = PDFDocument(url: url), let page = document.page(at: pageNumber - 1) else {
    FileHandle.standardError.write("cannot open pdf page\n".data(using: .utf8)!)
    exit(1)
}
let bounds = page.bounds(for: .mediaBox)
let scale: CGFloat = 2
let width = max(1, Int(bounds.width * scale))
let height = max(1, Int(bounds.height * scale))
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
let ctx = NSGraphicsContext.current!.cgContext
ctx.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: ctx)
NSGraphicsContext.restoreGraphicsState()
if args.count >= 4, let data = rep.representation(using: .png, properties: [:]) {
    try? data.write(to: URL(fileURLWithPath: args[3]))
}
if let cg = rep.cgImage {
    for line in ocr(image: cg) { print(line) }
}
