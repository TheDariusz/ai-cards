type PluralForm = 'one' | 'few' | 'many'

export function plForm(n: number): PluralForm {
  if (n === 1) return 'one'
  const last = n % 10
  const lastTwo = n % 100
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'few' : 'many'
}

export function pluralKarty(n: number): 'karta' | 'karty' | 'kart' {
  return ({ one: 'karta', few: 'karty', many: 'kart' } as const)[plForm(n)]
}

export function pluralNowa(n: number): 'nowa' | 'nowe' | 'nowych' {
  return ({ one: 'nowa', few: 'nowe', many: 'nowych' } as const)[plForm(n)]
}
