import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core'

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull(),
  wordPl: text('word_pl'),
  explanationEn: text('explanation_en'),
  sentenceEn: text('sentence_en'),
  sentencePl: text('sentence_pl'),
  audioKey: text('audio_key'),
  status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull().default('pending'),
  dueAt: integer('due_at').notNull(),
  intervalDays: real('interval_days').notNull(),
  ease: real('ease').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const reviewLog = sqliteTable('review_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  reviewedAt: integer('reviewed_at').notNull(),
  mode: text('mode', { enum: ['flip', 'write'] }).notNull(),
  grade: text('grade', { enum: ['again', 'good', 'easy'] }).notNull(),
  typed: text('typed'),
})

export const dayLog = sqliteTable('day_log', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD' in Europe/Warsaw
})

export type Card = typeof cards.$inferSelect
