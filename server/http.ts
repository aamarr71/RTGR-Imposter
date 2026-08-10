import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Framework-neutrale Request-/Response-Typen.
 *
 * Dieselben Handler laufen damit unverändert unter Vercels Node-Runtime und
 * als Vite-Dev-Middleware – es gibt keinen zweiten, abweichenden Serverpfad.
 */

export interface ApiRequest {
  method: string
  /** Pfad ohne Querystring, z. B. `/api/rooms/K7M4PX`. */
  path: string
  query: URLSearchParams
  /** Aus dem Routenmuster extrahiert, z. B. `{ code: 'K7M4PX' }`. */
  params: Record<string, string>
  body: unknown
  headers: Record<string, string | undefined>
  cookies: Record<string, string>
  /** Best-effort-Clientadresse für Rate-Limits; wird nur gehasht gespeichert. */
  ip: string
}

export interface CookieOptions {
  maxAgeSeconds?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  path?: string
}

export interface SetCookie extends CookieOptions {
  name: string
  value: string
}

export interface ApiResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
  cookies?: SetCookie[]
}

export type Handler = (req: ApiRequest) => Promise<ApiResponse> | ApiResponse

export function json(body: unknown, status = 200, extra: Partial<ApiResponse> = {}): ApiResponse {
  return { status, body, ...extra }
}

export function noContent(extra: Partial<ApiResponse> = {}): ApiResponse {
  return { status: 204, ...extra }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const result: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    if (!name) continue
    result[name] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return result
}

export function serializeCookie(cookie: SetCookie): string {
  const segments = [`${cookie.name}=${encodeURIComponent(cookie.value)}`]
  segments.push(`Path=${cookie.path ?? '/'}`)
  if (cookie.maxAgeSeconds !== undefined) segments.push(`Max-Age=${cookie.maxAgeSeconds}`)
  if (cookie.httpOnly !== false) segments.push('HttpOnly')
  if (cookie.secure !== false) segments.push('Secure')
  segments.push(`SameSite=${cookie.sameSite ?? 'Lax'}`)
  return segments.join('; ')
}

const MAX_BODY_BYTES = 512 * 1024

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return undefined

  // Vercels Node-Runtime parst JSON teilweise schon vor dem Handler.
  const preparsed = (req as IncomingMessage & { body?: unknown }).body
  if (preparsed !== undefined && preparsed !== null && typeof preparsed !== 'string') {
    return preparsed
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new PayloadTooLarge()
    chunks.push(buffer)
  }
  const raw = typeof preparsed === 'string' ? preparsed : Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new MalformedJson()
  }
}

export class PayloadTooLarge extends Error {
  constructor() {
    super('payload_too_large')
  }
}

export class MalformedJson extends Error {
  constructor() {
    super('malformed_json')
  }
}

/**
 * Erkennt sowohl den eigenen Parserfehler als auch Vercels lazy `req.body`-
 * Fehler. In der Function wirft der Getter bei kaputtem JSON einen fremden
 * `ApiError`; ohne Duck-Typing würde daraus fälschlich ein 500 werden.
 */
export function isMalformedJsonError(error: unknown): boolean {
  if (error instanceof MalformedJson) return true
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { statusCode?: unknown; message?: unknown }
  return candidate.statusCode === 400 && candidate.message === 'Invalid JSON'
}

/** Erste Adresse aus X-Forwarded-For; hinter Vercel ist das die echte Client-IP. */
export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (value) {
    const first = value.split(',')[0]?.trim()
    if (first) return first
  }
  return req.socket?.remoteAddress ?? '0.0.0.0'
}

export function normalizeHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return result
}

export function sendResponse(res: ServerResponse, response: ApiResponse): void {
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    res.setHeader(key, value)
  }
  if (response.cookies?.length) {
    res.setHeader('set-cookie', response.cookies.map(serializeCookie))
  }
  if (response.status === 204 || response.body === undefined) {
    res.statusCode = response.status
    res.end()
    return
  }
  const payload = JSON.stringify(response.body)
  res.statusCode = response.status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(payload))
  res.end(payload)
}
