import nlp from 'compromise'

export type WordTag = 'stopword' | 'noun' | 'verb' | 'adjective' | 'adverb' | 'person' | 'place' | 'big'

const STOP_WORDS = new Set([
  'the','a','an','of','in','to','for','and','but','or','nor','so','is','am',
  'are','was','were','be','been','being','it','its','at','by','on','with',
  'as','if','no','not','do','did','has','had','have','he','she','we','they',
  'me','my','his','her','our','you','your','us','up','out','all','this',
  'that','from','than','then','them','what','who','how','when','where',
  'some','ago','very','also','just','only','about','more','most','much',
  'such','each','even','here','there','into','over','upon','which','while',
  'never','ever','yet','still','would','could','should','shall','will',
  'might','must','may','can','cannot','does','done','got','get','goes',
])

/** Yield to the browser so the UI can repaint */
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Process all chapters of a book and build a word → tag lookup.
 * Processes chapter-by-chapter, yielding between each so the loading bar updates.
 * Calls onProgress(0–1) between chunks.
 */
export async function tagBook(
  chapters: { title: string; paragraphs: string[] }[],
  onProgress?: (ratio: number) => void,
): Promise<Map<string, WordTag>> {
  const tagMap = new Map<string, WordTag>()
  const allPeople = new Set<string>()
  const allPlaces = new Set<string>()

  const total = chapters.length

  for (let ci = 0; ci < total; ci++) {
    const chapter = chapters[ci]
    const chapterText = chapter.paragraphs.join(' ')
    const doc = nlp(chapterText)

    // Extract people and place names
    for (const phrase of doc.people().out('array') as string[]) {
      for (const w of phrase.toLowerCase().split(/\s+/)) {
        if (w.length > 2) allPeople.add(w)
      }
    }
    for (const phrase of doc.places().out('array') as string[]) {
      for (const w of phrase.toLowerCase().split(/\s+/)) {
        if (w.length > 2) allPlaces.add(w)
      }
    }

    // Process every term
    const sentences = doc.json() as any[]
    for (const sentence of sentences) {
      for (const term of sentence.terms) {
        const word = (term.normal || term.text || '').toLowerCase().replace(/[^a-z]/g, '')
        if (!word || tagMap.has(word)) continue

        const tags: string[] = term.tags ?? []

        if (word.length <= 3 || STOP_WORDS.has(word)) {
          tagMap.set(word, 'stopword'); continue
        }
        if (word.length >= 10) {
          tagMap.set(word, 'big'); continue
        }
        if (allPeople.has(word) || (tags.includes('Person') && !STOP_WORDS.has(word))) {
          tagMap.set(word, 'person'); continue
        }
        if (allPlaces.has(word) || tags.includes('Place')) {
          tagMap.set(word, 'place'); continue
        }
        const isFunction = tags.some(t =>
          t === 'Negative' || t === 'QuestionWord' || t === 'Conjunction' ||
          t === 'Preposition' || t === 'Determiner' || t === 'Expression' ||
          t === 'Pronoun'
        )
        if (isFunction) {
          tagMap.set(word, 'stopword'); continue
        }
        if (tags.includes('Date') && !tags.includes('Noun')) {
          tagMap.set(word, 'stopword'); continue
        }
        if (tags.includes('Adjective')) {
          tagMap.set(word, 'adjective')
        } else if (tags.includes('Adverb')) {
          tagMap.set(word, 'adverb')
        } else if (tags.includes('Verb')) {
          tagMap.set(word, 'verb')
        } else {
          tagMap.set(word, 'noun')
        }
      }
    }

    // Report progress and yield to let the UI repaint
    onProgress?.((ci + 1) / total)
    await yieldToUI()
  }

  return tagMap
}
