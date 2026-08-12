<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import AppIcon from './ui/AppIcon.vue'
import QuestionSilhouette from './art/QuestionSilhouette.vue'
import SpySilhouette from './art/SpySilhouette.vue'

/**
 * Große, vollflächig antippbare Spielkarte der Startansicht.
 * Auf der Karte stehen nur Spielname und Gerätehinweis – wie gefordert.
 */
const props = defineProps<{
  mode: 'impostor' | 'whoami'
  title: string
  subtitle: string
  to: RouteLocationRaw
  /** Anzahl der Telefon-Symbole im Gerätehinweis. */
  devices: number
}>()

const deviceIcons = Array.from({ length: Math.min(props.devices, 4) })
</script>

<template>
  <RouterLink class="mode" :class="`mode--${mode}`" :to="to" :data-accent="mode">
    <div class="mode__art" aria-hidden="true">
      <SpySilhouette v-if="mode === 'impostor'" />
      <QuestionSilhouette v-else />
    </div>

    <div class="mode__text">
      <h2 class="mode__title">{{ title }}</h2>
      <p class="mode__sub">
        <AppIcon name="phone" :size="15" />
        <span>{{ subtitle }}</span>
      </p>
      <p v-if="devices > 1" class="mode__devices" aria-hidden="true">
        <AppIcon v-for="(_, index) in deviceIcons" :key="index" name="phone" :size="14" />
      </p>
    </div>

    <span class="mode__glow" aria-hidden="true" />
  </RouterLink>
</template>

<style scoped>
.mode {
  position: relative;
  display: grid;
  grid-template-columns: minmax(92px, 33%) 1fr;
  align-items: center;
  min-height: clamp(132px, 38vw, 148px);
  padding: var(--s-3);
  overflow: hidden;
  color: var(--c-text);
  border-radius: var(--r-xl);
  border: 1px solid var(--c-accent);
  box-shadow: var(--sh-card);
  isolation: isolate;
  transition:
    transform var(--t-base) var(--e-out),
    box-shadow var(--t-base) var(--e-out);
}

.mode--impostor {
  background: var(--g-impostor);
}

.mode--whoami {
  background: var(--g-whoami);
}

.mode:active {
  transform: scale(0.982);
  box-shadow: 0 8px 22px rgb(0 0 0 / 45%);
}

/* Weiche Lichtstimmung wie in der Referenz. */
.mode__glow {
  position: absolute;
  inset: -40% -10% auto -25%;
  height: 150%;
  background: radial-gradient(45% 55% at 22% 30%, rgb(255 255 255 / 16%) 0%, transparent 70%);
  pointer-events: none;
  z-index: -1;
}

.mode__art {
  width: 100%;
  max-width: 128px;
  aspect-ratio: 1;
  margin-inline: auto;
}

.mode__text {
  min-width: 0;
  padding-right: var(--s-2);
}

/* Skaliert mit der Gerätebreite, ohne auf kleinen Screens übergroß zu werden. */
.mode__title {
  font-size: clamp(1.35rem, 6.4vw, 2rem);
  font-weight: 800;
  letter-spacing: -0.005em;
  line-height: 1.05;
  text-shadow: 0 2px 12px rgb(0 0 0 / 45%);
}

.mode__sub {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-top: var(--s-2);
  font-size: var(--fs-sm);
  color: rgb(255 255 255 / 88%);
}

.mode__devices {
  display: flex;
  gap: 5px;
  margin-top: var(--s-2);
  color: rgb(255 255 255 / 62%);
}

@media (width >= 700px) and (height >= 600px) {
  .mode {
    min-height: 168px;
  }

  .mode__title {
    font-size: 2.2rem;
  }
}

@media (width >= 600px) and (height < 600px) {
  .mode {
    grid-template-columns: minmax(92px, 24%) 1fr;
    min-height: 128px;
    height: 128px;
  }
}
</style>
