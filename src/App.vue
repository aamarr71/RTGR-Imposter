<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AgeGate from '@/components/AgeGate.vue'
import AppUpdateNotice from '@/components/AppUpdateNotice.vue'
import { analytics, installAnalyticsLifecycle } from '@/services/analytics'
import { appUpdateController } from '@/services/appUpdateState'
import { isSafeForAppUpdate } from '@/services/updateSafety'
import { useRoomStore } from '@/stores/room'
import { useSettingsStore } from '@/stores/settings'

const route = useRoute()
const settings = useSettingsStore()
const room = useRoomStore()

/** Steuert die Akzentfarbe aller Komponenten innerhalb der aktiven Route. */
const accent = computed(() => route.meta.accent ?? 'neutral')
const updateIsSafe = computed(() =>
  isSafeForAppUpdate({
    routeName: route.name,
    routeGuardsInteraction: Boolean(route.meta.guardLeave),
    hasRoomMembership: room.membership !== null,
    roomView: room.view,
  }),
)

watch(updateIsSafe, (safe) => appUpdateController.setSafeToUpdate(safe), {
  immediate: true,
})

onMounted(() => {
  installAnalyticsLifecycle()
  analytics.track('app_session_start')
})

onBeforeUnmount(() => appUpdateController.setSafeToUpdate(false))
</script>

<template>
  <div class="shell" :data-accent="accent">
    <AgeGate v-if="!settings.ageConfirmed" />
    <RouterView v-else v-slot="{ Component }">
      <Transition name="view" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
    <AppUpdateNotice />
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
