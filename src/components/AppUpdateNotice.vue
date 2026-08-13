<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { t } from '@/i18n'
import { appUpdateController, appUpdateState } from '@/services/appUpdateState'

const visible = computed(
  () =>
    appUpdateState.value.status === 'deferred' ||
    appUpdateState.value.status === 'update_available' ||
    (appUpdateState.value.status === 'applying' && !appUpdateState.value.safeToUpdate),
)
const applying = computed(() => appUpdateState.value.status === 'applying')
const message = computed(() => {
  if (applying.value) return t('update.applying')
  if (!appUpdateState.value.safeToUpdate) return t('update.deferred')
  return t('update.ready')
})
</script>

<template>
  <aside v-if="visible" class="updateNotice" aria-labelledby="app-update-title">
    <AppIcon name="refresh" :size="19" class="updateNotice__icon" />
    <div class="updateNotice__copy">
      <strong id="app-update-title">{{ t('update.title') }}</strong>
      <p>{{ message }}</p>
    </div>
    <AppButton
      size="sm"
      variant="secondary"
      :loading="applying"
      @click="appUpdateController.applyNow()"
    >
      {{ t('update.now') }}
    </AppButton>
  </aside>
</template>

<style scoped>
.updateNotice {
  position: fixed;
  right: max(var(--safe-right), var(--page-inline));
  bottom: calc(max(var(--safe-bottom), var(--page-bottom)) + var(--s-2));
  left: max(var(--safe-left), var(--page-inline));
  z-index: 50;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--s-3);
  width: auto;
  max-width: 560px;
  margin-inline: auto;
  padding: var(--s-3);
  color: var(--c-text);
  background: color-mix(in srgb, var(--c-surface-3) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-accent) 34%, var(--c-line));
  border-radius: var(--r-lg);
  box-shadow: 0 18px 48px rgb(0 0 0 / 58%), var(--sh-inset);
  backdrop-filter: blur(14px);
}

.updateNotice__icon {
  color: var(--c-accent);
}

.updateNotice__copy {
  min-width: 0;
}

.updateNotice__copy strong {
  display: block;
  font-size: var(--fs-sm);
}

.updateNotice__copy p {
  margin-top: 2px;
  font-size: var(--fs-xs);
  line-height: 1.35;
  color: var(--c-text-muted);
}

@media (max-width: 420px) {
  .updateNotice {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .updateNotice > :deep(.btn) {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
