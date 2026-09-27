import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  route('cards', 'routes/cards.tsx'),
  route('cards/:id', 'routes/card-detail.tsx'),
  route('review', 'routes/review.tsx'),
  route('review/check', 'routes/review-check.ts'),
  route('learn', 'routes/learn.tsx'),
  route('audio/:id', 'routes/audio.ts'),
  route('export/:format', 'routes/export.ts'),
  route('theme', 'routes/theme.ts'),
] satisfies RouteConfig
