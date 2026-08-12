<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { CATEGORIES, SUGGESTION_STATUSES, type SuggestionStatus } from '@shared/config'
import type { TermSuggestion } from '@shared/types'
import { adminApi } from './adminApi'

/**
 * Moderationswarteschlange. Vor der Übernahme in den Pool lassen sich alle
 * Felder korrigieren; „übernehmen“ legt standardmäßig einen **deaktivierten**
 * Eintrag an.
 */
const rows = ref<TermSuggestion[]>([])
const filter = ref<SuggestionStatus | ''>('new')
const notice = ref<string | null>(null)
const problem = ref<string | null>(null)
const editing = ref<Record<string, Partial<TermSuggestion>>>({})

async function load() {
  problem.value = null
  try {
    const result = await adminApi.suggestions(filter.value || undefined)
    rows.value = result.rows
    editing.value = {}
  } catch {
    problem.value = 'Vorschläge konnten nicht geladen werden.'
  }
}

function patchOf(row: TermSuggestion): Partial<TermSuggestion> {
  editing.value[row.id] ??= {}
  return editing.value[row.id] as Partial<TermSuggestion>
}

async function saveEdits(row: TermSuggestion) {
  await adminApi.updateSuggestion(row.id, patchOf(row))
  notice.value = 'Vorschlag gespeichert.'
  await load()
}

async function setStatus(row: TermSuggestion, status: SuggestionStatus) {
  await adminApi.updateSuggestion(row.id, { ...patchOf(row), status })
  notice.value = `Status auf „${status}“ gesetzt.`
  await load()
}

async function convert(row: TermSuggestion, enable: boolean) {
  problem.value = null
  try {
    // Etwaige Korrekturen zuerst sichern, damit der Pool-Eintrag stimmt.
    if (Object.keys(patchOf(row)).length > 0) {
      await adminApi.updateSuggestion(row.id, patchOf(row))
    }
    await adminApi.convertSuggestion(row.id, enable)
    notice.value = enable
      ? 'In den Wortpool übernommen und aktiviert.'
      : 'In den Wortpool übernommen – noch deaktiviert.'
    await load()
  } catch (error) {
    problem.value = (error as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section class="mod">
    <StatusNote v-if="notice" tone="success" icon="check">{{ notice }}</StatusNote>
    <StatusNote v-if="problem" tone="error" icon="alert">{{ problem }}</StatusNote>

    <AppCard title="Moderation">
      <div class="mod__filter">
        <label>
          Status
          <select v-model="filter" @change="load">
            <option value="">Alle</option>
            <option v-for="status in SUGGESTION_STATUSES" :key="status" :value="status">
              {{ status }}
            </option>
          </select>
        </label>
        <AppButton size="sm" variant="ghost" @click="load">Neu laden</AppButton>
      </div>
    </AppCard>

    <p v-if="rows.length === 0" class="mod__empty">Keine Vorschläge in dieser Ansicht.</p>

    <AppCard v-for="row in rows" :key="row.id" :title="row.displayTerm" :hint="`${row.status} · ${new Date(row.createdAt).toLocaleString('de-DE')}`">
      <div class="mod__grid">
        <label>
          Angezeigter Begriff
          <input :value="patchOf(row).displayTerm ?? row.displayTerm" @input="patchOf(row).displayTerm = ($event.target as HTMLInputElement).value" />
        </label>
        <label>
          Bedeutung
          <input :value="patchOf(row).canonicalTerm ?? row.canonicalTerm" @input="patchOf(row).canonicalTerm = ($event.target as HTMLInputElement).value" />
        </label>
        <label>
          Hinweiswort
          <input :value="patchOf(row).hintTerm ?? row.hintTerm" @input="patchOf(row).hintTerm = ($event.target as HTMLInputElement).value" />
        </label>
        <label>
          Kategorie
          <select :value="patchOf(row).category ?? row.category" @change="patchOf(row).category = ($event.target as HTMLSelectElement).value as TermSuggestion['category']">
            <option v-for="name in CATEGORIES" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
      </div>

      <p v-if="row.explanation" class="mod__explanation">„{{ row.explanation }}“</p>

      <div class="mod__actions">
        <AppButton size="sm" variant="secondary" @click="saveEdits(row)">Speichern</AppButton>
        <AppButton size="sm" @click="convert(row, false)">In Pool (deaktiviert)</AppButton>
        <AppButton size="sm" @click="convert(row, true)">In Pool + aktivieren</AppButton>
        <AppButton size="sm" variant="ghost" @click="setStatus(row, 'in_review')">In Prüfung</AppButton>
        <AppButton size="sm" variant="ghost" @click="setStatus(row, 'duplicate')">Duplikat</AppButton>
        <AppButton size="sm" variant="ghost" @click="setStatus(row, 'rejected')">Ablehnen</AppButton>
      </div>
    </AppCard>
  </section>
</template>

<style scoped>
.mod {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.mod__filter {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.mod__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--s-3);
}

label {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

input,
select {
  width: 100%;
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
  input,
  select {
    font-size: 16px;
  }
}

.mod__explanation {
  margin-top: var(--s-3);
  font-size: var(--fs-sm);
  font-style: italic;
  color: var(--c-text-muted);
}

.mod__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-top: var(--s-4);
}

.mod__empty {
  padding: var(--s-6);
  text-align: center;
  color: var(--c-text-muted);
}
</style>
