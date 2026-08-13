import { describe, expect, it, vi } from 'vitest'
import {
  createAppUpdateController,
  type AppUpdateRuntime,
} from './appUpdate'

function fakeRuntime() {
  let now = 1_000
  const runtime: AppUpdateRuntime = {
    currentBuild: 'test-build-x',
    activateUpdate: vi.fn().mockResolvedValue(undefined),
    checkForUpdate: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
    now: () => now,
  }
  return {
    runtime,
    advance: (milliseconds: number) => {
      now += milliseconds
    },
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('zentraler PWA-Update-Controller', () => {
  it('aktiviert ein verfügbares Update im sicheren Zustand automatisch', async () => {
    const fake = fakeRuntime()
    const controller = createAppUpdateController(fake.runtime)
    controller.setSafeToUpdate(true)

    controller.notifyUpdateAvailable()
    await settle()

    expect(fake.runtime.activateUpdate).toHaveBeenCalledOnce()
    expect(controller.snapshot.status).toBe('applying')
    expect(fake.runtime.reload).not.toHaveBeenCalled()
  })

  it('verschiebt ein Update während einer laufenden Runde', async () => {
    const fake = fakeRuntime()
    const controller = createAppUpdateController(fake.runtime)
    controller.setSafeToUpdate(false)

    controller.notifyUpdateAvailable()
    await settle()

    expect(controller.snapshot.status).toBe('deferred')
    expect(controller.snapshot.updateAvailable).toBe(true)
    expect(fake.runtime.activateUpdate).not.toHaveBeenCalled()
    expect(fake.runtime.reload).not.toHaveBeenCalled()
  })

  it('wendet ein verschobenes Update beim nächsten sicheren Zustand an', async () => {
    const fake = fakeRuntime()
    const controller = createAppUpdateController(fake.runtime)
    controller.notifyUpdateAvailable()
    expect(controller.snapshot.status).toBe('deferred')

    controller.setSafeToUpdate(true)
    await settle()

    expect(fake.runtime.activateUpdate).toHaveBeenCalledOnce()
    expect(controller.snapshot.status).toBe('applying')
  })

  it('aktiviert beim manuellen Update und lädt nach Übernahme genau einmal neu', async () => {
    const fake = fakeRuntime()
    const controller = createAppUpdateController(fake.runtime)
    controller.notifyUpdateAvailable()

    expect(await controller.applyNow()).toBe(true)
    expect(fake.runtime.activateUpdate).toHaveBeenCalledOnce()
    expect(fake.runtime.reload).not.toHaveBeenCalled()

    controller.notifyControllerChanged()
    controller.notifyControllerChanged()

    expect(fake.runtime.reload).toHaveBeenCalledOnce()
    expect(controller.snapshot.reloadRequested).toBe(true)
  })

  it('verschiebt auch einen von einem anderen Tab aktivierten Worker bis zum sicheren Zustand', () => {
    const fake = fakeRuntime()
    const controller = createAppUpdateController(fake.runtime)

    controller.notifyControllerChanged()
    expect(controller.snapshot.status).toBe('deferred')
    expect(fake.runtime.reload).not.toHaveBeenCalled()

    controller.setSafeToUpdate(true)
    expect(fake.runtime.activateUpdate).not.toHaveBeenCalled()
    expect(fake.runtime.reload).toHaveBeenCalledOnce()
  })

  it('ignoriert wiederholte controllerchange-Ereignisse und verhindert Reload-Loops', () => {
    const fake = fakeRuntime()
    const controller = createAppUpdateController(fake.runtime)
    controller.setSafeToUpdate(true)

    controller.notifyControllerChanged()
    controller.notifyControllerChanged()
    controller.setSafeToUpdate(false)
    controller.setSafeToUpdate(true)

    expect(fake.runtime.reload).toHaveBeenCalledOnce()
  })

  it('prüft ohne verfügbares Update, ohne Aktivierung oder Reload auszulösen', async () => {
    const fake = fakeRuntime()
    const controller = createAppUpdateController(fake.runtime)
    controller.setSafeToUpdate(true)
    fake.advance(250)

    expect(await controller.checkForUpdate()).toBe(true)

    expect(fake.runtime.checkForUpdate).toHaveBeenCalledOnce()
    expect(fake.runtime.activateUpdate).not.toHaveBeenCalled()
    expect(fake.runtime.reload).not.toHaveBeenCalled()
    expect(controller.snapshot.status).toBe('idle')
    expect(controller.snapshot.lastCheckedAt).toBe(1_250)
  })

  it('überschreibt ein parallel erkanntes Update nicht mit einem späten Prüffehler', async () => {
    const fake = fakeRuntime()
    let rejectCheck: (error: Error) => void = () => undefined
    fake.runtime.checkForUpdate = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCheck = reject
        }),
    )
    const controller = createAppUpdateController(fake.runtime)

    const checking = controller.checkForUpdate()
    controller.notifyUpdateAvailable()
    rejectCheck(new Error('offline'))
    await checking

    expect(controller.snapshot.status).toBe('deferred')
    expect(controller.snapshot.updateAvailable).toBe(true)
    expect(controller.snapshot.error).toBeNull()
  })
})
