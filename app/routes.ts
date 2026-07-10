import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  route('cards', 'routes/cards.tsx'),
  route('cards/:id', 'routes/card-detail.tsx'),
  route('review', 'routes/review.tsx'),
  route('audio/:id', 'routes/audio.ts'),
  route('export/:format', 'routes/export.ts'),
] satisfies RouteConfig
