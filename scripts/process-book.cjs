#!/usr/bin/env node
/**
 * BookBreaker — Book Processing Pipeline
 *
 * Converts raw text files into game-ready TypeScript book modules.
 * Handles Gutenberg headers, chapter detection, paragraph splitting,
 * punctuation normalization, accent normalization, fused-word fixing,
 * long-paragraph splitting, and auto-difficulty classification.
 *
 * Usage:
 *   node scripts/process-book.cjs <input.txt> <output-name> [options]
 *
 * Options:
 *   --title "Book Title"         Book title (required)
 *   --author "Author Name"       Author name (required)
 *   --export CONST_NAME          TypeScript export const name (auto-generated from title if omitted)
 *   --chapters 3                 Number of chapters to extract (default: 3)
 *   --chapter-pattern "regex"    Custom regex for chapter detection
 *   --difficulty easy|medium|hard|very-hard   Override auto-detection
 *   --max-para-words 150         Split paragraphs longer than this (default: 150)
 *   --min-para-words 4           Drop paragraphs shorter than this (default: 4)
 *   --dry-run                    Print stats without writing file
 *
 * Examples:
 *   node scripts/process-book.cjs input.txt wizard-of-oz --title "The Wonderful Wizard of Oz" --author "L. Frank Baum"
 *   node scripts/process-book.cjs moby.txt moby-dick --title "Moby Dick" --author "Herman Melville" --chapters 5
 */

const fs = require('fs')
const path = require('path')

// ── Argument parsing ────────────────────────────────────────────
const args = process.argv.slice(2)
if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
BookBreaker Book Processing Pipeline

Usage: node scripts/process-book.cjs <input.txt> <output-name> [options]

Options:
  --title "Book Title"         Book title (required)
  --author "Author Name"       Author name (required)
  --export CONST_NAME          TS export name (auto from title)
  --chapters N                 Chapters to extract (default: 3)
  --chapter-pattern "regex"    Custom chapter regex
  --difficulty LEVEL           Override: easy, medium, hard, very-hard
  --max-para-words N           Split long paragraphs (default: 150)
  --min-para-words N           Drop short paragraphs (default: 4)
  --dry-run                    Stats only, no file output
  `)
  process.exit(0)
}

const inputFile = args[0]
const outputName = args[1]

function getArg(flag) {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null
}
function hasFlag(flag) { return args.includes(flag) }

const title = getArg('--title')
const author = getArg('--author')
const maxChapters = parseInt(getArg('--chapters') || '3', 10)
const customPattern = getArg('--chapter-pattern')
const difficultyOverride = getArg('--difficulty')
const exportName = getArg('--export')
const maxParaWords = parseInt(getArg('--max-para-words') || '150', 10)
const minParaWords = parseInt(getArg('--min-para-words') || '4', 10)
const dryRun = hasFlag('--dry-run')

if (!title || !author) {
  console.error('Error: --title and --author are required')
  process.exit(1)
}

if (!fs.existsSync(inputFile)) {
  console.error(`Error: Input file not found: ${inputFile}`)
  process.exit(1)
}

// ── Accent normalization map ────────────────────────────────────
const ACCENT_MAP = {
  '\u00C0': 'A', '\u00C1': 'A', '\u00C2': 'A', '\u00C3': 'A', '\u00C4': 'A', '\u00C5': 'A',
  '\u00C6': 'Ae', '\u00C7': 'C', '\u00C8': 'E', '\u00C9': 'E', '\u00CA': 'E', '\u00CB': 'E',
  '\u00CC': 'I', '\u00CD': 'I', '\u00CE': 'I', '\u00CF': 'I', '\u00D0': 'D', '\u00D1': 'N',
  '\u00D2': 'O', '\u00D3': 'O', '\u00D4': 'O', '\u00D5': 'O', '\u00D6': 'O', '\u00D8': 'O',
  '\u00D9': 'U', '\u00DA': 'U', '\u00DB': 'U', '\u00DC': 'U', '\u00DD': 'Y',
  '\u00E0': 'a', '\u00E1': 'a', '\u00E2': 'a', '\u00E3': 'a', '\u00E4': 'a', '\u00E5': 'a',
  '\u00E6': 'ae', '\u00E7': 'c', '\u00E8': 'e', '\u00E9': 'e', '\u00EA': 'e', '\u00EB': 'e',
  '\u00EC': 'i', '\u00ED': 'i', '\u00EE': 'i', '\u00EF': 'i', '\u00F1': 'n',
  '\u00F2': 'o', '\u00F3': 'o', '\u00F4': 'o', '\u00F5': 'o', '\u00F6': 'o', '\u00F8': 'o',
  '\u00F9': 'u', '\u00FA': 'u', '\u00FB': 'u', '\u00FC': 'u', '\u00FD': 'y', '\u00FF': 'y',
}

function normalizeAccents(str) {
  return str.replace(/[\u00C0-\u00FF]/g, ch => ACCENT_MAP[ch] || ch)
}

// ── Chapter detection patterns (tried in order) ─────────────────
const CHAPTER_PATTERNS = [
  /^CHAPTER [IVXLCDM]+$/,
  /^CHAPTER [IVXLCDM]+\./,
  /^CHAPTER [IVXLCDM]+\s*[-—]/,
  /^Chapter [IVXLCDM]+$/,
  /^Chapter [IVXLCDM]+\./,
  /^Chapter [IVXLCDM]+\s*[-—]/,
  /^CHAPTER \d+$/,
  /^CHAPTER \d+\./,
  /^Chapter \d+$/,
  /^Chapter \d+\./,
  /^[IVXLCDM]+$/,             // Roman numeral on its own line
  /^\d+$/,                     // Just a number on its own line
]

// ── Read file ───────────────────────────────────────────────────
let raw = fs.readFileSync(inputFile, 'utf-8')

// Strip BOM
raw = raw.replace(/^\uFEFF/, '')

// Normalize line endings
raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

// Strip Gutenberg header (everything before *** START OF)
const startMarker = raw.indexOf('*** START OF')
if (startMarker >= 0) {
  const afterMarker = raw.indexOf('\n', startMarker)
  if (afterMarker >= 0) raw = raw.substring(afterMarker + 1)
}

// Strip Gutenberg footer (everything after *** END OF)
const endMarker = raw.indexOf('*** END OF')
if (endMarker >= 0) {
  raw = raw.substring(0, endMarker)
}

const lines = raw.split('\n')

// ── Detect chapters ─────────────────────────────────────────────
let pattern = customPattern ? new RegExp(customPattern) : null
if (!pattern) {
  for (const p of CHAPTER_PATTERNS) {
    const matches = lines.filter(l => p.test(l.trim()))
    if (matches.length >= maxChapters) {
      pattern = p
      break
    }
  }
}

if (!pattern) {
  console.error('Error: Could not detect chapter boundaries. Use --chapter-pattern to specify a regex.')
  console.error('Sample lines from file:')
  lines.slice(0, 80).forEach((l, i) => { if (l.trim()) console.error(`  ${i}: ${l.trim().substring(0, 80)}`) })
  process.exit(1)
}

// Find chapter start lines — skip TOC entries (clustered chapter markers with <10 lines between)
const allMatches = []
for (let i = 0; i < lines.length; i++) {
  if (pattern.test(lines[i].trim())) allMatches.push(i)
}

const chapterStarts = []
for (let i = 0; i < allMatches.length; i++) {
  const next = i + 1 < allMatches.length ? allMatches[i + 1] : lines.length
  const gap = next - allMatches[i]
  if (gap > 10) chapterStarts.push(allMatches[i])
}

if (chapterStarts.length === 0) {
  console.error('Error: No valid chapters found after filtering TOC entries.')
  process.exit(1)
}

if (chapterStarts.length < maxChapters) {
  console.error(`Warning: Found only ${chapterStarts.length} chapters (requested ${maxChapters})`)
}

// Add end marker
chapterStarts.push(lines.length)

console.log(`Detected ${chapterStarts.length - 1} chapters using pattern: ${pattern}`)
console.log(`Extracting first ${Math.min(maxChapters, chapterStarts.length - 1)} chapters\n`)

// ── Scene break detection ───────────────────────────────────────
function isSceneBreak(text) {
  const t = text.trim()
  // Lines that are just decorative separators
  if (/^[\s*\-_=~.•·]+$/.test(t)) return true
  if (/^\*\s*\*\s*\*/.test(t)) return true
  if (/^-{3,}$/.test(t)) return true
  return false
}

// ── Text cleaning ───────────────────────────────────────────────
function cleanText(text) {
  // Join wrapped lines
  let t = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return ''

  // Skip scene breaks
  if (isSceneBreak(t)) return ''

  // Skip ALL-CAPS short lines (subtitles, section headers)
  if (t === t.toUpperCase() && t.split(' ').length < 10 && t.length < 60) return ''

  // Strip Gutenberg italic/bold markers: _word_ and *word*
  t = t.replace(/_([^_]+)_/g, '$1')
  t = t.replace(/\*([^*]+)\*/g, '$1')
  // Also strip standalone _ and * that didn't match pairs
  t = t.replace(/[_*]/g, '')

  // Normalize accented characters (é→e, ñ→n, etc.)
  t = normalizeAccents(t)

  // Normalize curly/smart quotes to straight equivalents
  t = t.replace(/[\u2018\u2019\u201B]/g, "'")  // single curly → straight apostrophe
  t = t.replace(/[\u201A]/g, ",")               // low single quote → comma
  t = t.replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // double curly → straight quote

  // Normalize ellipsis character
  t = t.replace(/\u2026/g, '...')

  // Normalize dashes — em/en dashes become " -- "
  t = t.replace(/[\u2013\u2014\u2015]/g, ' -- ')
  // Hyphens within words stay (e.g. well-known), standalone hyphens become spaces
  t = t.replace(/ - /g, ' -- ')

  // Strip characters that aren't letters, numbers, spaces, or common punctuation
  t = t.replace(/[^a-zA-Z0-9 .,;:!?'"()\-]/g, '')

  // Fix camelCase fusions (from stripped punctuation between sentences)
  t = t.replace(/([a-z])([A-Z])/g, '$1 $2')

  // Fix number-letter fusions (e.g. "1815M" → "1815 M")
  t = t.replace(/(\d)([A-Za-z])/g, '$1 $2')
  t = t.replace(/([A-Za-z])(\d)/g, '$1 $2')

  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim()

  return t
}

// ── Split long paragraphs at sentence boundaries ───────────────
function splitLongParagraph(text, maxWords) {
  const words = text.split(' ')
  if (words.length <= maxWords) return [text]

  const chunks = []
  let current = []

  for (const word of words) {
    current.push(word)
    const atSentenceEnd = /[.!?;]"?'?$/.test(word)
    // Try to split near the limit at a sentence boundary
    if (current.length >= maxWords * 0.7 && atSentenceEnd) {
      chunks.push(current.join(' '))
      current = []
    } else if (current.length > maxWords) {
      // Over limit — force split
      chunks.push(current.join(' '))
      current = []
    }
  }

  if (current.length > 0) {
    // If remainder is very short, merge with previous chunk
    if (chunks.length > 0 && current.length < minParaWords) {
      chunks[chunks.length - 1] += ' ' + current.join(' ')
    } else {
      chunks.push(current.join(' '))
    }
  }

  return chunks
}

// ── Process chapters ────────────────────────────────────────────
const chapters = []
const numToExtract = Math.min(maxChapters, chapterStarts.length - 1)

for (let c = 0; c < numToExtract; c++) {
  const start = chapterStarts[c]
  const end = chapterStarts[c + 1]
  const chunk = lines.slice(start + 1, end).join('\n')

  // Split into paragraphs by double newline
  const rawParas = chunk.split(/\n\n+/)
  const processed = []

  for (const rp of rawParas) {
    const cleaned = cleanText(rp)
    if (!cleaned) continue
    if (cleaned.split(' ').length < minParaWords) continue

    // Split overly long paragraphs for better gameplay
    const splits = splitLongParagraph(cleaned, maxParaWords)
    for (const s of splits) {
      if (s.split(' ').length >= minParaWords) {
        processed.push(s)
      }
    }
  }

  // Merge consecutive short paragraphs so dialogue-heavy sections
  // don't create tiny brick groups that instantly break off
  const MIN_MERGE_WORDS = 25
  const merged = []
  let buffer = ''
  for (const p of processed) {
    if (buffer) buffer += ' ' + p
    else buffer = p
    if (buffer.split(' ').length >= MIN_MERGE_WORDS) {
      merged.push(buffer)
      buffer = ''
    }
  }
  if (buffer) {
    if (merged.length > 0 && buffer.split(' ').length < MIN_MERGE_WORDS) {
      merged[merged.length - 1] += ' ' + buffer
    } else {
      merged.push(buffer)
    }
  }

  chapters.push({
    title: `Chapter ${c + 1}`,
    paragraphs: merged,
  })
}

// ── Validation warnings ─────────────────────────────────────────
let warnings = 0
for (const ch of chapters) {
  if (ch.paragraphs.length === 0) {
    console.error(`  WARNING: ${ch.title} has 0 paragraphs — check chapter detection`)
    warnings++
  }
  for (let i = 0; i < ch.paragraphs.length; i++) {
    const p = ch.paragraphs[i]
    // Check for suspicious content
    if (/\d{4,}/.test(p) && p.split(' ').length < 8) {
      console.error(`  WARNING: ${ch.title} para ${i} looks like metadata: "${p.substring(0, 60)}"`)
      warnings++
    }
    // Check for remaining fused long words (>20 chars, all lowercase)
    const longWords = p.match(/\b[a-z]{20,}\b/g)
    if (longWords) {
      console.error(`  WARNING: ${ch.title} para ${i} has suspiciously long word: "${longWords[0]}"`)
      warnings++
    }
  }
}

// ── Auto-classify difficulty ────────────────────────────────────
function classifyDifficulty(chapters) {
  let totalWords = 0
  let totalParas = 0
  let maxParaWordCount = 0

  for (const ch of chapters) {
    totalParas += ch.paragraphs.length
    for (const p of ch.paragraphs) {
      const wc = p.split(' ').length
      totalWords += wc
      if (wc > maxParaWordCount) maxParaWordCount = wc
    }
  }

  const avgWordsPerPara = totalParas > 0 ? totalWords / totalParas : 0
  const avgParasPerChapter = chapters.length > 0 ? totalParas / chapters.length : 0

  // Scoring: higher = harder
  let score = 0
  if (avgWordsPerPara > 100) score += 3
  else if (avgWordsPerPara > 70) score += 2
  else if (avgWordsPerPara > 50) score += 1

  if (avgParasPerChapter > 80) score += 2
  else if (avgParasPerChapter > 40) score += 1

  if (maxParaWordCount > 400) score += 2
  else if (maxParaWordCount > 200) score += 1

  if (totalWords > 10000) score += 1

  if (score >= 7) return 'Very Hard'
  if (score >= 5) return 'Hard'
  if (score >= 3) return 'Medium'
  return 'Easy'
}

const difficulty = difficultyOverride
  ? { easy: 'Easy', medium: 'Medium', hard: 'Hard', 'very-hard': 'Very Hard' }[difficultyOverride] || difficultyOverride
  : classifyDifficulty(chapters)

// ── Print stats ─────────────────────────────────────────────────
let totalWords = 0, totalParas = 0, longestPara = 0
for (const ch of chapters) {
  totalParas += ch.paragraphs.length
  for (const p of ch.paragraphs) {
    const wc = p.split(' ').length
    totalWords += wc
    if (wc > longestPara) longestPara = wc
  }
}

console.log(`── ${title} by ${author} ──`)
console.log(`  Chapters:           ${chapters.length}`)
console.log(`  Total paragraphs:   ${totalParas}`)
console.log(`  Avg paras/chapter:  ${(totalParas / chapters.length).toFixed(1)}`)
console.log(`  Total words:        ${totalWords}`)
console.log(`  Avg words/para:     ${totalParas > 0 ? (totalWords / totalParas).toFixed(1) : 'N/A'}`)
console.log(`  Longest paragraph:  ${longestPara} words`)
console.log(`  Difficulty:         ${difficulty}`)
if (warnings > 0) console.log(`  Warnings:           ${warnings}`)
console.log()

for (let i = 0; i < chapters.length; i++) {
  const ch = chapters[i]
  const words = ch.paragraphs.reduce((s, p) => s + p.split(' ').length, 0)
  console.log(`  ${ch.title}: ${ch.paragraphs.length} paragraphs, ${words} words`)
}

if (dryRun) {
  console.log('\n(dry run — no file written)')
  process.exit(0)
}

// ── Generate TypeScript ─────────────────────────────────────────
const constName = exportName || title
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_|_$/g, '')

let output = `export const ${constName} = {\n`
output += `  title: '${title.replace(/'/g, "\\'")}',\n`
output += `  author: '${author.replace(/'/g, "\\'")}',\n`
output += `  chapters: [\n`

for (const ch of chapters) {
  output += `    {\n`
  output += `      title: '${ch.title}',\n`
  output += `      paragraphs: [\n`
  for (const p of ch.paragraphs) {
    output += `        '${p.replace(/'/g, "\\'")}',\n`
  }
  output += `      ],\n`
  output += `    },\n`
}

output += `  ],\n`
output += `}\n`

const outPath = path.join('src', 'books', `${outputName}.ts`)
fs.writeFileSync(outPath, output)
console.log(`\nWritten: ${outPath}`)
console.log(`\nTo register, add to src/content.ts:`)
console.log(`  import { ${constName} } from './books/${outputName}'`)
console.log(`  { ...${constName}, difficulty: '${difficulty}' },`)
