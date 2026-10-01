import { sqliteTable, integer, text, real, primaryKey, index } from 'drizzle-orm/sqlite-core'
import type { DecodePart } from '../lib/ai'

// Row created by migration 0003; owns everything that existed before multi-user.
export const OWNER_USER_ID = 1

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').unique(),
  createdAt: integer('created_at').notNull(),
})

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // no FK: adding a REFERENCES column to an existing table would force D1 to rebuild
  // `cards`, and dropping it cascades into review_log
  userId: integer('user_id').notNull().default(OWNER_USER_ID),
  word: text('word').notNull(),
  wordPl: text('word_pl'),
  explanationEn: text('explanation_en'),
  sentenceEn: text('sentence_en'),
  sentencePl: text('sentence_pl'),
  decodeParts: text('decode_parts', { mode: 'json' }).$type<DecodePart[]>(),
  audioKey: text('audio_key'),
  status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull().default('pending'),
  dueAt: integer('due_at').notNull(),
  intervalDays: real('interval_days').notNull(),
  ease: real('ease').notNull(),
  createdAt: integer('created_at').notNull(),
  firstLearnedAt: integer('first_learned_at'),
}, (t) => [index('cards_user_due_idx').on(t.userId, t.dueAt)])

export const reviewLog = sqliteTable('review_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  reviewedAt: integer('reviewed_at').notNull(),
  mode: text('mode', { enum: ['flip', 'write'] }).notNull(),
  grade: text('grade', { enum: ['again', 'good', 'easy'] }).notNull(),
  typed: text('typed'),
})

export const dayLog = sqliteTable('day_log', {
  userId: integer('user_id').notNull().default(OWNER_USER_ID).references(() => users.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // 'YYYY-MM-DD' in Europe/Warsaw
}, (t) => [primaryKey({ columns: [t.userId, t.date] })])

export type Card = typeof cards.$inferSelect

export const settings = sqliteTable('settings', {
  userId: integer('user_id').notNull().default(OWNER_USER_ID).references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })])
