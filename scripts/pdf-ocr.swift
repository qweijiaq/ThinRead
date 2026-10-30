import Foundation
import AppKit
import PDFKit
import Vision

func ocr(image: CGImage) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return ""
    }
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let args = CommandLine.arguments
guard args.count >= 3, let maxPages = Int(args[2]), maxPages > 0 else {
    FileHandle.standardError.write("usage: pdf-ocr.swift <pdf> <max-pages>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: args[1])
guard let document = PDFDocument(url: url) else {
    FileHandle.standardError.write("cannot open pdf\n".data(using: .utf8)!)
    exit(1)
}
let totalPages = document.pageCount
let attributes = document.documentAttributes ?? [:]
let title = (attributes[PDFDocumentAttribute.titleAttribute] as? String) ?? ""
let author = (attributes[PDFDocumentAttribute.authorAttribute] as? String) ?? ""

func outlineRows(_ node: PDFOutline?, _ depth: Int) -> [[String: Any]] {
    guard let node else { return [] }
    var rows: [[String: Any]] = []
    let label = (node.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !label.isEmpty {
        var pageNumber = 0
        if let page = node.destination?.page {
            pageNumber = document.index(for: page) + 1
        }
        rows.append(["title": label, "page": pageNumber, "depth": depth])
    }
    for index in 0..<node.numberOfChildren {
        rows.append(contentsOf: outlineRows(node.child(at: index), depth + 1))
    }
    return rows
}

let meta: [String: Any] = [
    "pages": totalPages,
    "title": title,
    "author": author,
    "maxPages": maxPages,
    "outline": outlineRows(document.outlineRoot, 0)
]
if let metaData = try? JSONSerialization.data(withJSONObject: ["meta": meta]),
   let metaLine = String(data: metaData, encoding: .utf8) {
    print(metaLine)
    fflush(stdout)
}
if totalPages > maxPages {
    FileHandle.standardError.write("page count exceeds limit\n".data(using: .utf8)!)
    exit(3)
}
if totalPages == 0 {
    FileHandle.standardError.write("empty pdf\n".data(using: .utf8)!)
    exit(1)
}

for pageNumber in 1...totalPages {
    autoreleasepool {
        guard let page = document.page(at: pageNumber - 1) else {
            return
        }
        let bounds = page.bounds(for: .mediaBox)
        let scale: CGFloat = 2
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
        ) else {
            return
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSColor.white.setFill()
        NSRect(x: 0, y: 0, width: width, height: height).fill()
        if let context = NSGraphicsContext.current?.cgContext {
            context.scaleBy(x: scale, y: scale)
            page.draw(with: .mediaBox, to: context)
        }
        NSGraphicsContext.restoreGraphicsState()
        let text = rep.cgImage.map(ocr) ?? ""
        let payload: [String: Any] = ["page": pageNumber, "text": text]
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let line = String(data: data, encoding: .utf8) {
            print(line)
            fflush(stdout)
        }
    }
}
