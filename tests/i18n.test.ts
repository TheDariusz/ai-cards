import { describe, expect, it } from 'vitest'
import { dict } from '../app/lib/i18n'

const pl = dict.pl
const en = dict.en

describe('pl plurals', () => {
  const ns = [1, 2, 5, 12, 22, 25]
  const table: [string, (n: number) => string, string[]][] = [
    ['review.left', pl.review.left, ['została 1', 'zostały 2', 'zostało 5', 'zostało 12', 'zostały 22', 'zostało 25']],
    ['home.dayStreak', pl.home.dayStreak, ['dzień z rzędu', 'dni z rzędu', 'dni z rzędu', 'dni z rzędu', 'dni z rzędu', 'dni z rzędu']],
    ['home.dueToday', pl.home.dueToday, ['karta na dziś', 'karty na dziś', 'kart na dziś', 'kart na dziś', 'karty na dziś', 'kart na dziś']],
    ['home.newToLearn', pl.home.newToLearn, ['1 nowa karta do nauki', '2 nowe karty do nauki', '5 nowych kart do nauki', '12 nowych kart do nauki', '22 nowe karty do nauki', '25 nowych kart do nauki']],
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
  it('newToLearn', () => {
    expect([1, 2].map(en.home.newToLearn)).toEqual(['1 New to learn', '2 New to learn'])
  })
})
