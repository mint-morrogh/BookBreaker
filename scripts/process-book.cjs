#!/usr/bin/env node
/**
 * BookBreaker — Book Processing Pipeline
 *
 * Converts raw text files into game-ready TypeScript book modules.
 * Handles chapter detection, paragraph splitting, punctuation stripping,
 * fused-word fixing, and auto-difficulty classification.
 *
 * Usage:
 *   node scripts/process-book.js <input.txt> <output-name> [options]
 *
 * Options:
 *   --title "Book Title"         Book title (required)
 *   --author "Author Name"       Author name (required)
 *   --export CONST_NAME          TypeScript export const name (auto-generated from title if omitted)
 *   --chapters 3                 Number of chapters to extract (default: 3)
 *   --chapter-pattern "regex"    Custom regex for chapter detection
 *   --difficulty easy|medium|hard|very-hard   Override auto-detection
 *   --dry-run                    Print stats without writing file
 *
 * Examples:
 *   node scripts/process-book.js input.txt wizard-of-oz --title "The Wonderful Wizard of Oz" --author "L. Frank Baum"
 *   node scripts/process-book.js moby.txt moby-dick --title "Moby Dick" --author "Herman Melville" --chapters 5
 */

const fs = require('fs')
const path = require('path')

// ── Argument parsing ────────────────────────────────────────────
const args = process.argv.slice(2)
if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
BookBreaker Book Processing Pipeline

Usage: node scripts/process-book.js <input.txt> <output-name> [options]

Options:
  --title "Book Title"         Book title (required)
  --author "Author Name"       Author name (required)
  --export CONST_NAME          TS export name (auto from title)
  --chapters N                 Chapters to extract (default: 3)
  --chapter-pattern "regex"    Custom chapter regex
  --difficulty LEVEL           Override: easy, medium, hard, very-hard
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
const dryRun = hasFlag('--dry-run')

if (!title || !author) {
  console.error('Error: --title and --author are required')
  process.exit(1)
}

if (!fs.existsSync(inputFile)) {
  console.error(`Error: Input file not found: ${inputFile}`)
  process.exit(1)
}

// ── Chapter detection patterns (tried in order) ─────────────────
const CHAPTER_PATTERNS = [
  /^CHAPTER [IVX]+$/,
  /^CHAPTER [IVX]+\./,
  /^Chapter [IVX]+$/,
  /^Chapter [IVX]+\./,
  /^Chapter \d+$/,
  /^CHAPTER \d+$/,
  /^[IVX]+$/,               // Roman numeral on its own line
  /^\d+$/,                   // Just a number on its own line
]

// ── Read and detect chapters ────────────────────────────────────
const raw = fs.readFileSync(inputFile, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
const lines = raw.split('\n')

// Find the pattern that matches
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
  lines.slice(0, 50).forEach((l, i) => { if (l.trim()) console.error(`  ${i}: ${l.trim().substring(0, 80)}`) })
  process.exit(1)
}

// Find chapter start lines — skip TOC entries (clustered chapter markers with <10 lines between)
const allMatches = []
for (let i = 0; i < lines.length; i++) {
  if (pattern.test(lines[i].trim())) allMatches.push(i)
}

// Filter: keep only matches with substantial content after them (>10 lines to next match)
const chapterStarts = []
for (let i = 0; i < allMatches.length; i++) {
  const next = i + 1 < allMatches.length ? allMatches[i + 1] : lines.length
  const gap = next - allMatches[i]
  if (gap > 10) chapterStarts.push(allMatches[i])
}

if (chapterStarts.length < maxChapters) {
  console.error(`Warning: Found only ${chapterStarts.length} chapters (requested ${maxChapters})`)
}

// Add end marker
chapterStarts.push(lines.length)

console.log(`Detected ${chapterStarts.length - 1} chapters using pattern: ${pattern}`)
console.log(`Extracting first ${Math.min(maxChapters, chapterStarts.length - 1)} chapters\n`)

// ── Process paragraphs ──────────────────────────────────────────
function cleanText(text) {
  // Join wrapped lines
  let t = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return ''

  // Replace hyphens, dashes, and similar with spaces BEFORE stripping
  t = t.replace(/[-\u2010\u2011\u2012\u2013\u2014\u2015]/g, ' ')

  // Strip all remaining punctuation (keep letters, numbers, spaces)
  t = t.replace(/[^a-zA-Z0-9 ]/g, '')

  // Fix camelCase fusions (from stripped punctuation between sentences)
  t = t.replace(/([a-z])([A-Z])/g, '$1 $2')

  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim()

  return t
}

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
    // Skip very short paragraphs (titles, etc.)
    if (cleaned.split(' ').length < 4) continue
    processed.push(cleaned)
  }

  chapters.push({
    title: `Chapter ${c + 1}`,
    paragraphs: processed,
  })
}

// ── Auto-classify difficulty ────────────────────────────────────
function classifyDifficulty(chapters) {
  let totalWords = 0
  let totalParas = 0
  let maxParaWords = 0

  for (const ch of chapters) {
    totalParas += ch.paragraphs.length
    for (const p of ch.paragraphs) {
      const wc = p.split(' ').length
      totalWords += wc
      if (wc > maxParaWords) maxParaWords = wc
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

  if (maxParaWords > 400) score += 2
  else if (maxParaWords > 200) score += 1

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
let totalWords = 0, totalParas = 0, maxParaWords = 0
for (const ch of chapters) {
  totalParas += ch.paragraphs.length
  for (const p of ch.paragraphs) {
    const wc = p.split(' ').length
    totalWords += wc
    if (wc > maxParaWords) maxParaWords = wc
  }
}

console.log(`── ${title} by ${author} ──`)
console.log(`  Chapters:           ${chapters.length}`)
console.log(`  Total paragraphs:   ${totalParas}`)
console.log(`  Avg paras/chapter:  ${(totalParas / chapters.length).toFixed(1)}`)
console.log(`  Total words:        ${totalWords}`)
console.log(`  Avg words/para:     ${(totalWords / totalParas).toFixed(1)}`)
console.log(`  Longest paragraph:  ${maxParaWords} words`)
console.log(`  Difficulty:         ${difficulty}`)
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
