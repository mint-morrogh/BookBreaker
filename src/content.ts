import { TALE_OF_TWO_CITIES } from './books/tale-of-two-cities'
import { MOBY_DICK } from './books/moby-dick'
import { PRIDE_AND_PREJUDICE } from './books/pride-and-prejudice'
import { ALICE_IN_WONDERLAND } from './books/alice-in-wonderland'
import { GREAT_GATSBY } from './books/great-gatsby'

export interface Chapter {
  title: string
  paragraphs: string[]
}

export interface Book {
  title: string
  author: string
  chapters: Chapter[]
}

export const BOOKS: Book[] = [
  TALE_OF_TWO_CITIES,
  MOBY_DICK,
  PRIDE_AND_PREJUDICE,
  ALICE_IN_WONDERLAND,
  GREAT_GATSBY,
]
