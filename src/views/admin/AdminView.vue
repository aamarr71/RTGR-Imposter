<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AdminAnalytics from './AdminAnalytics.vue'
import AdminSuggestions from './AdminSuggestions.vue'
import AdminTerms from './AdminTerms.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import TextField from '@/components/ui/TextField.vue'
import { HttpError } from '@/services/http'
import { adminApi } from './adminApi'

/**
 * Admin-Dashboard.
 *
 * Die Anmeldung schützt ausschließlich die Darstellung – jede API-Route prüft
 * die Session serverseitig noch einmal. Ein manipuliertes Frontend gewinnt
 * dadurch nichts.
 */
type Tab = 'terms' | 'suggestions' | 'analytics'

const authenticated = ref(false)
const checking = ref(true)
const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
const storeKind = ref('')
const tab = ref<Tab>('terms')

async function check() {
  checking.value = true
  try {
    const session = await adminApi.session()
    storeKind.value = session.store
    username.value = session.username
    authenticated.value = true
  } catch {
    authenticated.value = false
  } finally {
    checking.value = false
  }
}

async function login() {
  error.value = null
  busy.value = true
  try {
    await adminApi.login(username.value, password.value)
    password.value = ''
    await check()
  } catch (cause) {
    if (cause instanceof HttpError && cause.code === 'admin_not_configured') {
      error.value =
        'Adminzugang ist nicht eingerichtet: ADMIN_USERNAME und ADMIN_PASSWORD_HASH setzen.'
    } else if (cause instanceof HttpError && cause.code === 'rate_limited') {
      error.value = 'Zu viele Fehlversuche. Bitte später erneut probieren.'
    } else {
      error.value = 'Benutzername oder Passwort falsch.'
    }
  } finally {
    busy.value = false
  }
}

async function logout() {
  await adminApi.logout().catch(() => undefined)
  authenticated.value = false
}

onMounted(check)
</script>

<template>
  <main class="page page--wide admin">
    <p v-if="checking" class="admin__loading">Lädt …</p>

    <!-- Anmeldung -->
    <div v-else-if="!authenticated" class="admin__login">
      <AppCard title="Admin">
        <form class="admin__form" @submit.prevent="login">
          <TextField v-model="username" label="Benutzername" autocomplete="username" />
          <TextField
            v-model="password"
            label="Passwort"
            type="password"
            autocomplete="current-password"
          />
          <StatusNote v-if="error" tone="error" icon="alert">{{ error }}</StatusNote>
          <AppButton type="submit" size="lg" block :loading="busy">Anmelden</AppButton>
        </form>
      </AppCard>
    </div>

    <!-- Dashboard -->
    <template v-else>
      <header class="admin__head">
        <div>
          <h1 class="admin__title">Admin · komm 10te</h1>
          <p class="admin__sub">
            Angemeldet als {{ username }} · Speicher: {{ storeKind }}
          </p>
        </div>
        <AppButton size="sm" variant="ghost" @click="logout">Abmelden</AppButton>
      </header>

      <StatusNote v-if="storeKind === 'memory'" tone="warn" icon="alert">
        In-Memory-Speicher aktiv – Änderungen überleben keinen Neustart. Für persistente Daten
        <code>DATABASE_URL</code> setzen und <code>npm run db:migrate</code> ausführen.
      </StatusNote>

      <nav class="admin__tabs">
        <button :class="{ 'is-on': tab === 'terms' }" type="button" @click="tab = 'terms'">
          Wörter
        </button>
        <button :class="{ 'is-on': tab === 'suggestions' }" type="button" @click="tab = 'suggestions'">
          Vorschläge
        </button>
        <button :class="{ 'is-on': tab === 'analytics' }" type="button" @click="tab = 'analytics'">
          Analytics
        </button>
      </nav>

      <AdminTerms v-if="tab === 'terms'" />
      <AdminSuggestions v-else-if="tab === 'suggestions'" />
      <AdminAnalytics v-else />
    </template>
  </main>
</template>

<style scoped>
.admin {
  gap: var(--s-4);
}

.admin__loading {
  padding: var(--s-8);
  text-align: center;
  color: var(--c-text-muted);
}

.admin__login {
  max-width: 400px;
  margin: auto;
  width: 100%;
}

.admin__form {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.admin__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
}

.admin__head > div {
  flex: 1 1 240px;
  min-width: 0;
}

.admin__title {
  font-size: var(--fs-xl);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.admin__sub {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  overflow-wrap: anywhere;
}

.admin__tabs {
  display: flex;
  gap: var(--s-1);
  padding: var(--s-1);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
}

.admin__tabs button {
  flex: 1;
  min-height: 40px;
  font-weight: 600;
  color: var(--c-text-muted);
  border-radius: var(--r-sm);
}

.admin__tabs button.is-on {
  color: #04120f;
  background: var(--c-accent);
}

@media (max-width: 380px) {
  .admin__tabs {
    flex-direction: column;
  }
}
</style>
