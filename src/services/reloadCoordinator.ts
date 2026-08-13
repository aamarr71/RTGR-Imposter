/**
 * Ein Dokument darf unabhängig vom Auslöser höchstens einen Reload anstoßen.
 * PWA-Aktivierung und Lazy-Chunk-Recovery teilen sich diese Sicherung, damit
 * ein Deployment-Fenster keine konkurrierenden Reloads erzeugt.
 */
let reloadRequested = false

export function requestDocumentReload(reload: () => void = () => window.location.reload()): boolean {
  if (reloadRequested) return false
  reloadRequested = true
  reload()
  return true
}

/** Ausschließlich für deterministische Tests. */
export function resetDocumentReloadForTest(): void {
  reloadRequested = false
}
