export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'update_available'
  | 'deferred'
  | 'applying'

export interface AppUpdateSnapshot {
  status: AppUpdateStatus
  currentBuild: string
  safeToUpdate: boolean
  updateAvailable: boolean
  controllerChanged: boolean
  reloadRequested: boolean
  lastCheckedAt: number | null
  error: string | null
}

export interface AppUpdateRuntime {
  currentBuild: string
  activateUpdate(): Promise<void>
  checkForUpdate(): Promise<void>
  reload(): void
  now(): number
}

export interface AppUpdateController {
  readonly snapshot: AppUpdateSnapshot
  subscribe(listener: (snapshot: AppUpdateSnapshot) => void): () => void
  setSafeToUpdate(safe: boolean): void
  notifyUpdateAvailable(): void
  notifyControllerChanged(): void
  checkForUpdate(): Promise<boolean>
  applyNow(): Promise<boolean>
}

/**
 * Entscheidungsinstanz für den PWA-Lifecycle. Browser- und Workbox-Ereignisse
 * werden nur als Fakten eingespeist; ob aktiviert oder gewartet wird, bleibt
 * dadurch unabhängig vom Service Worker deterministisch testbar.
 */
export function createAppUpdateController(runtime: AppUpdateRuntime): AppUpdateController {
  const listeners = new Set<(snapshot: AppUpdateSnapshot) => void>()
  let snapshot: AppUpdateSnapshot = {
    status: 'idle',
    currentBuild: runtime.currentBuild,
    safeToUpdate: false,
    updateAvailable: false,
    controllerChanged: false,
    reloadRequested: false,
    lastCheckedAt: null,
    error: null,
  }
  let applying: Promise<boolean> | null = null
  let manualApply = false

  function publish(patch: Partial<AppUpdateSnapshot>): void {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener(snapshot)
  }

  // Asynchrone Browseroperationen können den Snapshot über parallele
  // Workbox-Callbacks verändern; der Helfer verhindert falsche TS-Narrowings.
  function currentStatus(): AppUpdateStatus {
    return snapshot.status
  }

  function reloadOnce(): boolean {
    if (snapshot.reloadRequested) return false
    publish({ status: 'applying', reloadRequested: true, error: null })
    runtime.reload()
    return true
  }

  function continueAtSafePoint(): void {
    if (!snapshot.safeToUpdate) return
    if (snapshot.controllerChanged) {
      reloadOnce()
      return
    }
    if (snapshot.updateAvailable && snapshot.status !== 'applying') void apply(false)
  }

  async function apply(force: boolean): Promise<boolean> {
    if (snapshot.reloadRequested) return false
    if (applying) return applying
    if (!snapshot.updateAvailable && !snapshot.controllerChanged) return false

    if (!force && !snapshot.safeToUpdate) {
      publish({ status: 'deferred' })
      return false
    }

    if (snapshot.controllerChanged) return reloadOnce()

    manualApply = force
    publish({ status: 'applying', error: null })
    applying = runtime
      .activateUpdate()
      .then(() => true)
      .catch((error: unknown) => {
        manualApply = false
        if (snapshot.reloadRequested) return false
        publish({
          status: snapshot.safeToUpdate ? 'update_available' : 'deferred',
          error: error instanceof Error ? error.message : 'update_failed',
        })
        return false
      })
      .finally(() => {
        applying = null
      })
    return applying
  }

  return {
    get snapshot(): AppUpdateSnapshot {
      return snapshot
    },

    subscribe(listener): () => void {
      listeners.add(listener)
      listener(snapshot)
      return () => listeners.delete(listener)
    },

    setSafeToUpdate(safe): void {
      if (snapshot.safeToUpdate === safe) return
      publish({ safeToUpdate: safe })
      if (safe) continueAtSafePoint()
      else if (snapshot.updateAvailable && snapshot.status !== 'applying') {
        publish({ status: 'deferred' })
      }
    },

    notifyUpdateAvailable(): void {
      if (snapshot.reloadRequested) return
      if (snapshot.status === 'applying') {
        if (!snapshot.updateAvailable) publish({ updateAvailable: true })
        return
      }
      publish({
        updateAvailable: true,
        status: snapshot.safeToUpdate ? 'update_available' : 'deferred',
        error: null,
      })
      if (snapshot.safeToUpdate) void apply(false)
    },

    notifyControllerChanged(): void {
      if (snapshot.reloadRequested) return
      publish({
        controllerChanged: true,
        updateAvailable: true,
        status: snapshot.safeToUpdate || manualApply ? 'applying' : 'deferred',
        error: null,
      })
      if (snapshot.safeToUpdate || manualApply) reloadOnce()
    },

    async checkForUpdate(): Promise<boolean> {
      if (
        snapshot.status === 'checking' ||
        snapshot.status === 'applying' ||
        snapshot.updateAvailable ||
        snapshot.reloadRequested
      ) {
        return false
      }

      publish({ status: 'checking', error: null })
      try {
        await runtime.checkForUpdate()
        if (currentStatus() === 'checking') {
          publish({ status: 'idle', lastCheckedAt: runtime.now() })
        } else {
          publish({ lastCheckedAt: runtime.now() })
        }
        return true
      } catch (error) {
        if (currentStatus() === 'checking') {
          publish({
            status: 'idle',
            lastCheckedAt: runtime.now(),
            error: error instanceof Error ? error.message : 'update_check_failed',
          })
        } else {
          publish({ lastCheckedAt: runtime.now() })
        }
        return false
      }
    },

    applyNow: () => apply(true),
  }
}
