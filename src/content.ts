import { TALE_OF_TWO_CITIES } from './books/tale-of-two-cities'
import { MOBY_DICK } from './books/moby-dick'
import { PRIDE_AND_PREJUDICE } from './books/pride-and-prejudice'
import { ALICE_IN_WONDERLAND } from './books/alice-in-wonderland'
import { GREAT_GATSBY } from './books/great-gatsby'
import { WIZARD_OF_OZ } from './books/wizard-of-oz'
import { PETER_PAN } from './books/peter-pan'
import { TOM_SAWYER } from './books/tom-sawyer'
import { FRANKENSTEIN } from './books/frankenstein'
import { DRACULA } from './books/dracula'
import { TREASURE_ISLAND } from './books/treasure-island'
import { DORIAN_GRAY } from './books/dorian-gray'
import { JANE_EYRE } from './books/jane-eyre'
import { WUTHERING_HEIGHTS } from './books/wuthering-heights'
import { CRIME_AND_PUNISHMENT } from './books/crime-and-punishment'
import { LES_MISERABLES } from './books/les-miserables'
import { WAR_AND_PEACE } from './books/war-and-peace'

export interface Chapter {
  title: string
  paragraphs: string[]
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Very Hard'

export interface Book {
  title: string
  author: string
  difficulty: Difficulty
  chapters: Chapter[]
}

export const BOOKS: Book[] = [
  { ...PRIDE_AND_PREJUDICE, difficulty: 'Easy' },
  { ...ALICE_IN_WONDERLAND, difficulty: 'Easy' },
  { ...WIZARD_OF_OZ, difficulty: 'Easy' },
  { ...PETER_PAN, difficulty: 'Easy' },
  { ...TOM_SAWYER, difficulty: 'Easy' },
  { ...TALE_OF_TWO_CITIES, difficulty: 'Medium' },
  { ...FRANKENSTEIN, difficulty: 'Medium' },
  { ...DRACULA, difficulty: 'Medium' },
  { ...TREASURE_ISLAND, difficulty: 'Medium' },
  { ...DORIAN_GRAY, difficulty: 'Medium' },
  { ...GREAT_GATSBY, difficulty: 'Medium' },
  { ...MOBY_DICK, difficulty: 'Hard' },
  { ...JANE_EYRE, difficulty: 'Hard' },
  { ...WUTHERING_HEIGHTS, difficulty: 'Hard' },
  { ...CRIME_AND_PUNISHMENT, difficulty: 'Hard' },
  { ...LES_MISERABLES, difficulty: 'Very Hard' },
  { ...WAR_AND_PEACE, difficulty: 'Very Hard' },
]
