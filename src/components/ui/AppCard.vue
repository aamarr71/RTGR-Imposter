<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Überschrift der Sektion. */
    title?: string
    hint?: string
    padded?: boolean
  }>(),
  { padded: true },
)
</script>

<template>
  <section class="card" :class="{ 'card--padded': padded }">
    <header v-if="title || $slots.action" class="card__head">
      <div>
        <h2 v-if="title" class="card__title">{{ title }}</h2>
        <p v-if="hint" class="card__hint">{{ hint }}</p>
      </div>
      <slot name="action" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-raised), var(--sh-inset);
}

.card--padded {
  padding: var(--card-padding);
}

.card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
}

.card__head > div {
  flex: 1;
  min-width: 0;
}

.card__head > :not(div) {
  flex: none;
}

.card__title {
  font-size: var(--fs-md);
  font-weight: 650;
  letter-spacing: 0.02em;
  overflow-wrap: anywhere;
}

.card__hint {
  margin-top: 2px;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  overflow-wrap: anywhere;
}
</style>
