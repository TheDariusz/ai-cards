import { describe, expect, it } from 'vitest'
import { dict } from '../app/lib/i18n'

const pl = dict.pl
const en = dict.en

describe('pl plurals', () => {
  const ns = [1, 2, 5, 12, 22, 25]
  const table: [string, (n: number) => string, string[]][] = [
    ['review.left', pl.review.left, ['została 1', 'zostały 2', 'zostało 5', 'zostało 12', 'zostały 22', 'zostało 25']],
    ['streak.inARow', pl.streak.inARow, ['dzień z rzędu', 'dni z rzędu', 'dni z rzędu', 'dni z rzędu', 'dni z rzędu', 'dni z rzędu']],
    ['home.newWords', pl.home.newWords, ['1 nowe słowo', '2 nowe słowa', '5 nowych słów', '12 nowych słów', '22 nowe słowa', '25 nowych słów']],
    ['home.doneReviewed', pl.home.doneReviewed, ['1 powtórzona karta', '2 powtórzone karty', '5 powtórzonych kart', '12 powtórzonych kart', '22 powtórzone karty', '25 powtórzonych kart'].map((s) => `${s}. Kolejne wrócą jutro.`)],
    ['landing.factCredits', (n) => pl.landing.factCredits(n)[0], ['1 darmowy kredyt', '2 darmowe kredyty', '5 darmowych kredytów', '12 darmowych kredytów', '22 darmowe kredyty', '25 darmowych kredytów']],
    ['landing.factDaily', (n) => pl.landing.factDaily(n)[0], ['1 nowa karta', '2 nowe karty', '5 nowych kart', '12 nowych kart', '22 nowe karty', '25 nowych kart']],
    ['home.wordTooLong', pl.home.wordTooLong, ['Słowo może mieć najwyżej 1 znak', 'Słowo może mieć najwyżej 2 znaki', 'Słowo może mieć najwyżej 5 znaków', 'Słowo może mieć najwyżej 12 znaków', 'Słowo może mieć najwyżej 22 znaki', 'Słowo może mieć najwyżej 25 znaków']],
  ]
  for (const [name, fn, expected] of table) {
    it(name, () => expect(ns.map(fn)).toEqual(expected))
  }
})

describe('en', () => {
  it('review.left', () => {
    expect([1, 2].map(en.review.left)).toEqual(['1 left', '2 left'])
  })
  it('newWords', () => {
    expect([1, 2].map(en.home.newWords)).toEqual(['1 new word', '2 new words'])
  })
})
