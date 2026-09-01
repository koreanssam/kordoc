/**
 * Upstage Document Parse OCR provider.
 *
 * kordoc의 `ParseOptions.ocr` 훅에 꽂는다. API 키는 환경변수
 * `UPSTAGE_API_KEY` 만 사용한다 — 소스/깃에 키를 넣지 말 것.
 *
 * @example
 * ```ts
 * import { parse, createUpstageOcrProvider } from "kordoc"
 *
 * const result = await parse(buffer, {
 *   ocr: createUpstageOcrProvider(),
 * })
 * ```
 *
 * 이미지 파일 전체를 한 번에 넘기려면 `parseFileWithUpstage(path)`.
 */

import { readFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import type { OcrProvider } from "../types.js"

const ENDPOINT = "https://api.upstage.ai/v1/document-digitization"

if (process.env.UPSTAGE_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
}

export interface UpstageParseOptions {
  /** default: process.env.UPSTAGE_API_KEY */
  apiKey?: string
  /** default auto */
  ocr?: "auto" | "force"
  /** default auto */
  mode?: "standard" | "enhanced" | "auto"
}

function requireApiKey(explicit?: string): string {
  const key = (explicit || process.env.UPSTAGE_API_KEY || "").trim()
  if (!key) {
    throw new Error(
      "UPSTAGE_API_KEY 가 없습니다. 사용자 환경변수 또는 로컬 secrets.env 에만 넣고, 깃에는 커밋하지 마세요.",
    )
  }
  return key
}

function mimeFor(fileName: string, fallback: string): string {
  switch (extname(fileName).toLowerCase()) {
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
    default:
      return fallback
  }
}

async function postDocument(
  bytes: Uint8Array,
  fileName: string,
  mime: string,
  opts: UpstageParseOptions = {},
): Promise<string> {
  const apiKey = requireApiKey(opts.apiKey)
  const form = new FormData()
  form.append("document", new Blob([bytes], { type: mime }), fileName)
  form.append("model", "document-parse")
  form.append("ocr", opts.ocr || process.env.UPSTAGE_OCR || "auto")
  form.append("mode", opts.mode || process.env.UPSTAGE_MODE || "auto")
  form.append("output_formats", JSON.stringify(["markdown"]))

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const text = await res.text()
  let json: {
    content?: { markdown?: string; text?: string; html?: string }
    message?: string
    error?: { message?: string } | string
  }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Upstage non-JSON (${res.status}): ${text.slice(0, 300)}`)
  }
  if (!res.ok) {
    const msg =
      json.message ||
      (typeof json.error === "string" ? json.error : json.error?.message) ||
      text.slice(0, 300)
    throw new Error(`Upstage HTTP ${res.status}: ${msg}`)
  }
  const md = json.content?.markdown || json.content?.text || json.content?.html || ""
  if (!md.trim()) throw new Error("Upstage returned empty content")
  return md
}

/** kordoc `ocr:` 훅 — 페이지 PNG를 Upstage Document Parse 에 넘긴다. */
export function createUpstageOcrProvider(opts: UpstageParseOptions = {}): OcrProvider {
  return async (pageImage, pageNumber, mimeType) => {
    const name = `page-${pageNumber}.${mimeType === "image/jpeg" ? "jpg" : "png"}`
    return postDocument(pageImage, name, mimeType, opts)
  }
}

/** 이미지/스캔 PDF 등 파일 전체를 Document Parse 한다 (워처·CLI 용). */
export async function parseFileWithUpstage(
  filePath: string,
  opts: UpstageParseOptions = {},
): Promise<string> {
  const buf = await readFile(filePath)
  const name = basename(filePath)
  return postDocument(new Uint8Array(buf), name, mimeFor(name, "application/octet-stream"), opts)
}
