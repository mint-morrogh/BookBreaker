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

/**
 * Process all chapters of a book and build a word → tag lookup.
 * Returns a Map where keys are lowercased words.
 */
export function tagBook(chapters: { title: string; paragraphs: string[] }[]): Map<string, WordTag> {
  const tagMap = new Map<string, WordTag>()
  const fullText = chapters.flatMap(ch => ch.paragraphs).join(' ')
  const doc = nlp(fullText)

  // Extract people and place names first (most specific)
  const people = new Set<string>()
  for (const phrase of doc.people().out('array') as string[]) {
    for (const w of phrase.toLowerCase().split(/\s+/)) {
      if (w.length > 2) people.add(w)
    }
  }

  const places = new Set<string>()
  for (const phrase of doc.places().out('array') as string[]) {
    for (const w of phrase.toLowerCase().split(/\s+/)) {
      if (w.length > 2) places.add(w)
    }
  }

  // Process every term via the json() structure
  const sentences = doc.json() as any[]
  for (const sentence of sentences) {
    for (const term of sentence.terms) {
      const word = (term.normal || term.text || '').toLowerCase().replace(/[^a-z]/g, '')
      if (!word || tagMap.has(word)) continue

      const tags: string[] = term.tags ?? []

      // Stopwords
      if (word.length <= 3 || STOP_WORDS.has(word)) {
        tagMap.set(word, 'stopword')
        continue
      }

      // Big words — epic tier
      if (word.length >= 10) {
        tagMap.set(word, 'big')
        continue
      }

      // People (characters, names)
      if (people.has(word) || (tags.includes('Person') && !STOP_WORDS.has(word))) {
        tagMap.set(word, 'person')
        continue
      }

      // Places
      if (places.has(word) || tags.includes('Place')) {
        tagMap.set(word, 'place')
        continue
      }

      // Function-word tags that compromise uses instead of standard POS
      const isFunction = tags.some(t =>
        t === 'Negative' || t === 'QuestionWord' || t === 'Conjunction' ||
        t === 'Preposition' || t === 'Determiner' || t === 'Expression' ||
        t === 'Pronoun'
      )
      if (isFunction) {
        tagMap.set(word, 'stopword')
        continue
      }

      // Date/duration words — treat as stopwords (ago, years-as-duration, etc.)
      if (tags.includes('Date') && !tags.includes('Noun')) {
        tagMap.set(word, 'stopword')
        continue
      }

      // POS classification
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

  return tagMap
}
