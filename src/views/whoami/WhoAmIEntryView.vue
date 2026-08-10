<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QrScanner from '@/components/whoami/QrScanner.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import MenuRow from '@/components/ui/MenuRow.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import TextField from '@/components/ui/TextField.vue'
import { t, tDynamic } from '@/i18n'
import { PLAYER_NAME, WHO_AM_I } from '@shared/config'
import { isValidRoomCode, normalizeRoomCode, validatePlayerName } from '@shared/validation'
import { HttpError, NetworkError } from '@/services/http'
import { lastMembership } from '@/services/roomSync'
import { useRoomStore } from '@/stores/room'

/** Einstieg: Raum erstellen oder beitreten – plus Rückkehr in einen bekannten Raum. */
const room = useRoomStore()
const route = useRoute()
const router = useRouter()

function roomCodeFromQuery(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  const normalized = normalizeRoomCode(typeof raw === 'string' ? raw : '')
  return isValidRoomCode(normalized) ? normalized : null
}

const requestedCode = roomCodeFromQuery(route.query.code)

// QR- und geteilte Links führen erst über /room/:code. Ohne Membership leitet
// die Raumansicht hierher um; der Code muss dann bereits im Join-Formular stehen.
const mode = ref<'choose' | 'create' | 'join'>(requestedCode ? 'join' : 'choose')
const name = ref('')
const code = ref(requestedCode ?? '')
const error = ref<string | null>(null)
const busy = ref(false)
const scannerOpen = ref(false)

// Vue Router verwendet dieselbe Komponenteninstanz wieder, wenn nur die Query
// wechselt. Ein später geöffneter QR-/Deep-Link muss deshalb reaktiv ankommen.
watch(
  () => route.query.code,
  (value) => {
    const next = roomCodeFromQuery(value)
    if (!next) {
      code.value = ''
      mode.value = 'choose'
      error.value = null
      scannerOpen.value = false
      return
    }
    code.value = next
    mode.value = 'join'
    error.value = null
  },
)

const previous = lastMembership()

const nameValid = computed(() => validatePlayerName(name.value).ok)
const codeValid = computed(() => isValidRoomCode(normalizeRoomCode(code.value)))

function describe(cause: unknown): string {
  if (cause instanceof HttpError) {
    return tDynamic(
      `whoami.error.${cause.code}`,
      { max: WHO_AM_I.maxPlayers, length: WHO_AM_I.roomCodeLength },
      cause.message,
    )
  }
  if (cause instanceof NetworkError) return t('whoami.conn.lost')
  return t('common.error')
}

async function createRoom() {
  error.value = null
  busy.value = true
  try {
    const created = await room.create(name.value)
    await router.replace({ name: 'whoami-room', params: { code: created } })
  } catch (cause) {
    error.value = describe(cause)
  } finally {
    busy.value = false
  }
}

async function joinRoom() {
  error.value = null
  busy.value = true
  try {
    const joined = await room.join(normalizeRoomCode(code.value), name.value)
    await router.replace({ name: 'whoami-room', params: { code: joined } })
  } catch (cause) {
    error.value = describe(cause)
  } finally {
    busy.value = false
  }
}

function onScanned(scanned: string) {
  code.value = scanned
  scannerOpen.value = false
}
</script>

<template>
  <main class="page entry">
    <!-- Aus dem Formular führt Zurück eine Stufe hoch, nicht direkt zur Startseite. -->
    <AppHeader
      :title="t('whoami.entry.title')"
      :intercept-back="mode !== 'choose'"
      back-to="/"
      @back="mode = 'choose'"
    />

    <template v-if="mode === 'choose'">
      <div class="entry__choices">
        <AppButton size="lg" block @click="mode = 'create'">
          <template #icon><AppIcon name="plus" :size="19" /></template>
          {{ t('whoami.entry.create') }}
        </AppButton>
        <AppButton size="lg" variant="secondary" block @click="mode = 'join'">
          <template #icon><AppIcon name="qr" :size="19" /></template>
          {{ t('whoami.entry.join') }}
        </AppButton>
      </div>

      <MenuRow
        v-if="previous"
        :label="t('whoami.entry.rejoin', { code: previous.code })"
        icon="refresh"
        :to="{ name: 'whoami-room', params: { code: previous.code } }"
      />
    </template>

    <AppCard v-else>
      <form class="entry__form" @submit.prevent="mode === 'create' ? createRoom() : joinRoom()">
        <template v-if="mode === 'join'">
          <TextField
            v-model="code"
            :label="t('whoami.entry.code')"
            :placeholder="t('whoami.entry.codePlaceholder')"
            :maxlength="WHO_AM_I.roomCodeLength"
            align="center"
            uppercase
            autocomplete="off"
          />
          <AppButton variant="ghost" block @click="scannerOpen = !scannerOpen">
            <template #icon><AppIcon name="camera" :size="18" /></template>
            {{ t('whoami.entry.scan') }}
          </AppButton>
          <QrScanner v-if="scannerOpen" @detected="onScanned" @close="scannerOpen = false" />
        </template>

        <TextField
          v-model="name"
          :label="t('whoami.entry.name')"
          :placeholder="t('whoami.entry.namePlaceholder')"
          :maxlength="PLAYER_NAME.maxLength"
          autocomplete="nickname"
        />

        <StatusNote v-if="error" tone="error" icon="alert">{{ error }}</StatusNote>

        <AppButton
          type="submit"
          size="lg"
          block
          :loading="busy"
          :disabled="!nameValid || (mode === 'join' && !codeValid)"
        >
          {{ mode === 'create' ? t('whoami.entry.create') : t('whoami.entry.join') }}
        </AppButton>
      </form>
    </AppCard>
  </main>
</template>

<style scoped>
.entry {
  gap: var(--s-4);
}

.entry__choices {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.entry__form {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}
</style>
