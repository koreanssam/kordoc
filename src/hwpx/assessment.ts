/**
 * 학교 정기시험 전용 HWPX 프리셋.
 *
 * 한컴에서 저장한 실물 템플릿을 골격으로 사용하고 문항/채점 행만 복제한다.
 * charPr·paraPr·borderFill을 새로 추정하지 않으므로 글꼴, 장평, 자간, 행간,
 * 표 테두리와 셀 병합이 기준 문서와 동일하게 유지된다.
 */

import {
  DOMParser,
  XMLSerializer,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"

export type AssessmentPreset = "exam" | "rubric"

interface FrontMatter {
  [key: string]: string
}

interface ExamPassage {
  kind: "passage"
  title: string
  body: string[]
}

interface ExamQuestion {
  kind: "question"
  text: string
}

interface ExamView {
  kind: "view"
  body: string[]
}

type ExamBlock = ExamPassage | ExamQuestion | ExamView

const TEMPLATE_FILES: Record<AssessmentPreset, string> = {
  exam: "exam-template.hwpx",
  rubric: "rubric-template.hwpx",
}

const NS_PARA = "http://www.hancom.co.kr/hwpml/2011/paragraph"

function localName(node: XmlNode): string {
  return ("localName" in node && typeof node.localName === "string" ? node.localName : "")
    || node.nodeName.replace(/^.*:/, "")
}

function elements(node: XmlNode, name?: string): XmlElement[] {
  const out: XmlElement[] = []
  const all = (node as XmlElement).getElementsByTagName?.("*") ?? []
  for (let i = 0; i < all.length; i++) {
    const el = all.item(i)
    if (el && (!name || localName(el) === name)) out.push(el)
  }
  return out
}

function directElements(node: XmlNode, name?: string): XmlElement[] {
  const out: XmlElement[] = []
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes.item(i)
    if (child?.nodeType === 1 && (!name || localName(child) === name)) out.push(child as XmlElement)
  }
  return out
}

function firstElement(node: XmlNode, name: string): XmlElement | null {
  return elements(node, name)[0] ?? null
}

function nodeText(node: XmlNode): string {
  return elements(node, "t").map((el) => el.textContent ?? "").join("")
}

function removeDescendants(node: XmlNode, name: string): void {
  for (const el of elements(node, name)) el.parentNode?.removeChild(el)
}

function setFirstText(node: XmlNode, text: string): void {
  const textNodes = elements(node, "t")
  if (textNodes.length === 0) {
    const run = firstElement(node, "run")
    if (!run) return
    const owner = run.ownerDocument
    if (!owner) return
    const t = owner.createElementNS(NS_PARA, "hp:t")
    t.appendChild(owner.createTextNode(text))
    run.appendChild(t)
  } else {
    textNodes[0].textContent = text
    for (let i = 1; i < textNodes.length; i++) textNodes[i].textContent = ""
  }
  removeDescendants(node, "linesegarray")
}

function replaceText(node: XmlNode, match: (text: string) => boolean, value: string): boolean {
  for (const t of elements(node, "t")) {
    const text = t.textContent ?? ""
    if (!match(text)) continue
    t.textContent = value
    return true
  }
  return false
}

function parseFrontMatter(markdown: string): { meta: FrontMatter; body: string } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  if (lines[0]?.trim() !== "---") return { meta: {}, body: markdown }
  const meta: FrontMatter = {}
  let i = 1
  for (; i < lines.length && lines[i].trim() !== "---"; i++) {
    const m = lines[i].match(/^\s*([^:#][^:]*)\s*:\s*(.*?)\s*$/)
    if (m) meta[m[1].trim()] = m[2].replace(/^(['"])(.*)\1$/, "$2")
  }
  return { meta, body: lines.slice(Math.min(i + 1, lines.length)).join("\n") }
}

function metaValue(meta: FrontMatter, aliases: string[], fallback: string): string {
  for (const key of aliases) {
    if (meta[key] !== undefined && meta[key] !== "") return meta[key]
  }
  return fallback
}

function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim()
}

function splitCellLines(text: string): string[] {
  return text
    .split(/<br\s*\/?>|\n/gi)
    .map(stripInline)
    .filter((line) => line.length > 0)
}

function templatePath(preset: AssessmentPreset): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = TEMPLATE_FILES[preset]
  const candidates = [
    resolve(here, "../../templates/assessment", file), // src/hwpx/*.ts
    resolve(here, "../templates/assessment", file),   // dist/*.js
    resolve(process.cwd(), "templates/assessment", file),
  ]
  const found = candidates.find(existsSync)
  if (!found) throw new Error(`평가 문서 내장 템플릿을 찾을 수 없습니다: ${file}`)
  return found
}

async function loadTemplate(preset: AssessmentPreset): Promise<JSZip> {
  return JSZip.loadAsync(readFileSync(templatePath(preset)))
}

function parseExamBlocks(body: string): ExamBlock[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")
  const blocks: ExamBlock[] = []
  let current: ExamPassage | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const passage = line.match(/^##\s+(.+)$/)
    if (passage) {
      current = { kind: "passage", title: stripInline(passage[1]), body: [] }
      blocks.push(current)
      continue
    }

    const question = line.match(/^#\s+(.+)$/)
    if (question) {
      current = null
      blocks.push({ kind: "question", text: stripInline(question[1]) })
      continue
    }

    if (/^:::\s*(보기|view)\s*$/i.test(line)) {
      current = null
      const viewLines: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== ":::") {
        if (lines[i].trim()) viewLines.push(stripInline(lines[i]))
        i++
      }
      blocks.push({ kind: "view", body: viewLines })
      continue
    }

    if (current) current.body.push(stripInline(line))
  }

  return blocks
}

function parseExtractedExamBlocks(body: string): ExamBlock[] {
  const tables: string[] = []
  const tokenized = body.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const index = tables.push(table) - 1
    return `\n@@KORDOC_EXAM_TABLE_${index}@@\n`
  })
  const blocks: ExamBlock[] = []
  let current: ExamPassage | null = null

  for (const rawLine of tokenized.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^\\?\*\s*확인 사항/.test(line)) break

    const tableToken = line.match(/^@@KORDOC_EXAM_TABLE_(\d+)@@$/)
    if (tableToken) {
      const table = tables[Number(tableToken[1])] ?? ""
      if (!table.includes("<보기>")) continue // 첫 표는 시험지 머리표
      const cells = [...table.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map((cell) => decodeHtmlText(cell[1]))
        .filter((cell) => cell && cell !== "<보기>")
      const content = cells.sort((a, b) => b.length - a.length)[0] ?? ""
      blocks.push({ kind: "view", body: content.split("\n").map((v) => v.trim()).filter(Boolean) })
      current = null
      continue
    }

    const passage = line.match(/^\[(서술형\s*\d+)\]\s*(.+)$/)
    if (passage) {
      current = {
        kind: "passage",
        title: `[${passage[1].replace(/\s+/g, " ")}] ${stripInline(passage[2])}`,
        body: [],
      }
      blocks.push(current)
      continue
    }

    const question = line.match(/^서술형\s*\d+(?:-\d+)?\.\s*.+$/)
    if (question) {
      blocks.push({
        kind: "question",
        text: stripInline(line).replace(/\\~/g, "~").replace(/\s+/g, " "),
      })
      current = null
      continue
    }

    if (current) current.body.push(stripInline(line).replace(/\\~/g, "~"))
  }
  return blocks
}

function enrichExamMeta(meta: FrontMatter, body: string): FrontMatter {
  const out = { ...meta }
  const tables = body.match(/<table\b[\s\S]*?<\/table>/gi) ?? []
  const header = tables[0] ?? ""
  const plainHeader = decodeHtmlText(header)
  const date = plainHeader.match(/(\d{4}\.\d{1,2}\.\d{1,2}\.\([^)]+\)\s*\d+교시)/)
  const subjectCode = header.match(/<t[hd]\b[^>]*>\s*([^<]+?)\s*<br\s*\/?>\s*\(\s*과목코드\s*:\s*([^)]+)\)/i)
  const school = plainHeader.match(/과목코드\s*:[^)]*\)\s*([^\n]+학교)/)
  const pages = plainHeader.match(/전체쪽수\s*(\d+)쪽/)
  const questions = plainHeader.match(/전체문항수\s*(\d+)문항/)
  const grade = plainHeader.match(/\(\s*(\d+)\s*\)학년/)
  const exam = plainHeader.match(/(\d{4}학년도\s*\d+학기\s*\d+차시험)/)
  const score = decodeHtmlText(body).match(/만점\s*(\d+(?:\.\d+)?)점\s*:\s*서술형\s*\((\d+(?:\.\d+)?)\)점/)

  if (date) out["시험일시"] ??= date[1]
  if (subjectCode) {
    out["과목"] ??= subjectCode[1]
    out["과목코드"] ??= subjectCode[2].trim()
  }
  if (school) out["학교"] ??= school[1].trim()
  if (pages) out["전체쪽수"] ??= pages[1]
  if (questions) out["전체문항수"] ??= questions[1]
  if (grade) out["학년"] ??= grade[1]
  if (exam) out["시험명"] ??= exam[1].replace(/\s+/g, " ")
  if (score) {
    out["만점"] ??= score[1]
    out["서술형점수"] ??= score[2]
  }
  return out
}

function cloneClean<T extends XmlNode>(node: T): T {
  const clone = node.cloneNode(true) as T
  removeDescendants(clone, "linesegarray")
  for (const p of elements(clone, "p")) {
    p.setAttribute("id", "0")
    p.setAttribute("pageBreak", "0")
    p.setAttribute("columnBreak", "0")
  }
  return clone
}

function setQuestionText(questionPara: XmlElement, text: string): void {
  const m = text.match(/^((?:서술형\s*)?[\d]+(?:-\d+)?\.)\s*(.*)$/)
  const prefix = m?.[1] ?? ""
  const rest = m?.[2] ?? text
  const runs = directElements(questionPara, "run")
  if (runs.length < 2) {
    setFirstText(questionPara, text)
    return
  }
  setFirstText(runs[0], prefix)

  const score = rest.match(/^(.*?)(\s*\(\s*\d+(?:\.\d+)?\s*점\s*\))$/)
  const t = firstElement(runs[1], "t")
  if (!t) {
    setFirstText(runs[1], ` ${rest}`)
    return
  }
  const owner = t.ownerDocument
  if (!owner) return
  while (t.firstChild) t.removeChild(t.firstChild)
  t.appendChild(owner.createTextNode(` ${score?.[1]?.trim() ?? rest}`))
  if (score) {
    const originalTab = firstElement(questionPara, "tab")
    if (originalTab) t.appendChild(originalTab.cloneNode(true))
    t.appendChild(owner.createTextNode(` ${score[2].trim()}`))
  }
  removeDescendants(questionPara, "linesegarray")
}

function blankQuestion(questionPara: XmlElement): XmlElement {
  const blank = cloneClean(questionPara)
  for (const t of elements(blank, "t")) t.textContent = ""
  return blank
}

function buildPassage(template: XmlElement, title: string, body: string[]): XmlElement {
  const host = cloneClean(template)
  const table = firstElement(host, "tbl")
  if (!table) return host
  const rows = directElements(table, "tr")
  if (rows.length < 2) return host

  const titlePara = firstElement(rows[0], "p")
  if (titlePara) setFirstText(titlePara, title)

  const bodyCell = firstElement(rows[1], "tc")
  const subList = bodyCell ? firstElement(bodyCell, "subList") : null
  if (!subList) return host
  const exemplar = directElements(subList, "p")[0]
  if (!exemplar) return host
  for (const p of directElements(subList, "p")) subList.removeChild(p)
  const lines = body.length > 0 ? body : [""]
  for (const line of lines) {
    const p = cloneClean(exemplar)
    setFirstText(p, line)
    subList.appendChild(p)
  }

  const bodyHeight = Math.max(1800, lines.length * 1600 + 750)
  const tableHeight = bodyHeight + 1550
  firstElement(table, "sz")?.setAttribute("height", String(tableHeight))
  firstElement(bodyCell!, "cellSz")?.setAttribute("height", String(bodyHeight))
  return host
}

function buildView(template: XmlElement, body: string[]): XmlElement {
  const host = cloneClean(template)
  const table = firstElement(host, "tbl")
  if (!table) return host
  const cells = elements(table, "tc")
  const contentCell = cells
    .map((cell) => ({ cell, length: nodeText(cell).replace(/[<>\s]/g, "").length }))
    .sort((a, b) => b.length - a.length)[0]?.cell
  if (!contentCell) return host
  const subList = firstElement(contentCell, "subList")
  if (!subList) return host
  const exemplar = directElements(subList, "p")[0]
  if (!exemplar) return host
  for (const p of directElements(subList, "p")) subList.removeChild(p)
  const lines = body.length > 0 ? body : [""]
  for (const line of lines) {
    const p = cloneClean(exemplar)
    setFirstText(p, line)
    subList.appendChild(p)
  }
  const height = Math.max(2400, lines.length * 1600 + 900)
  firstElement(contentCell, "cellSz")?.setAttribute("height", String(height))
  const sz = firstElement(table, "sz")
  if (sz) sz.setAttribute("height", String(height + 2200))
  return host
}

function updateExamHeader(headerHost: XmlElement, meta: FrontMatter): void {
  const date = metaValue(meta, ["시험일시", "exam_date", "date"], "2026.4.28.(화) 2교시")
  const subject = metaValue(meta, ["과목", "subject"], "국어")
  const code = metaValue(meta, ["과목코드", "subject_code"], "01")
  const school = metaValue(meta, ["학교", "school"], "영산중학교")
  const grade = metaValue(meta, ["학년", "grade"], "2")
  const examTitle = metaValue(meta, ["시험명", "exam_title"], "2026학년도 1학기 1차시험")
  const pages = metaValue(meta, ["전체쪽수", "total_pages"], "6")
  const questions = metaValue(meta, ["전체문항수", "total_questions"], "9")

  replaceText(headerHost, (t) => /\d{4}\.\d{1,2}\.\d{1,2}\.\(.+\).+교시/.test(t), date)
  replaceText(headerHost, (t) => t.trim() === "국어", subject)
  replaceText(headerHost, (t) => t.includes("과목코드"), `( 과목코드: ${code})`)
  replaceText(headerHost, (t) => t.includes("영산중학교"), ` ${school}`)
  replaceText(headerHost, (t) => /^\d+쪽$/.test(t.trim()), `${pages}쪽`)
  replaceText(headerHost, (t) => /^\d+문항$/.test(t.trim()), `${questions}문항`)
  replaceText(headerHost, (t) => /\(\s*\d+\s*\)학년/.test(t), `( ${grade} )학년`)
  replaceText(headerHost, (t) => /학년도.+학기.+차\s*시험?/.test(t), examTitle)
}

function adjustExamFooter(footerHost: XmlElement): void {
  if (!nodeText(footerHost).includes("확인 사항")) return
  const table = firstElement(footerHost, "tbl")
  if (!table) return

  // linesegarray 제거 후 문장이 다시 줄바꿈되어도 세 줄이 표 안에 들어가게 한다.
  const height = 5200
  firstElement(table, "sz")?.setAttribute("height", String(height))
  for (const cell of elements(table, "tc")) {
    firstElement(cell, "cellSz")?.setAttribute("height", String(height))
  }
}

async function buildExam(markdown: string): Promise<ArrayBuffer> {
  const parsed = parseFrontMatter(markdown)
  const body = parsed.body
  const meta = enrichExamMeta(parsed.meta, body)
  const authoredBlocks = parseExamBlocks(body)
  const blocks = authoredBlocks.length > 0 ? authoredBlocks : parseExtractedExamBlocks(body)
  const zip = await loadTemplate("exam")
  const sectionFile = zip.file("Contents/section0.xml")
  if (!sectionFile) throw new Error("고사원안 템플릿에 Contents/section0.xml이 없습니다")
  const doc = new DOMParser().parseFromString(await sectionFile.async("string"), "application/xml")
  const root = doc.documentElement
  if (!root) throw new Error("고사원안 템플릿의 section XML 루트가 없습니다")
  const paras = directElements(root, "p")
  const header = paras.find((p) => nodeText(p).includes("전체문항수"))
  const score = paras.find((p) => nodeText(p).includes("※ 만점"))
  const guide = paras.find((p) => nodeText(p).includes("답안지에 쓰기"))
  const passage = paras.find((p) => nodeText(p).includes("[서술형 1]"))
  const question = paras.find((p) => nodeText(p).includes("서술형 1-1."))
  const view = paras.find((p) => nodeText(p).includes("<보기>"))
  if (!header || !score || !guide || !passage || !question || !view) {
    throw new Error("고사원안 템플릿에서 필수 스타일 표본을 찾지 못했습니다")
  }

  const footer = paras.filter((p) => {
    const t = nodeText(p)
    return t.includes("확인 사항") || t.includes("답안지의 해당란")
      || t.includes("무단복제") || /국어과\s*\d+\s*-/.test(t)
  })
  for (const p of paras) root.removeChild(p)

  const headerOut = cloneClean(header)
  updateExamHeader(headerOut, meta)
  root.appendChild(headerOut)

  const total = metaValue(meta, ["만점", "total_score"], "100")
  const essay = metaValue(meta, ["서술형점수", "essay_score"], total)
  const scoreOut = cloneClean(score)
  setFirstText(scoreOut, `※ 만점 ${total}점 : 서술형 (${essay})점`)
  root.appendChild(scoreOut)

  const questionCount = metaValue(meta, ["전체문항수", "total_questions"], String(blocks.filter((b) => b.kind === "question").length))
  const guideOut = cloneClean(guide)
  setFirstText(guideOut, `서술형 1~${questionCount}번 → 서술형 답안지에 쓰기`)
  root.appendChild(guideOut)

  for (const block of blocks) {
    if (block.kind === "passage") {
      root.appendChild(buildPassage(passage, block.title, block.body))
    } else if (block.kind === "question") {
      const q = cloneClean(question)
      setQuestionText(q, block.text)
      root.appendChild(q)
      root.appendChild(blankQuestion(question))
      root.appendChild(blankQuestion(question))
    } else {
      root.appendChild(buildView(view, block.body))
    }
  }

  for (const p of footer) {
    const out = cloneClean(p)
    const grade = metaValue(meta, ["학년", "grade"], "2")
    const subject = metaValue(meta, ["과목", "subject"], "국어")
    replaceText(out, (t) => /국어과\s*\d+\s*-/.test(t), `${grade}학년 ${subject}과 -`)
    adjustExamFooter(out)
    root.appendChild(out)
  }

  zip.file("Contents/section0.xml", new XMLSerializer().serializeToString(doc))
  zip.file("Preview/PrvText.txt", body.replace(/^#+\s*/gm, "").slice(0, 4000))
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" })
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })
}

function parseMarkdownTable(body: string): string[][] {
  const rows: string[][] = []
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue
    if (/^[\s|:\-]+$/.test(trimmed)) continue
    rows.push(trimmed.slice(1, -1).split("|").map((cell) => cell.trim()))
  }
  return rows
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim()
}

function parseHtmlRubricTable(body: string): string[][] {
  const tables = body.match(/<table\b[\s\S]*?<\/table>/gi) ?? []
  const rubric = tables.find((table) => /<t[hd]\b[^>]*>\s*문항\s*<\/t[hd]>/i.test(table))
  if (!rubric) return []

  const rows: string[][] = []
  for (const rowMatch of rubric.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((cell) => decodeHtmlText(cell[1]))
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

function enrichRubricMeta(meta: FrontMatter, body: string): FrontMatter {
  const out = { ...meta }
  const plain = decodeHtmlText(body)
  const title = plain.match(/\(([^)]+)\)과\s*(\d{4})학년도\s*\(\s*(\d+)\s*\)학기\s*\(\s*(\d+)\s*\)차\s*시험\s*\((\d+)\)학년/)
  if (title) {
    out["과목"] ??= title[1]
    out["학년도"] ??= title[2]
    out["학기"] ??= title[3]
    out["차수"] ??= title[4]
    out["학년"] ??= title[5]
  }
  const score = plain.match(/반영점수\s*:\s*(\d+(?:\.\d+)?)점/)
  if (score) out["반영점수"] ??= score[1]
  const authors = plain.match(/출\s*제\s*자\s*:\s*([^\n]+)/)
  if (authors) out["출제자"] ??= authors[1].trim()
  return out
}

function setCellText(cell: XmlElement, text: string): void {
  const subList = firstElement(cell, "subList")
  if (!subList) return
  const exemplar = directElements(subList, "p")[0]
  if (!exemplar) return
  for (const p of directElements(subList, "p")) subList.removeChild(p)
  const lines = splitCellLines(text)
  for (const line of lines.length > 0 ? lines : [""]) {
    const p = cloneClean(exemplar)
    setFirstText(p, line)
    subList.appendChild(p)
  }
}

function estimateRubricRowHeight(cells: string[]): number {
  const lineCounts = cells.map((cell, i) => {
    const explicit = Math.max(1, splitCellLines(cell).length)
    const width = i === 1 ? 26 : i === 2 ? 24 : 8
    return Math.max(explicit, Math.ceil(stripInline(cell).length / width))
  })
  return Math.max(1700, Math.max(...lineCounts) * 1450 + 500)
}

function updateRubricMetadata(root: XmlElement, meta: FrontMatter): void {
  const subject = metaValue(meta, ["과목", "subject"], "국어")
  const year = metaValue(meta, ["학년도", "year"], "2026")
  const semester = metaValue(meta, ["학기", "semester"], "1")
  const round = metaValue(meta, ["차수", "round"], "1")
  const grade = metaValue(meta, ["학년", "grade"], "2")
  const score = metaValue(meta, ["반영점수", "total_score"], "100")
  const authors = metaValue(meta, ["출제자", "authors"], "이 성 원 (인) , 정 순 순 (인)")
  const exam = `${year}학년도 ${semester}학기 ${round}차 시험`

  replaceText(root, (t) => /^\(.+\)과.+학년도/.test(t.trim()), `(${subject})과 ${year}학년도 ( ${semester} )학기 ( ${round} )차 시험 (${grade})학년`)
  replaceText(root, (t) => t.includes("관련평가"), `관련평가 : ${exam}`)
  replaceText(root, (t) => t.includes("반영점수"), `반영점수 : ${score}점`)
  replaceText(root, (t) => t.includes("출 제 자"), `출 제 자 : ${authors}`)
}

async function buildRubric(markdown: string): Promise<ArrayBuffer> {
  const parsed = parseFrontMatter(markdown)
  const body = parsed.body
  const meta = enrichRubricMeta(parsed.meta, body)
  const markdownRows = parseMarkdownTable(body)
  const parsedRows = markdownRows.length > 0 ? markdownRows : parseHtmlRubricTable(body)
  const dataRows = parsedRows.length > 0 && /문항/.test(parsedRows[0][0] ?? "") ? parsedRows.slice(1) : parsedRows
  const totalInput = dataRows.find((row) => /합\s*계/.test(row[0] ?? ""))
  const rows = dataRows.filter((row) => !/합\s*계/.test(row[0] ?? "")).map((row) => [...row, "", "", ""].slice(0, 4))
  const total = totalInput?.[3] || metaValue(meta, ["반영점수", "total_score"], "100")

  const zip = await loadTemplate("rubric")
  const sectionFile = zip.file("Contents/section0.xml")
  if (!sectionFile) throw new Error("채점기준표 템플릿에 Contents/section0.xml이 없습니다")
  const doc = new DOMParser().parseFromString(await sectionFile.async("string"), "application/xml")
  const root = doc.documentElement
  if (!root) throw new Error("채점기준표 템플릿의 section XML 루트가 없습니다")
  updateRubricMetadata(root, meta)

  const tables = elements(root, "tbl")
  const rubricTable = tables.find((tbl) => Number(tbl.getAttribute("colCnt")) === 4 && Number(tbl.getAttribute("rowCnt")) > 5)
  if (!rubricTable) throw new Error("채점기준표 템플릿에서 본표를 찾지 못했습니다")
  const templateRows = directElements(rubricTable, "tr")
  if (templateRows.length < 3) throw new Error("채점기준표 본표에 행 표본이 부족합니다")
  const header = templateRows[0]
  const exemplar = templateRows[1]
  const totalRow = templateRows[templateRows.length - 1]
  for (const tr of templateRows) rubricTable.removeChild(tr)
  rubricTable.appendChild(cloneClean(header))

  let tableHeight = 1900
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    const tr = cloneClean(exemplar)
    const cells = directElements(tr, "tc")
    const height = estimateRubricRowHeight(row)
    for (let i = 0; i < Math.min(4, cells.length); i++) {
      setCellText(cells[i], row[i])
      firstElement(cells[i], "cellSz")?.setAttribute("height", String(height))
      firstElement(cells[i], "cellAddr")?.setAttribute("rowAddr", String(rowIndex + 1))
    }
    tableHeight += height
    rubricTable.appendChild(tr)
  }

  const totalOut = cloneClean(totalRow)
  const totalCells = directElements(totalOut, "tc")
  if (totalCells.length > 0) setCellText(totalCells[0], "합 계")
  if (totalCells.length > 1) setCellText(totalCells[totalCells.length - 1], total)
  for (const cell of totalCells) {
    firstElement(cell, "cellAddr")?.setAttribute("rowAddr", String(rows.length + 1))
  }
  rubricTable.appendChild(totalOut)
  tableHeight += 1700
  rubricTable.setAttribute("rowCnt", String(rows.length + 2))
  firstElement(rubricTable, "sz")?.setAttribute("height", String(tableHeight))

  zip.file("Contents/section0.xml", new XMLSerializer().serializeToString(doc))
  zip.file("Preview/PrvText.txt", body.replace(/^#+\s*/gm, "").slice(0, 4000))
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" })
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })
}

export function isAssessmentPreset(value: string | undefined): value is AssessmentPreset {
  return value === "exam" || value === "rubric"
}

export async function markdownToAssessmentHwpx(markdown: string, preset: AssessmentPreset): Promise<ArrayBuffer> {
  return preset === "exam" ? buildExam(markdown) : buildRubric(markdown)
}
