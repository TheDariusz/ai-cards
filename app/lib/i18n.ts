import { useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../root'
import type { Locale } from './locale'
import { plForm, pluralKarty, pluralNowa } from './reminder'

const kredyty = (n: number) => ({ one: '1 darmowy kredyt', few: `${n} darmowe kredyty`, many: `${n} darmowych kredytów` })[plForm(n)]

// [bold part, rest] pairs render as <b>{bold}</b>{rest}
const pl = {
  common: {
    language: 'Język',
  },
  landing: {
    logIn: 'Zaloguj się',
    title: 'Trzy dni od usłyszanego słowa do słowa, które naprawdę znasz.',
    pitch: 'Fiszki z angielskiego dla Polaków. Wpisujesz słowo, AI tworzy fiszkę, a powtórki rozłożone w czasie decydują, kiedy znów ją zobaczysz.',
    startFree: 'Zacznij za darmo',
    howItWorks: 'Jak to działa',
    day0: 'Dzień 0',
    day0Title: 'Wpisz słowo',
    day0Body: 'Zajmuje to trzy sekundy, w chwili, gdy je usłyszysz. Moment później fiszka jest gotowa: polskie znaczenie, proste wyjaśnienie, łatwe przykładowe zdanie z tłumaczeniem i nagranie.',
    day1: 'Dzień 1',
    day1Title: 'Naucz się go raz',
    day1Body: 'Czytasz rozbiór zdania słowo po słowie, powtarzasz na głos za nagraniem i potwierdzasz, że rozumiesz zdanie, zanim trafi do powtórek.',
    day2: 'Od dnia 2',
    day2Title: 'Powtarzaj',
    day2Body: 'Piszesz zdanie na podstawie polskiej wersji. AI sprawdza znaczenie, gramatykę i naturalność, wyjaśnia wszystko po polsku i proponuje ocenę, którą możesz zmienić.',
    demoAdd: 'Dodaj',
    demoGenerating: 'Generuję:',
    demoNew: '(3 nowe)',
    demoStep: 'Krok 1 z 4 · Rozbiór',
    demoDecodeHint: 'Czytaj od lewej do prawej. Polska wersja jest celowo dosłowna.',
    demoNaturalPolish: 'Naturalnie po polsku:',
    demoSeeStructure: 'Rozumiem budowę zdania',
    demoReview: 'Powtórka',
    demoLeft: 'zostały 4',
    demoAlternative: 'Inna poprawna wersja',
    demoSuggested: 'sugestia:',
    demoAgain: 'Jeszcze raz',
    demoGood: 'Dobrze',
    demoEasy: 'Łatwe',
    factEmail: ['Link w mailu', ', bez hasła'] as [string, string],
    factCredits: (n: number): [string, string] => [kredyty(n), ' na start'],
    factDaily: (n: number): [string, string] => [`${n} ${pluralNowa(n)} ${pluralKarty(n)}`, ' dziennie'],
    factExport: ['Eksport', ' do Anki w każdej chwili'] as [string, string],
    closing: 'Zacznij od następnego słowa, które usłyszysz.',
    footer: 'AI Cards · Fiszki z angielskiego dla Polaków',
  },
}

export type Dict = typeof pl

const en: Dict = {
  common: {
    language: 'Language',
  },
  landing: {
    logIn: 'Log in',
    title: 'Three days from a word you heard to a word you own.',
    pitch: 'English flashcards for Polish speakers. You type the word, AI writes the card, spaced repetition decides when you see it again.',
    startFree: 'Start free',
    howItWorks: 'How it works',
    day0: 'Day 0',
    day0Title: 'Type the word',
    day0Body: 'It takes three seconds, right when you hear it. A moment later the card is ready: the Polish meaning, a plain explanation, a simple example sentence with its translation, and audio.',
    day1: 'Day 1',
    day1Title: 'Learn it once',
    day1Body: 'You read a word-by-word decode, shadow the audio, and confirm you follow the sentence before it joins your reviews.',
    day2: 'Day 2 onward',
    day2Title: 'Review it',
    day2Body: 'Write the sentence from the Polish. AI checks meaning, grammar and naturalness, explains in Polish, and suggests a grade you can override.',
    demoAdd: 'Add',
    demoGenerating: 'Generating:',
    demoNew: '(3 new)',
    demoStep: 'Step 1 of 4 · Decode',
    demoDecodeHint: 'Read from left to right. The Polish line stays deliberately literal.',
    demoNaturalPolish: 'Natural Polish:',
    demoSeeStructure: 'I see the structure',
    demoReview: 'Review',
    demoLeft: '4 left',
    demoAlternative: 'Another correct version',
    demoSuggested: 'suggested:',
    demoAgain: 'Again',
    demoGood: 'Good',
    demoEasy: 'Easy',
    factEmail: ['Email link', ', no password'],
    factCredits: (n) => [`${n} free credits`, ' to start'],
    factDaily: (n) => [`${n} new cards`, ' a day'],
    factExport: ['Export', ' to Anki any time'],
    closing: 'Start with the next word you hear.',
    footer: 'AI Cards · English flashcards for Polish speakers',
  },
}

export const dict: Record<Locale, Dict> = { pl, en }

export function useT(): Dict {
  return dict[useRouteLoaderData<typeof rootLoader>('root')?.locale ?? 'pl']
}
