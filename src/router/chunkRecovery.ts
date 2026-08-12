import type { Router } from 'vue-router'

/**
 * Ein Deployment kann die Hash-Namen lazy geladener Dateien austauschen,
 * während ein bereits offener Tab noch den vorherigen Einstiegschunk ausführt.
 * In diesem Fall ist ein einmaliger Reload die einzig sinnvolle Reparatur.
 */

const RECOVERY_KEY = 'k10:stale-chunk-recovery'
const RECOVERY_WINDOW_MS = 60_000

export interface RecoveryMarker {
  target: string
  attemptedAt: number
}

export interface ChunkRecoveryRuntime {
  now(): number
  currentPath(): string
  loadMarker(): RecoveryMarker | null
  /** Nur `true`, wenn der Schutz auch einen Reload des Dokuments überlebt. */
  saveMarker(marker: RecoveryMarker): boolean
  clearMarker(): void
  reloadAt(target: string): void
}

export interface ChunkRecoveryController {
  recover(target?: string): boolean
  clear(): void
  readonly triggered: boolean
}

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  /load failed for module/i,
  /unable to preload css/i,
  /loading (?:css )?chunk .+ failed/i,
  /chunkloaderror/i,
]

/** Erkennt nur Fehler, die plausibel von einem veralteten Build-Chunk stammen. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const description = `${error.name}: ${error.message}`
  if (CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(description))) return true
  return error.cause !== undefined && isChunkLoadError(error.cause)
}

export function createChunkRecoveryController(
  runtime: ChunkRecoveryRuntime,
): ChunkRecoveryController {
  let triggered = false

  return {
    recover(target = runtime.currentPath()): boolean {
      const attemptedAt = runtime.now()
      const previous = runtime.loadMarker()
      const alreadyTriedRecently =
        previous?.target === target &&
        attemptedAt >= previous.attemptedAt &&
        attemptedAt - previous.attemptedAt < RECOVERY_WINDOW_MS

      // Ein dauerhaft fehlender Chunk darf keine Reload-Schleife erzeugen.
      if (triggered || alreadyTriedRecently) return false

      // Ohne persistenten Marker könnte der nächste Seitenstart sofort wieder
      // laden. Dann ist ein sichtbarer Fehler sicherer als eine Endlosschleife.
      if (!runtime.saveMarker({ target, attemptedAt })) return false

      triggered = true
      runtime.reloadAt(target)
      return true
    },

    clear(): void {
      runtime.clearMarker()
    },

    get triggered(): boolean {
      return triggered
    },
  }
}

function currentBrowserPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function safeInternalPath(target: string): string {
  try {
    const resolved = new URL(target, window.location.href)
    if (resolved.origin !== window.location.origin) return currentBrowserPath()
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return currentBrowserPath()
  }
}

function browserRuntime(): ChunkRecoveryRuntime {
  return {
    now: () => Date.now(),
    currentPath: currentBrowserPath,
    loadMarker: () => {
      try {
        const raw = window.sessionStorage.getItem(RECOVERY_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<RecoveryMarker>
        return typeof parsed.target === 'string' && typeof parsed.attemptedAt === 'number'
          ? { target: parsed.target, attemptedAt: parsed.attemptedAt }
          : null
      } catch {
        return null
      }
    },
    saveMarker: (marker) => {
      try {
        window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(marker))
        return true
      } catch {
        return false
      }
    },
    clearMarker: () => {
      try {
        window.sessionStorage.removeItem(RECOVERY_KEY)
      } catch {
        // Gesperrter Browserspeicher darf eine erfolgreiche Navigation nicht stören.
      }
    },
    reloadAt: (target) => {
      const safeTarget = safeInternalPath(target)
      if (safeTarget !== currentBrowserPath()) {
        window.history.replaceState(window.history.state, '', safeTarget)
      }
      window.location.reload()
    },
  }
}

interface InstallOptions {
  controller?: ChunkRecoveryController
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

/**
 * Verknüpft Vites Preload-Signal mit Vue Routers Zielroute. Dadurch lädt ein
 * Klick nach einem Deployment genau die gewünschte Seite neu, statt auf dem
 * Einstiegsbildschirm scheinbar wirkungslos zu bleiben.
 */
export function installChunkRecovery(router: Router, options: InstallOptions = {}): () => void {
  const controller = options.controller ?? createChunkRecoveryController(browserRuntime())
  const eventTarget = options.eventTarget ?? window
  let pendingTarget: string | null = null

  const removeBefore = router.beforeEach((to) => {
    pendingTarget = router.resolve(to).href
  })

  const removeAfter = router.afterEach(() => {
    // Den Marker nicht sofort löschen: Er ist die Sicherung gegen einen
    // erneut fehlenden Chunk nach dem Reload und läuft nach 60 Sekunden aus.
    pendingTarget = null
  })

  const removeError = router.onError((error, to) => {
    if (!isChunkLoadError(error)) return
    controller.recover(to ? router.resolve(to).href : (pendingTarget ?? undefined))
  })

  const onPreloadError = (event: Event) => {
    const error = (event as Event & { payload?: unknown }).payload
    if (!isChunkLoadError(error)) return
    if (controller.recover(pendingTarget ?? undefined)) event.preventDefault()
  }
  eventTarget.addEventListener('vite:preloadError', onPreloadError)

  return () => {
    removeBefore()
    removeAfter()
    removeError()
    eventTarget.removeEventListener('vite:preloadError', onPreloadError)
  }
}
