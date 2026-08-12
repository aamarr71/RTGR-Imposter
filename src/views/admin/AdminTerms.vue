<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { CATEGORIES, REVIEW_STATUSES, type CategoryName, type ReviewStatus } from '@shared/config'
import { adminApi, type AdminTerm } from './adminApi'

/** Wort- und Kategorienverwaltung: suchen, filtern, bearbeiten, importieren, exportieren. */

const rows = ref<AdminTerm[]>([])
const total = ref(0)
const loading = ref(false)
const notice = ref<string | null>(null)
const problem = ref<string | null>(null)

const search = ref('')
const category = ref<CategoryName | ''>('')
const enabledFilter = ref<'' | 'true' | 'false'>('')
const reviewFilter = ref<ReviewStatus | ''>('')
const offset = ref(0)
const limit = 50

const emptyDraft = (): Partial<AdminTerm> => ({
  displayTerm: '',
  canonicalTerm: '',
  hintTerm: '',
  category: CATEGORIES[0],
  enabled: false,
  reviewStatus: 'needs_human_review',
})
const draft = ref<Partial<AdminTerm>>(emptyDraft())
const editingId = ref<string | null>(null)
const importText = ref('')

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const currentPage = computed(() => Math.floor(offset.value / limit) + 1)

async function load() {
  loading.value = true
  problem.value = null
  try {
    const result = await adminApi.terms({
      search: search.value || undefined,
      category: category.value || undefined,
      enabled: enabledFilter.value || undefined,
      reviewStatus: reviewFilter.value || undefined,
      limit,
      offset: offset.value,
    })
    rows.value = result.rows
    total.value = result.total
  } catch {
    problem.value = 'Wörter konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null
watch([search, category, enabledFilter, reviewFilter], () => {
  offset.value = 0
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(load, 250)
})

async function save() {
  problem.value = null
  try {
    if (editingId.value) await adminApi.updateTerm(editingId.value, draft.value)
    else await adminApi.createTerm(draft.value)
    notice.value = editingId.value ? 'Begriff aktualisiert.' : 'Begriff angelegt.'
    draft.value = emptyDraft()
    editingId.value = null
    await load()
  } catch (error) {
    problem.value = (error as Error).message
  }
}

function edit(term: AdminTerm) {
  editingId.value = term.id
  draft.value = { ...term }
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function toggle(term: AdminTerm) {
  await adminApi.updateTerm(term.id, { enabled: !term.enabled })
  await load()
}

async function remove(term: AdminTerm) {
  if (!window.confirm(`„${term.displayTerm}“ endgültig löschen?`)) return
  await adminApi.deleteTerm(term.id)
  await load()
}

async function runImport() {
  problem.value = null
  try {
    const trimmed = importText.value.trim()
    const payload = trimmed.startsWith('[')
      ? { rows: JSON.parse(trimmed) as unknown[] }
      : { csv: trimmed }
    const result = await adminApi.importTerms(payload)
    notice.value = `${result.created} importiert, ${result.skipped} übersprungen. Importe sind deaktiviert und als „needs_human_review“ markiert.`
    if (result.problems.length) problem.value = result.problems.join(' · ')
    importText.value = ''
    await load()
  } catch (error) {
    problem.value = (error as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section class="terms">
    <StatusNote v-if="notice" tone="success" icon="check">{{ notice }}</StatusNote>
    <StatusNote v-if="problem" tone="error" icon="alert">{{ problem }}</StatusNote>

    <AppCard :title="editingId ? 'Begriff bearbeiten' : 'Begriff anlegen'">
      <form class="terms__form" @submit.prevent="save">
        <input v-model="draft.displayTerm" placeholder="Angezeigter Begriff" required />
        <input v-model="draft.canonicalTerm" placeholder="Kanonische Bedeutung" required />
        <input v-model="draft.hintTerm" placeholder="Hinweiswort" required />
        <select v-model="draft.category">
          <option v-for="name in CATEGORIES" :key="name" :value="name">{{ name }}</option>
        </select>
        <select v-model="draft.reviewStatus">
          <option v-for="status in REVIEW_STATUSES" :key="status" :value="status">{{ status }}</option>
        </select>
        <label class="terms__check">
          <input v-model="draft.enabled" type="checkbox" /> aktiv
        </label>
        <div class="terms__formActions">
          <AppButton type="submit" size="sm">{{ editingId ? 'Speichern' : 'Anlegen' }}</AppButton>
          <AppButton
            v-if="editingId"
            size="sm"
            variant="ghost"
            @click="editingId = null; draft = emptyDraft()"
          >
            Abbrechen
          </AppButton>
        </div>
      </form>
    </AppCard>

    <AppCard title="Filter">
      <div class="terms__filters">
        <input v-model="search" type="search" placeholder="Suche …" />
        <select v-model="category">
          <option value="">Alle Kategorien</option>
          <option v-for="name in CATEGORIES" :key="name" :value="name">{{ name }}</option>
        </select>
        <select v-model="enabledFilter">
          <option value="">Aktiv & inaktiv</option>
          <option value="true">Nur aktiv</option>
          <option value="false">Nur inaktiv</option>
        </select>
        <select v-model="reviewFilter">
          <option value="">Jeder Reviewstatus</option>
          <option v-for="status in REVIEW_STATUSES" :key="status" :value="status">{{ status }}</option>
        </select>
        <a class="terms__export" href="/api/admin/terms/export?format=json">JSON-Export</a>
        <a class="terms__export" href="/api/admin/terms/export?format=csv">CSV-Export</a>
      </div>
    </AppCard>

    <AppCard :title="`Wörter (${total})`" :hint="loading ? 'Lädt …' : undefined">
      <div class="terms__tableWrap">
        <table class="terms__table">
          <thead>
            <tr>
              <th>Begriff</th>
              <th>Bedeutung</th>
              <th>Hinweis</th>
              <th>Kategorie</th>
              <th>Review</th>
              <th>Ziehungen</th>
              <th>Zuletzt</th>
              <th>Aktiv</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="term in rows" :key="term.id">
              <td class="is-strong">{{ term.displayTerm }}</td>
              <td>{{ term.canonicalTerm }}</td>
              <td>{{ term.hintTerm }}</td>
              <td>{{ term.category }}</td>
              <td>
                <span class="terms__badge" :class="`is-${term.reviewStatus}`">
                  {{ term.reviewStatus }}
                </span>
              </td>
              <td class="is-num">{{ term.drawCount }}</td>
              <td class="is-num">
                {{ term.lastUsedAt ? new Date(term.lastUsedAt).toLocaleDateString('de-DE') : '–' }}
              </td>
              <td>
                <button class="terms__toggle" type="button" @click="toggle(term)">
                  {{ term.enabled ? 'ja' : 'nein' }}
                </button>
              </td>
              <td class="terms__rowActions">
                <button type="button" @click="edit(term)">Bearbeiten</button>
                <button type="button" class="is-danger" @click="remove(term)">Löschen</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="terms__pager">
        <AppButton size="sm" variant="ghost" :disabled="offset === 0" @click="offset -= limit; load()">
          Zurück
        </AppButton>
        <span>Seite {{ currentPage }} / {{ pages }}</span>
        <AppButton
          size="sm"
          variant="ghost"
          :disabled="currentPage >= pages"
          @click="offset += limit; load()"
        >
          Weiter
        </AppButton>
      </div>
    </AppCard>

    <AppCard
      title="Import"
      hint="CSV mit Kopfzeile displayTerm,canonicalTerm,hintTerm,category oder ein JSON-Array. Importe werden immer deaktiviert und als zu prüfen angelegt."
    >
      <textarea v-model="importText" rows="6" placeholder="displayTerm,canonicalTerm,hintTerm,category" />
      <AppButton size="sm" :disabled="!importText.trim()" @click="runImport">Importieren</AppButton>
    </AppCard>
  </section>
</template>

<style scoped>
.terms {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.terms__form,
.terms__filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  align-items: center;
}

input,
select,
textarea {
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
  select,
  textarea {
    font-size: 16px;
  }
}

textarea {
  width: 100%;
  margin-bottom: var(--s-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.terms__check {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.terms__check input {
  min-height: auto;
  accent-color: var(--c-accent);
}

.terms__formActions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-left: auto;
}

.terms__export {
  padding: var(--s-2) var(--s-3);
  font-size: var(--fs-sm);
  border: 1px solid var(--c-line);
  border-radius: var(--r-sm);
}

.terms__tableWrap {
  overflow-x: auto;
}

.terms__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.terms__table th {
  padding: var(--s-2);
  text-align: left;
  font-weight: 600;
  color: var(--c-text-dim);
  border-bottom: 1px solid var(--c-line);
  white-space: nowrap;
}

.terms__table td {
  padding: var(--s-2);
  border-bottom: 1px solid var(--c-line);
  vertical-align: top;
}

.terms__table td.is-strong {
  font-weight: 650;
}

.terms__table td.is-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.terms__badge {
  padding: 2px 6px;
  font-size: 11px;
  border-radius: var(--r-pill);
  background: var(--c-surface-3);
  color: var(--c-text-muted);
  white-space: nowrap;
}

.terms__badge.is-approved {
  color: var(--c-success);
}

.terms__badge.is-rejected {
  color: var(--c-danger);
}

.terms__toggle {
  padding: 2px 8px;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  border: 1px solid currentcolor;
  border-radius: var(--r-pill);
}

.terms__rowActions {
  display: flex;
  gap: var(--s-2);
  white-space: nowrap;
}

.terms__rowActions button {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  text-decoration: underline;
}

.terms__rowActions button.is-danger {
  color: var(--c-danger);
}

.terms__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-4);
  margin-top: var(--s-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
</style>
