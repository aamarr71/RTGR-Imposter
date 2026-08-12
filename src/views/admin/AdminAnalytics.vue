<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { adminApi, type AnalyticsResponse } from './adminApi'

/**
 * Analytics-Dashboard.
 *
 * Die Beschriftungen benennen bewusst Geräte, Sitzungen, Räume und Runden –
 * ohne Accounts lässt sich nicht behaupten, Personen zu zählen. Gelöscht wird
 * ausschließlich manuell und nur nach ausdrücklicher Bestätigung.
 */
const range = ref<'24h' | '7d' | '30d' | 'custom'>('7d')
const from = ref('')
const to = ref('')
const data = ref<AnalyticsResponse | null>(null)
const loading = ref(false)
const notice = ref<string | null>(null)
const problem = ref<string | null>(null)

const deleteScope = ref<'range' | 'all'>('range')
const confirmText = ref('')

const metrics = computed(() => {
  const summary = data.value?.summary
  if (!summary) return []
  return [
    { label: 'Anonyme Geräte', value: summary.devices },
    { label: 'App-Sitzungen', value: summary.sessions },
    { label: 'Spielteilnahmen', value: summary.gameParticipations },
    { label: 'Impostor-Runden gestartet', value: summary.impostorRoundsStarted },
    { label: 'Impostor-Runden abgeschlossen', value: summary.impostorRoundsCompleted },
    { label: 'Impostor-Konfiguration abgebrochen', value: summary.impostorSetupAbandoned },
    { label: 'Impostor online gespielt', value: summary.impostorOnline },
    { label: 'Impostor offline gespielt', value: summary.impostorOffline },
    { label: 'Wer-bin-ich-Räume erstellt', value: summary.whoAmIRoomsCreated },
    { label: 'Wer-bin-ich-Runden gestartet', value: summary.whoAmIRoundsStarted },
    { label: 'Ø Spielerzahl', value: summary.averagePlayers.toFixed(1) },
    { label: 'Ø Runden pro Sitzung', value: summary.averageRoundsPerSession.toFixed(2) },
    { label: 'Modus Impostor / Wer bin ich', value: `${summary.modeSplit.impostor} / ${summary.modeSplit.whoAmI}` },
    { label: 'Wortvorschläge', value: summary.suggestions },
  ]
})

async function load() {
  loading.value = true
  problem.value = null
  try {
    data.value = await adminApi.analytics(
      range.value === 'custom' ? 'custom' : range.value,
      range.value === 'custom' ? new Date(from.value).toISOString() : undefined,
      range.value === 'custom' ? new Date(to.value).toISOString() : undefined,
    )
  } catch (error) {
    problem.value = (error as Error).message
  } finally {
    loading.value = false
  }
}

async function removeAnalytics() {
  problem.value = null
  try {
    const payload: Record<string, unknown> = { confirm: confirmText.value }
    if (deleteScope.value === 'all') payload.scope = 'all'
    const result = await adminApi.deleteAnalytics(
      payload,
      deleteScope.value === 'range' && range.value !== 'custom' ? range.value : undefined,
    )
    notice.value = `${result.deleted} Ereignisse gelöscht (${result.scope}).`
    confirmText.value = ''
    await load()
  } catch (error) {
    problem.value = (error as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section class="stats">
    <StatusNote v-if="notice" tone="success" icon="check">{{ notice }}</StatusNote>
    <StatusNote v-if="problem" tone="error" icon="alert">{{ problem }}</StatusNote>

    <AppCard title="Zeitraum">
      <div class="stats__range">
        <label v-for="option in (['24h', '7d', '30d', 'custom'] as const)" :key="option">
          <input v-model="range" type="radio" :value="option" @change="option !== 'custom' && load()" />
          {{ option === 'custom' ? 'Benutzerdefiniert' : `Letzte ${option}` }}
        </label>
        <template v-if="range === 'custom'">
          <input v-model="from" type="datetime-local" />
          <input v-model="to" type="datetime-local" />
          <AppButton size="sm" :disabled="!from || !to" @click="load">Anwenden</AppButton>
        </template>
        <a class="stats__export" :href="`/api/admin/analytics/export?range=${range === 'custom' ? '7d' : range}`">
          Export
        </a>
      </div>
    </AppCard>

    <p v-if="loading" class="stats__loading">Lädt …</p>

    <div v-if="data" class="stats__grid">
      <div v-for="metric in metrics" :key="metric.label" class="stats__tile">
        <p class="stats__value">{{ metric.value }}</p>
        <p class="stats__label">{{ metric.label }}</p>
      </div>
    </div>

    <AppCard v-if="data" title="Kategorienutzung">
      <ul class="stats__bars">
        <li v-for="entry in data.summary.categoryUsage" :key="entry.category">
          <span>{{ entry.category }}</span>
          <span class="stats__count">{{ entry.count }}</span>
        </li>
        <li v-if="data.summary.categoryUsage.length === 0" class="stats__muted">
          Noch keine Daten in diesem Zeitraum.
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="data" title="Wörter je Kategorie">
      <ul class="stats__bars">
        <li v-for="entry in data.termsByCategory" :key="entry.category">
          <span>{{ entry.category }}</span>
          <span class="stats__count">{{ entry.enabled }} aktiv · {{ entry.disabled }} inaktiv</span>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="data" title="Ziehungen pro Wort" hint="Die 100 meistgezogenen Begriffe.">
      <div class="stats__tableWrap">
        <table class="stats__table">
          <thead>
            <tr><th>Begriff</th><th>Kategorie</th><th>Ziehungen</th><th>Zuletzt</th><th>Aktiv</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data.termUsage" :key="row.termId">
              <td>{{ row.displayTerm }}</td>
              <td>{{ row.category }}</td>
              <td class="is-num">{{ row.draws }}</td>
              <td class="is-num">
                {{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleDateString('de-DE') : '–' }}
              </td>
              <td>{{ row.enabled ? 'ja' : 'nein' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <AppCard
      title="Analytics löschen"
      hint="Analytics werden niemals automatisch gelöscht. Dieser Schritt ist unumkehrbar."
    >
      <div class="stats__danger">
        <label>
          <input v-model="deleteScope" type="radio" value="range" /> Nur den gewählten Zeitraum
        </label>
        <label>
          <input v-model="deleteScope" type="radio" value="all" /> Alle Analytics
        </label>
        <input v-model="confirmText" placeholder="Zum Bestätigen LÖSCHEN eingeben" />
        <AppButton variant="danger" size="sm" :disabled="confirmText !== 'LÖSCHEN'" @click="removeAnalytics">
          Endgültig löschen
        </AppButton>
      </div>
    </AppCard>
  </section>
</template>

<style scoped>
.stats {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.stats__range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.stats__range label {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

input[type='radio'] {
  accent-color: var(--c-accent);
}

input[type='datetime-local'],
input[type='text'],
.stats__danger input {
  min-width: 0;
  max-width: 100%;
  min-height: 38px;
  padding: var(--s-2) var(--s-3);
  font-size: var(--fs-sm);
  color: var(--c-text);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--r-sm);
}

@media (max-width: 599px), (pointer: coarse) {
  input[type='datetime-local'],
  input[type='text'],
  .stats__danger input {
    font-size: 16px;
  }
}

.stats__export {
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--c-line);
  border-radius: var(--r-sm);
}

.stats__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  gap: var(--s-3);
}

.stats__tile {
  padding: var(--s-4);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-lg);
}

.stats__value {
  font-size: var(--fs-2xl);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--c-accent);
}

.stats__label {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.stats__bars {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  font-size: var(--fs-sm);
}

.stats__bars li {
  display: flex;
  justify-content: space-between;
  gap: var(--s-4);
  padding-bottom: var(--s-2);
  border-bottom: 1px solid var(--c-line);
}

.stats__count {
  color: var(--c-text-muted);
  font-variant-numeric: tabular-nums;
}

.stats__muted {
  color: var(--c-text-dim);
}

.stats__tableWrap {
  overflow-x: auto;
  max-height: 420px;
}

.stats__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.stats__table th {
  position: sticky;
  top: 0;
  padding: var(--s-2);
  text-align: left;
  color: var(--c-text-dim);
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-line);
}

.stats__table td {
  padding: var(--s-2);
  border-bottom: 1px solid var(--c-line);
}

.stats__table td.is-num {
  font-variant-numeric: tabular-nums;
}

.stats__danger {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.stats__danger label {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.stats__loading {
  color: var(--c-text-muted);
}
</style>
