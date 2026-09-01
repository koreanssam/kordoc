#!/usr/bin/env node
/**
 * Upstage Document Parse → Markdown.
 * Reads UPSTAGE_API_KEY from the environment (never pass the key on the CLI).
 *
 *   node upstage-parse.mjs <file> -o <out.md>
 *
 * Optional env:
 *   UPSTAGE_OCR=auto|force     (default auto)
 *   UPSTAGE_MODE=standard|enhanced|auto  (default auto)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { basename, dirname, extname } from "node:path"

// School/corporate SSL inspection. Opt-in only: UPSTAGE_INSECURE_TLS=1
if (process.env.UPSTAGE_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
}

const ENDPOINT = "https://api.upstage.ai/v1/document-digitization"

function usage(msg) {
  if (msg) process.stderr.write(msg + "\n")
  process.stderr.write("usage: node upstage-parse.mjs <file> -o <out.md>\n")
  process.exit(1)
}

function mimeFor(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".webp":
      return "image/webp"
    case ".bmp":
      return "image/bmp"
    case ".tif":
    case ".tiff":
      return "image/tiff"
    case ".heic":
      return "image/heic"
    case ".pdf":
      return "application/pdf"
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case ".hwp":
      return "application/x-hwp"
    case ".hwpx":
      return "application/haansofthwpx"
    default:
      return "application/octet-stream"
  }
}

const args = process.argv.slice(2)
const src = args.find((a) => a !== "-o" && args[args.indexOf(a) - 1] !== "-o")
const outIdx = args.indexOf("-o")
const out = outIdx >= 0 ? args[outIdx + 1] : null
if (!src || !out) usage()

const apiKey = (process.env.UPSTAGE_API_KEY || "").trim()
if (!apiKey) {
  process.stderr.write("UPSTAGE_API_KEY is not set. Put it in the user env or a local secrets.env — never commit it.\n")
  process.exit(2)
}

const buf = readFileSync(src)
const name = basename(src)
const form = new FormData()
form.append("document", new Blob([buf], { type: mimeFor(src) }), name)
form.append("model", "document-parse")
form.append("ocr", process.env.UPSTAGE_OCR || "auto")
form.append("mode", process.env.UPSTAGE_MODE || "auto")
form.append("output_formats", JSON.stringify(["markdown"]))

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { Authorization: "Bearer " + apiKey },
  body: form,
})

const text = await res.text()
let json
try {
  json = JSON.parse(text)
} catch {
  process.stderr.write("Upstage returned non-JSON (" + res.status + "): " + text.slice(0, 500) + "\n")
  process.exit(1)
}

if (!res.ok) {
  const msg = json.message || json.error?.message || json.error || text.slice(0, 500)
  process.stderr.write("Upstage HTTP " + res.status + ": " + msg + "\n")
  process.exit(1)
}

const md = (json.content && (json.content.markdown || json.content.text || json.content.html)) || ""
if (!String(md).trim()) {
  process.stderr.write("Upstage returned empty content\n")
  process.exit(1)
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, md, "utf8")
process.stderr.write("[upstage] " + name + " OK\n")
