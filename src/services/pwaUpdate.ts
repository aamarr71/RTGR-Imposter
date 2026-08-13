import { registerSW } from 'virtual:pwa-register'
import { appUpdateController, bindAppUpdateRuntime } from './appUpdateState'

const PERIODIC_CHECK_MS = 15 * 60_000
const ATTENTION_CHECK_THROTTLE_MS = 60_000

let installed = false

/**
 * Verbindet Workbox genau einmal mit der zentralen Update-Entscheidung.
 * Neben der Browserprüfung bei der Registrierung prüfen wir im Vordergrund
 * regelmäßig und bei Rückkehr in die App – gleichermaßen für Tab und PWA.
 */
export function installPwaUpdateLifecycle(): () => void {
  if (installed || !('serviceWorker' in navigator)) return () => undefined
  installed = true

  let registration: ServiceWorkerRegistration | undefined
  let updateServiceWorker: () => Promise<void> = async () => undefined
  let lastCheckRequestedAt = 0
  let hadController = Boolean(navigator.serviceWorker.controller)

  bindAppUpdateRuntime({
    activateUpdate: () => updateServiceWorker(),
    checkForUpdate: async () => {
      if (registration) await registration.update()
    },
  })

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => appUpdateController.notifyUpdateAvailable(),
    // vite-plugin-pwa meldet hier den kontrollierenden neuen Worker. Der
    // eigentliche Reload bleibt ausschließlich in unserer Entscheidungsschicht.
    onNeedReload: () => appUpdateController.notifyControllerChanged(),
    onRegisteredSW: (_scriptUrl, value) => {
      registration = value
      requestCheck(true)
    },
  })

  function requestCheck(force = false): void {
    const now = Date.now()
    if (!force && now - lastCheckRequestedAt < ATTENTION_CHECK_THROTTLE_MS) return
    lastCheckRequestedAt = now
    void appUpdateController.checkForUpdate()
  }

  const onControllerChange = () => {
    // Die erstmalige Kontrolle einer zuvor unkontrollierten Installation ist
    // kein Versionswechsel. Bei bekannten Updates gilt das Ereignis trotzdem.
    if (hadController || appUpdateController.snapshot.updateAvailable) {
      appUpdateController.notifyControllerChanged()
    }
    hadController = true
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') requestCheck()
  }
  const onAttention = () => requestCheck()

  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onAttention)
  window.addEventListener('online', onAttention)
  window.addEventListener('pageshow', onAttention)
  const interval = window.setInterval(() => {
    if (document.visibilityState === 'visible') requestCheck(true)
  }, PERIODIC_CHECK_MS)

  return () => {
    installed = false
    window.clearInterval(interval)
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onAttention)
    window.removeEventListener('online', onAttention)
    window.removeEventListener('pageshow', onAttention)
  }
}
