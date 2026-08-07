import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { APP_NAME } from '@shared/config'

/**
 * Routen. Lazy-Chunks für alles außer der Startseite: der erste Aufruf soll
 * sofort die Spielauswahl zeigen, ohne Admin- oder Wer-bin-ich-Code zu laden.
 *
 * `meta.accent` steuert die Akzentfarbe des Layouts (Teal bzw. Orange).
 */
declare module 'vue-router' {
  interface RouteMeta {
    accent?: 'impostor' | 'whoami' | 'neutral'
    title?: string
    wide?: boolean
    /** Verhindert, dass eine laufende Runde durch versehentliches Zurück zerstört wird. */
    guardLeave?: boolean
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { accent: 'neutral' },
  },

  /* --- Impostor --- */
  {
    path: '/impostor',
    name: 'impostor-setup',
    component: () => import('@/views/impostor/ImpostorSetupView.vue'),
    meta: { accent: 'impostor', title: 'Impostor' },
  },
  {
    path: '/impostor/rollen',
    name: 'impostor-reveal',
    component: () => import('@/views/impostor/ImpostorRevealView.vue'),
    meta: { accent: 'impostor', title: 'Impostor', guardLeave: true },
  },
  {
    path: '/impostor/runde',
    name: 'impostor-round',
    component: () => import('@/views/impostor/ImpostorRoundView.vue'),
    meta: { accent: 'impostor', title: 'Impostor', guardLeave: true },
  },
  {
    path: '/impostor/aufgedeckt',
    name: 'impostor-result',
    component: () => import('@/views/impostor/ImpostorResultView.vue'),
    meta: { accent: 'impostor', title: 'Impostor' },
  },

  /* --- Wer bin ich --- */
  {
    path: '/wer-bin-ich',
    name: 'whoami-entry',
    component: () => import('@/views/whoami/WhoAmIEntryView.vue'),
    meta: { accent: 'whoami', title: 'Wer bin ich?' },
  },
  {
    path: '/room/:code',
    name: 'whoami-room',
    component: () => import('@/views/whoami/WhoAmIRoomView.vue'),
    props: true,
    meta: { accent: 'whoami', title: 'Wer bin ich?' },
  },

  /* --- Nebenflächen --- */
  {
    path: '/wort-vorschlagen',
    name: 'suggest',
    component: () => import('@/views/SuggestWordView.vue'),
    meta: { accent: 'neutral', title: 'Wort vorschlagen' },
  },
  {
    path: '/einstellungen',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { accent: 'neutral', title: 'Einstellungen' },
  },
  {
    path: '/impressum',
    name: 'imprint',
    component: () => import('@/views/legal/ImprintView.vue'),
    meta: { accent: 'neutral', title: 'Impressum' },
  },
  {
    path: '/datenschutz',
    name: 'privacy',
    component: () => import('@/views/legal/PrivacyView.vue'),
    meta: { accent: 'neutral', title: 'Datenschutz' },
  },

  /* --- Admin (nicht prominent verlinkt) --- */
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/admin/AdminView.vue'),
    meta: { accent: 'neutral', title: 'Admin', wide: true },
  },

  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { accent: 'neutral' },
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME
})

export default router
