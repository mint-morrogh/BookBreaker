import JSZip from 'jszip'
import type { Chapter } from './content'

// ── Public API ────────────────────────────────────────────────

export interface ParsedBook {
  title: string
  author: string
  chapters: Chapter[]
}

export type SupportedFormat = 'txt' | 'epub' | 'html' | 'docx'

const FORMAT_MAP: Record<string, SupportedFormat> = {
  '.txt': 'txt', '.text': 'txt',
  '.epub': 'epub',
  '.html': 'html', '.htm': 'html', '.xhtml': 'html',
  '.docx': 'docx',
}

export const ACCEPTED_EXTENSIONS = Object.keys(FORMAT_MAP).join(',')

export function detectFormat(filename: string): SupportedFormat | null {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return FORMAT_MAP[ext] ?? null
}

/**
 * Parse a file (ArrayBuffer) into chapters + metadata.
 * Falls back to treating unknown formats as plain text.
 */
export async function parseFile(file: File): Promise<ParsedBook> {
  const fmt = detectFormat(file.name)
  const buf = await file.arrayBuffer()

  switch (fmt) {
    case 'epub': return parseEpub(buf)
    case 'docx': return parseDocx(buf)
    case 'html':  return parseHtml(await file.text())
    case 'txt':
    default:      return parsePlainText(await file.text(), file.name)
  }
}

// ── Plain text ────────────────────────────────────────────────

function parsePlainText(text: string, filename: string): ParsedBook {
  const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  return { title, author: '', chapters: textToChapters(text) }
}

// ── HTML ──────────────────────────────────────────────────────

function parseHtml(html: string): ParsedBook {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Try to extract title
  const title = doc.querySelector('title')?.textContent?.trim()
    || doc.querySelector('h1')?.textContent?.trim()
    || 'Imported Book'

  // Try to extract author from common meta tags
  const author = doc.querySelector('meta[name="author"]')?.getAttribute('content')?.trim()
    || doc.querySelector('meta[name="dc.creator"]')?.getAttribute('content')?.trim()
    || ''

  // Try heading-based chapter splitting first
  const chapters = extractChaptersFromHtmlDoc(doc)
  if (chapters.length >= 2) {
    return { title, author, chapters }
  }

  // Fall back to treating all body text as plain text with chapter detection
  const bodyText = extractTextFromNode(doc.body)
  return { title, author, chapters: textToChapters(bodyText) }
}

function extractChaptersFromHtmlDoc(doc: Document): Chapter[] {
  // Look for heading elements that denote chapters
  const headings = doc.querySelectorAll('h1, h2, h3')
  const chapterHeadings: { el: Element; title: string }[] = []

  for (const h of headings) {
    const text = h.textContent?.trim() ?? ''
    if (text.length > 0 && text.length < 200) {
      // Filter to things that look like chapter headings
      if (/chapter|part|book|section|prologue|epilogue|\b[ivxlc]+\b/i.test(text) || h.tagName === 'H1') {
        chapterHeadings.push({ el: h, title: text })
      }
    }
  }

  if (chapterHeadings.length < 2) return []

  const chapters: Chapter[] = []
  for (let i = 0; i < chapterHeadings.length; i++) {
    // Collect all text between this heading and the next
    const startEl = chapterHeadings[i].el
    const endEl = i + 1 < chapterHeadings.length ? chapterHeadings[i + 1].el : null
    const paragraphs = collectTextBetween(startEl, endEl)
    if (paragraphs.length > 0) {
      chapters.push({ title: chapterHeadings[i].title, paragraphs })
    }
  }

  return chapters
}

function collectTextBetween(startEl: Element, endEl: Element | null): string[] {
  const paragraphs: string[] = []
  let node: Element | null = startEl.nextElementSibling

  while (node && node !== endEl) {
    const text = extractTextFromNode(node).trim()
    if (text.length > 0) {
      // If it's a block element, treat as separate paragraph
      const tag = node.tagName.toLowerCase()
      if (['p', 'div', 'blockquote', 'section', 'article'].includes(tag)) {
        paragraphs.push(cleanText(text))
      } else {
        // Inline or other — append to last paragraph or create new
        if (paragraphs.length > 0) {
          paragraphs[paragraphs.length - 1] += ' ' + cleanText(text)
        } else {
          paragraphs.push(cleanText(text))
        }
      }
    }
    node = node.nextElementSibling
  }

  return paragraphs.filter(p => p.length > 0)
}

// ── EPUB ──────────────────────────────────────────────────────

async function parseEpub(buf: ArrayBuffer): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buf)

  // 1. Find the OPF (package) file via container.xml
  const containerXml = await readZipText(zip, 'META-INF/container.xml')
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml')
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path') ?? ''
  if (!rootfilePath) throw new Error('Invalid EPUB: no rootfile in container.xml')

  // 2. Parse the OPF for metadata + spine
  const opfText = await readZipText(zip, rootfilePath)
  const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml')
  const opfDir = rootfilePath.includes('/') ? rootfilePath.slice(0, rootfilePath.lastIndexOf('/') + 1) : ''

  // Metadata
  const title = getEpubMeta(opfDoc, 'title') || 'Imported Book'
  const author = getEpubMeta(opfDoc, 'creator') || ''

  // 3. Get spine order (list of content document IDs)
  const spineItems = opfDoc.querySelectorAll('spine > itemref')
  const manifest = new Map<string, string>()
  for (const item of opfDoc.querySelectorAll('manifest > item')) {
    const id = item.getAttribute('id') ?? ''
    const href = item.getAttribute('href') ?? ''
    const mediaType = item.getAttribute('media-type') ?? ''
    if (mediaType.includes('html') || mediaType.includes('xml')) {
      manifest.set(id, href)
    }
  }

  // 4. Read each spine document in order, extract chapters
  const chapters: Chapter[] = []
  for (const itemref of spineItems) {
    const idref = itemref.getAttribute('idref') ?? ''
    const href = manifest.get(idref)
    if (!href) continue

    const filePath = opfDir + href
    let contentHtml: string
    try {
      contentHtml = await readZipText(zip, filePath)
    } catch {
      // Try URL-decoded path
      try {
        contentHtml = await readZipText(zip, decodeURIComponent(filePath))
      } catch { continue }
    }

    const contentDoc = new DOMParser().parseFromString(contentHtml, 'application/xhtml+xml')
    // If parsing as XHTML fails (common), retry as HTML
    if (contentDoc.querySelector('parsererror')) {
      const retryDoc = new DOMParser().parseFromString(contentHtml, 'text/html')
      const result = extractChapterFromEpubDoc(retryDoc)
      if (result) chapters.push(result)
      continue
    }

    const result = extractChapterFromEpubDoc(contentDoc)
    if (result) chapters.push(result)
  }

  // If we got no structured chapters, merge everything and use text-based splitting
  if (chapters.length === 0) {
    return { title, author, chapters: [{ title: 'Part 1', paragraphs: ['Unable to parse content'] }] }
  }

  // Merge very short spine documents that are likely part of the same chapter
  const merged = mergeShortSpineChapters(chapters)

  return { title, author, chapters: merged }
}

function extractChapterFromEpubDoc(doc: Document): Chapter | null {
  const body = doc.body || doc.querySelector('body')
  if (!body) return null

  // Try to find a chapter title from headings
  const heading = body.querySelector('h1, h2, h3')
  const chapterTitle = heading?.textContent?.trim() || ''

  // Extract all paragraphs
  const paragraphs: string[] = []

  // Walk block-level elements
  const blocks = body.querySelectorAll('p, div, blockquote, li')
  if (blocks.length > 0) {
    for (const block of blocks) {
      // Skip if this block is inside a heading we already captured
      if (heading && heading.contains(block)) continue
      const text = cleanText(extractTextFromNode(block))
      if (text.length > 0) paragraphs.push(text)
    }
  } else {
    // No block elements — extract raw body text
    const text = cleanText(extractTextFromNode(body))
    if (text.length > 0) paragraphs.push(text)
  }

  if (paragraphs.length === 0) return null

  // Use heading or generate a title
  const title = chapterTitle || `Part ${Math.random().toString(36).slice(2, 6)}`
  return { title, paragraphs }
}

function mergeShortSpineChapters(chapters: Chapter[]): Chapter[] {
  const MIN_WORDS = 100
  const merged: Chapter[] = []

  for (const ch of chapters) {
    const wordCount = ch.paragraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0)
    if (merged.length > 0 && wordCount < MIN_WORDS) {
      // Merge into previous chapter
      merged[merged.length - 1].paragraphs.push(...ch.paragraphs)
    } else {
      merged.push({ ...ch, paragraphs: [...ch.paragraphs] })
    }
  }

  // Renumber if titles are generic
  let partIdx = 1
  for (const ch of merged) {
    if (/^Part [a-z0-9]+$/i.test(ch.title)) {
      ch.title = `Part ${partIdx++}`
    }
  }

  return merged
}

function getEpubMeta(opfDoc: Document, name: string): string {
  // Try dc:title, dc:creator etc. with and without namespace
  const el = opfDoc.querySelector(`metadata > *|${name}`)
    ?? opfDoc.querySelector(`metadata > dc\\:${name}`)
    ?? opfDoc.querySelector(`metadata [name="${name}"]`)
  return el?.textContent?.trim() ?? ''
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`File not found in archive: ${path}`)
  return file.async('text')
}

// ── DOCX ──────────────────────────────────────────────────────

async function parseDocx(buf: ArrayBuffer): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buf)

  // Extract title/author from docProps/core.xml
  let title = 'Imported Book'
  let author = ''
  const coreFile = zip.file('docProps/core.xml')
  if (coreFile) {
    const coreXml = await coreFile.async('text')
    const coreDoc = new DOMParser().parseFromString(coreXml, 'application/xml')
    title = coreDoc.querySelector('title')?.textContent?.trim()
      ?? coreDoc.querySelector('dc\\:title')?.textContent?.trim()
      ?? title
    author = coreDoc.querySelector('creator')?.textContent?.trim()
      ?? coreDoc.querySelector('dc\\:creator')?.textContent?.trim()
      ?? author
  }

  // Parse document.xml — the main content
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Invalid DOCX: no word/document.xml')
  const docXml = await docFile.async('text')
  const doc = new DOMParser().parseFromString(docXml, 'application/xml')

  // DOCX uses w:p for paragraphs, w:r for runs, w:t for text
  // Heading styles (w:pStyle val="Heading1") denote chapter breaks
  const bodyEl = doc.querySelector('body') ?? doc.documentElement
  const wParagraphs = bodyEl.querySelectorAll('p')

  const chapters: Chapter[] = []
  let currentTitle = ''
  let currentParagraphs: string[] = []

  for (const wp of wParagraphs) {
    // Check if this paragraph has a heading style
    const pStyle = wp.querySelector('pPr > pStyle')
    const styleVal = pStyle?.getAttribute('val') ?? pStyle?.getAttribute('w:val') ?? ''
    const isHeading = /heading/i.test(styleVal) || /^(Title|Subtitle)$/i.test(styleVal)

    // Extract text from all runs
    const runs = wp.querySelectorAll('r')
    let text = ''
    for (const run of runs) {
      const tEls = run.querySelectorAll('t')
      for (const t of tEls) {
        text += t.textContent ?? ''
      }
    }
    text = cleanText(text)

    if (isHeading && text.length > 0) {
      // Save current chapter if it has content
      if (currentParagraphs.length > 0) {
        chapters.push({ title: currentTitle || `Part ${chapters.length + 1}`, paragraphs: currentParagraphs })
      }
      currentTitle = text
      currentParagraphs = []
    } else if (text.length > 0) {
      currentParagraphs.push(text)
    }
  }

  // Flush final chapter
  if (currentParagraphs.length > 0) {
    chapters.push({ title: currentTitle || `Part ${chapters.length + 1}`, paragraphs: currentParagraphs })
  }

  // If no heading-based chapters were found, fall back to text-based splitting
  if (chapters.length <= 1 && currentParagraphs.length > 0) {
    const allText = chapters.flatMap(ch => ch.paragraphs).join('\n\n')
    return { title, author, chapters: textToChapters(allText) }
  }

  if (chapters.length === 0) {
    return { title, author, chapters: [{ title: 'Part 1', paragraphs: ['Unable to parse content'] }] }
  }

  return { title, author, chapters }
}

// ── Shared utilities ──────────────────────────────────────────

/** Extract visible text from a DOM node, collapsing whitespace */
function extractTextFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as Element
  const tag = el.tagName?.toLowerCase()

  // Skip script, style, nav, header, footer
  if (['script', 'style', 'nav', 'header', 'footer', 'aside'].includes(tag)) return ''

  let text = ''
  for (const child of el.childNodes) {
    text += extractTextFromNode(child)
  }

  // Add spacing after block elements
  if (['p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'tr'].includes(tag)) {
    text += '\n\n'
  }

  return text
}

/** Clean text: collapse whitespace, strip control chars, normalize quotes */
function cleanText(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')  // zero-width chars
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")  // smart single quotes
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')  // smart double quotes
    .replace(/[\u2013\u2014]/g, '-')               // en/em dashes
    .replace(/\u2026/g, '...')                      // ellipsis
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split plain text into chapters using heading detection or word-count chunking */
function textToChapters(text: string): Chapter[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Try to split by chapter headings
  const chapterPattern = /^(chapter\s+[\divxlc]+[^\n]*)/gim
  const chapterMatches = [...normalized.matchAll(chapterPattern)]

  if (chapterMatches.length >= 2) {
    const chapters = chapterMatches.map((match, i) => {
      const start = match.index!
      const end = i + 1 < chapterMatches.length ? chapterMatches[i + 1].index! : normalized.length
      const chapterText = normalized.slice(start + match[0].length, end).trim()
      const paragraphs = splitIntoParagraphs(chapterText)
      return { title: match[1].trim(), paragraphs }
    }).filter(ch => ch.paragraphs.length > 0)

    if (chapters.length >= 2) return chapters
  }

  // Also try "BOOK" or "PART" headings (common in longer novels)
  const altPattern = /^((?:book|part|volume|act|section)\s+[\divxlc]+[^\n]*)/gim
  const altMatches = [...normalized.matchAll(altPattern)]
  if (altMatches.length >= 2) {
    const chapters = altMatches.map((match, i) => {
      const start = match.index!
      const end = i + 1 < altMatches.length ? altMatches[i + 1].index! : normalized.length
      const chapterText = normalized.slice(start + match[0].length, end).trim()
      const paragraphs = splitIntoParagraphs(chapterText)
      return { title: match[1].trim(), paragraphs }
    }).filter(ch => ch.paragraphs.length > 0)

    if (chapters.length >= 2) return chapters
  }

  // No chapter headings — split into chunks of ~500 words
  const allParagraphs = splitIntoParagraphs(normalized)
  const chapters: Chapter[] = []
  let current: string[] = []
  let wordCount = 0
  for (const p of allParagraphs) {
    current.push(p)
    wordCount += p.split(/\s+/).length
    if (wordCount >= 500) {
      chapters.push({ title: `Part ${chapters.length + 1}`, paragraphs: current })
      current = []
      wordCount = 0
    }
  }
  if (current.length > 0) {
    chapters.push({ title: `Part ${chapters.length + 1}`, paragraphs: current })
  }

  if (chapters.length === 0) {
    return [{ title: 'Part 1', paragraphs: [text.replace(/\s+/g, ' ').trim()] }]
  }

  return chapters
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => cleanText(p))
    .filter(p => p.length > 0)
}
