import type { Handler } from '../http.js'
import { json } from '../http.js'
import { env } from '../env.js'
import { getStore } from '../store/index.js'
import * as admin from './admin.js'
import { postAnalyticsEvents } from './analytics.js'
import * as rooms from './rooms.js'
import { postSuggestion } from './suggestions.js'
import { getTerms, postTermDraws } from './terms.js'

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  handler: Handler
}

const health: Handler = async () => {
  const store = getStore()
  try {
    await store.healthCheck()
    return json({ ok: true, store: store.kind, production: env.isProduction })
  } catch (error) {
    return json({ ok: false, store: store.kind, error: (error as Error).message }, 503)
  }
}

/**
 * Routentabelle. Spiel- und Admin-APIs sind strikt getrennt: alles unter
 * `/api/admin` verlangt eine gültige Adminsession, alles andere niemals.
 */
export const routes: RouteDefinition[] = [
  { method: 'GET', path: '/api/health', handler: health },

  /* Impostor */
  { method: 'GET', path: '/api/terms', handler: getTerms },
  { method: 'POST', path: '/api/terms/draws', handler: postTermDraws },

  /* Wortvorschläge */
  { method: 'POST', path: '/api/suggestions', handler: postSuggestion },

  /* Analytics */
  { method: 'POST', path: '/api/analytics/events', handler: postAnalyticsEvents },

  /* Wer bin ich */
  { method: 'POST', path: '/api/rooms', handler: rooms.postRoom },
  { method: 'POST', path: '/api/rooms/:code/join', handler: rooms.postJoin },
  { method: 'GET', path: '/api/rooms/:code', handler: rooms.getRoom },
  { method: 'DELETE', path: '/api/rooms/:code', handler: rooms.deleteRoom },
  { method: 'POST', path: '/api/rooms/:code/term', handler: rooms.postTerm },
  { method: 'PATCH', path: '/api/rooms/:code/notes', handler: rooms.putNotes },
  { method: 'POST', path: '/api/rooms/:code/order', handler: rooms.postReorder },
  { method: 'POST', path: '/api/rooms/:code/renumber', handler: rooms.postRenumber },
  { method: 'DELETE', path: '/api/rooms/:code/players/:playerId', handler: rooms.deletePlayer },
  { method: 'POST', path: '/api/rooms/:code/lock', handler: rooms.postLock },
  { method: 'POST', path: '/api/rooms/:code/host', handler: rooms.postHost },
  { method: 'POST', path: '/api/rooms/:code/reset-submission', handler: rooms.postResetSubmission },
  { method: 'POST', path: '/api/rooms/:code/start', handler: rooms.postStart },
  { method: 'POST', path: '/api/rooms/:code/placement', handler: rooms.postPlacementRequest },
  {
    method: 'POST',
    path: '/api/rooms/:code/placements/:playerId/approve',
    handler: rooms.postPlacementApproval,
  },
  {
    method: 'DELETE',
    path: '/api/rooms/:code/placements/:playerId',
    handler: rooms.deletePlacement,
  },
  { method: 'POST', path: '/api/rooms/:code/end', handler: rooms.postEnd },
  { method: 'POST', path: '/api/rooms/:code/leave', handler: rooms.postLeave },

  /* Admin */
  { method: 'POST', path: '/api/admin/login', handler: admin.postLogin },
  { method: 'POST', path: '/api/admin/logout', handler: admin.postLogout },
  { method: 'GET', path: '/api/admin/session', handler: admin.getSession },
  { method: 'GET', path: '/api/admin/categories', handler: admin.getCategories },
  { method: 'GET', path: '/api/admin/terms', handler: admin.listTerms },
  { method: 'POST', path: '/api/admin/terms', handler: admin.createTerm },
  { method: 'GET', path: '/api/admin/terms/export', handler: admin.exportTerms },
  { method: 'POST', path: '/api/admin/terms/import', handler: admin.importTerms },
  { method: 'PATCH', path: '/api/admin/terms/:id', handler: admin.updateTerm },
  { method: 'DELETE', path: '/api/admin/terms/:id', handler: admin.deleteTerm },
  { method: 'GET', path: '/api/admin/suggestions', handler: admin.listSuggestions },
  { method: 'PATCH', path: '/api/admin/suggestions/:id', handler: admin.updateSuggestion },
  { method: 'POST', path: '/api/admin/suggestions/:id/convert', handler: admin.convertSuggestion },
  { method: 'GET', path: '/api/admin/analytics', handler: admin.getAnalytics },
  { method: 'GET', path: '/api/admin/analytics/export', handler: admin.exportAnalytics },
  { method: 'DELETE', path: '/api/admin/analytics', handler: admin.deleteAnalytics },
  { method: 'GET', path: '/api/admin/audit', handler: admin.getAuditLog },
  { method: 'POST', path: '/api/admin/maintenance', handler: admin.postMaintenance },
]
