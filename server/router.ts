import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiFailure, fail, toResponse } from './errors.js'
import {
  clientIp,
  isMalformedJsonError,
  normalizeHeaders,
  parseCookies,
  PayloadTooLarge,
  readBody,
  sendResponse,
  type ApiRequest,
  type ApiResponse,
  type Handler,
} from './http.js'
import { routes } from './routes/index.js'

interface CompiledRoute {
  method: string
  segments: string[]
  handler: Handler
}

/** `/api/rooms/:code/players/:playerId` → Segmentliste mit `:`-Platzhaltern. */
function compile(pattern: string): string[] {
  return pattern.split('/').filter(Boolean)
}

const compiled: CompiledRoute[] = routes.map((route) => ({
  method: route.method,
  segments: compile(route.path),
  handler: route.handler,
}))

/** Vergleicht nur den Pfad; die Methode prüft der Aufrufer separat (für 405). */
function matchPath(route: CompiledRoute, segments: string[]): Record<string, string> | null {
  if (route.segments.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < route.segments.length; index++) {
    const expected = route.segments[index] as string
    const actual = segments[index] as string
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual)
    } else if (expected !== actual) {
      return null
    }
  }
  return params
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: string | undefined = req.url,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  const url = new URL(requestUrl ?? '/', 'http://localhost')
  const segments = url.pathname.split('/').filter(Boolean)

  let response: ApiResponse
  try {
    let handler: Handler | null = null
    let params: Record<string, string> = {}
    let pathExists = false

    for (const route of compiled) {
      const matched = matchPath(route, segments)
      if (!matched) continue
      pathExists = true
      if (route.method === method) {
        handler = route.handler
        params = matched
        break
      }
    }

    if (!handler) {
      throw pathExists
        ? new ApiFailure(405, 'method_not_allowed', 'Methode nicht erlaubt.')
        : fail.notFound('route_not_found', 'Diesen Endpunkt gibt es nicht.')
    }

    const body = await readBody(req)
    const apiRequest: ApiRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      params,
      body,
      headers: normalizeHeaders(req),
      cookies: parseCookies(req.headers.cookie),
      ip: clientIp(req),
    }

    response = await handler(apiRequest)
  } catch (error) {
    if (error instanceof PayloadTooLarge) response = toResponse(fail.tooLarge())
    else if (isMalformedJsonError(error))
      response = toResponse(fail.badRequest('malformed_json', 'Ungültiges JSON.'))
    else response = toResponse(error)
  }

  // Spielzustände dürfen niemals von einem Proxy zwischengespeichert werden.
  response.headers = { 'cache-control': 'no-store', ...response.headers }
  sendResponse(res, response)
}
