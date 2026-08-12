<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AgeGate from '@/components/AgeGate.vue'
import { analytics, installAnalyticsLifecycle } from '@/services/analytics'
import { useSettingsStore } from '@/stores/settings'

const route = useRoute()
const settings = useSettingsStore()

/** Steuert die Akzentfarbe aller Komponenten innerhalb der aktiven Route. */
const accent = computed(() => route.meta.accent ?? 'neutral')

onMounted(() => {
  installAnalyticsLifecycle()
  analytics.track('app_session_start')
})
</script>

<template>
  <div class="shell" :data-accent="accent">
    <AgeGate v-if="!settings.ageConfirmed" />
    <RouterView v-else v-slot="{ Component }">
      <Transition name="view" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  flex: 1;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
}
</style>
