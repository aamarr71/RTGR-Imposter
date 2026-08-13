import { readonly, shallowRef } from 'vue'
import { runtimeConfig } from '@/config/runtime'
import { createAppUpdateController, type AppUpdateSnapshot } from './appUpdate'
import { requestDocumentReload } from './reloadCoordinator'

let activateUpdate: () => Promise<void> = async () => undefined
let checkForUpdate: () => Promise<void> = async () => undefined

export const appUpdateController = createAppUpdateController({
  currentBuild: runtimeConfig.version,
  activateUpdate: () => activateUpdate(),
  checkForUpdate: () => checkForUpdate(),
  reload: () => void requestDocumentReload(),
  now: () => Date.now(),
})

const state = shallowRef<AppUpdateSnapshot>(appUpdateController.snapshot)
appUpdateController.subscribe((snapshot) => {
  state.value = snapshot
})

export const appUpdateState = readonly(state)

/** Bindet den Browseradapter einmalig an die testbare Entscheidungsschicht. */
export function bindAppUpdateRuntime(runtime: {
  activateUpdate(): Promise<void>
  checkForUpdate(): Promise<void>
}): void {
  activateUpdate = runtime.activateUpdate
  checkForUpdate = runtime.checkForUpdate
}
