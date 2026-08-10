import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApiRequest } from '../server/router.js'

/**
 * Reservierter Query-Parameter des Vercel-Rewrites aus `vercel.json`.
 *
 * Raw Vercel Functions behandeln einen Dateinamen wie `[...path].ts` in einem
 * Vite-Projekt nicht als verlässlichen Catch-all für mehrere Pfadsegmente.
 * Deshalb leitet Vercel alle öffentlichen `/api/*`-Pfade explizit an diese
 * konkrete Function weiter und reicht den ursprünglichen Pfad hier mit.
 */
export const REWRITTEN_API_PATH = '__k10_api_path'

export const config = {
  runtime: 'nodejs',
}

/** Stellt aus `/api/handler?__k10_api_path=rooms/ABC123` den API-Pfad wieder her. */
export function restoreApiRequestUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl

  const rewritten = new URL(rawUrl, 'http://localhost')
  const forwardedPath = rewritten.searchParams.get(REWRITTEN_API_PATH)
  if (forwardedPath === null) return rawUrl

  rewritten.searchParams.delete(REWRITTEN_API_PATH)
  const path = forwardedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const query = rewritten.searchParams.toString()

  return `/api/${path}${query ? `?${query}` : ''}`
}

/** Einziger Produktions-Einstiegspunkt; dieselben Handler laufen auch lokal. */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await handleApiRequest(req, res, restoreApiRequestUrl(req.url))
}
