<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, LogIn, RefreshCw, Search, Trash2, XCircle } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@renderer/stores/app.ts'
import { toPlain } from '@shared/plain.ts'
import { siteConfigurationError, SITE_LABELS } from '@shared/sites.ts'
import type { MikanSearchItem, PublishSite, SiteLoginResult } from '@shared/types.ts'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiSecretInput from '@renderer/components/ui/UiSecretInput.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'

const props = defineProps<{ groupId: string; site: PublishSite }>()
const { t } = useI18n()
const app = useAppStore()

const group = computed(() => app.data.groups.find((item) => item.id === props.groupId))
const account = computed(() => group.value?.sites[props.site])
const forced = computed(() => props.site === 'anibt' && app.data.settings.publishMode === 'anibt')
const cookieSite = computed(() => props.site === 'dmhy' || props.site === 'bangumiMoe')

type CheckDisplay = { ok: boolean; verified: boolean; text: string }
type MikanGroupSearchRow = {
  key: string
  name: string
  subtitleGroup?: MikanSearchItem
  publishGroup?: MikanSearchItem
}

const checkingSites = ref<Record<string, boolean>>({})
const loggingInSites = ref<Record<string, boolean>>({})
const clearingSites = ref<Record<string, boolean>>({})
const results = ref<Record<string, CheckDisplay | null>>({})
const resultKey = computed(() => `${props.groupId}:${props.site}`)
const checking = computed(() => checkingSites.value[resultKey.value] === true)
const loggingIn = computed(() => loggingInSites.value[resultKey.value] === true)
const clearing = computed(() => clearingSites.value[resultKey.value] === true)
const result = computed(() => results.value[resultKey.value] ?? null)
const searchQuery = ref('')
const searching = ref(false)
const searchResults = ref<MikanGroupSearchRow[]>([])
const subtitleGroupIdText = ref('')
const publishGroupIdText = ref('')
const captchaCodes = ref<Record<string, string>>({})
const captchaImages = ref<Record<string, string>>({})
const captchaLoadingSites = ref<Record<string, boolean>>({})
const captchaCode = computed({
  get: () => captchaCodes.value[resultKey.value] ?? '',
  set: (value: string) => {
    captchaCodes.value[resultKey.value] = value
  }
})
const captchaImage = computed(() => captchaImages.value[resultKey.value] ?? '')
const captchaLoading = computed(() => captchaLoadingSites.value[resultKey.value] === true)

function syncMikanIdText(): void {
  subtitleGroupIdText.value = account.value?.subtitleGroupId == null ? '' : String(account.value.subtitleGroupId)
  publishGroupIdText.value = account.value?.publishGroupId == null ? '' : String(account.value.publishGroupId)
}

watch(() => `${props.groupId}:${props.site}`, syncMikanIdText, { immediate: true })

function updateMikanId(field: 'subtitleGroupId' | 'publishGroupId', value: string): void {
  if (!account.value) return
  if (field === 'subtitleGroupId') subtitleGroupIdText.value = value
  else publishGroupIdText.value = value
  const trimmed = value.trim()
  if (!trimmed) {
    account.value[field] = null
    if (field === 'subtitleGroupId') account.value.subtitleGroupName = ''
    else account.value.publishGroupName = ''
  } else if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) {
    const next = Number(trimmed)
    if (account.value[field] !== next) {
      if (field === 'subtitleGroupId') account.value.subtitleGroupName = ''
      else account.value.publishGroupName = ''
    }
    account.value[field] = next
  }
}

function normalizeMikanId(field: 'subtitleGroupId' | 'publishGroupId'): void {
  if (!account.value) return
  const text = field === 'subtitleGroupId' ? subtitleGroupIdText : publishGroupIdText
  const trimmed = text.value.trim()
  const next = /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : null
  account.value[field] = next
  text.value = next === null ? '' : String(next)
  if (next === null) {
    if (field === 'subtitleGroupId') account.value.subtitleGroupName = ''
    else account.value.publishGroupName = ''
  }
}

function setEnabled(value: boolean): void {
  if (!account.value || forced.value) return
  account.value.enabled = value
}

async function check(): Promise<void> {
  if (!account.value) return
  const site = props.site
  const key = resultKey.value
  const current = account.value
  const missing = siteConfigurationError(site, current)
  if (missing) {
    results.value[key] = { ok: false, verified: true, text: missing }
    current.status = missing
    return
  }
  checkingSites.value[key] = true
  results.value[key] = null
  try {
    const response = await window.api.checkSite(site, toPlain(current))
    results.value[key] = { ok: response.ok, verified: response.verified !== false, text: response.message }
    current.lastCheckedAt = Date.now()
    current.status = response.ok && response.verified !== false ? t('accounts.checkOk') : response.message
    if (response.identityName) current.identityName = response.identityName
    if (response.slug) current.slug = response.slug
    if (response.scopes) current.scopes = [...response.scopes]
  } finally {
    checkingSites.value[key] = false
  }
}

function applyLoginResult(current: NonNullable<typeof account.value>, response: SiteLoginResult, key = resultKey.value): void {
  current.cookies = [...response.cookies]
  if (response.userAgent) current.userAgent = response.userAgent
  if (response.ok) {
    current.status = t('accounts.loginCaptured')
    current.lastCheckedAt = Date.now()
  } else {
    current.status = response.message ?? t('accounts.checkFail')
  }
  results.value[key] = {
    ok: response.ok,
    verified: true,
    text: response.ok ? t('accounts.loginCaptured') : (response.message ?? t('accounts.checkFail'))
  }
}

async function loadDmhyCaptcha(reportError = true): Promise<boolean> {
  if (!account.value || props.site !== 'dmhy') return false
  const key = resultKey.value
  const current = account.value
  captchaLoadingSites.value[key] = true
  try {
    const response = await window.api.getDmhyCaptcha(props.groupId, toPlain(current))
    if (response.ok && response.dataUrl) {
      captchaImages.value[key] = response.dataUrl
      captchaCodes.value[key] = ''
      return true
    }
    if (reportError) {
      results.value[key] = { ok: false, verified: true, text: response.message ?? t('accounts.captchaLoadFailed') }
    }
    return false
  } catch (error) {
    if (reportError) results.value[key] = { ok: false, verified: true, text: String(error) }
    return false
  } finally {
    captchaLoadingSites.value[key] = false
  }
}

async function loginWithCredentials(): Promise<void> {
  if (!account.value) return
  const site = props.site
  const key = resultKey.value
  const current = account.value
  if (site === 'dmhy' && !captchaCode.value.trim()) {
    if (!captchaImage.value && !(await loadDmhyCaptcha())) return
    results.value[key] = { ok: false, verified: true, text: t('accounts.captchaRequired') }
    return
  }
  loggingInSites.value[key] = true
  results.value[key] = null
  try {
    const response = await window.api.loginSite(
      props.groupId,
      site,
      toPlain(current),
      site === 'dmhy' ? captchaCode.value.trim() : ''
    )
    applyLoginResult(current, response, key)
    if (site === 'dmhy') {
      captchaCodes.value[key] = ''
      if (!response.ok) await loadDmhyCaptcha(false)
    }
  } catch (error) {
    results.value[key] = { ok: false, verified: true, text: String(error) }
  } finally {
    loggingInSites.value[key] = false
  }
}

async function openWebLogin(): Promise<void> {
  if (!account.value) return
  const site = props.site
  const key = resultKey.value
  const current = account.value
  loggingInSites.value[key] = true
  results.value[key] = null
  try {
    applyLoginResult(current, await window.api.openSiteLogin(props.groupId, site, toPlain(current)))
  } catch (error) {
    results.value[key] = { ok: false, verified: true, text: String(error) }
  } finally {
    loggingInSites.value[key] = false
  }
}

async function clearCookies(): Promise<void> {
  if (!account.value) return
  const key = resultKey.value
  const current = account.value
  clearingSites.value[key] = true
  try {
    await window.api.clearSiteCookies(props.groupId, props.site)
    current.cookies = []
    current.status = t('accounts.cookiesCleared')
    results.value[key] = { ok: true, verified: true, text: t('accounts.cookiesCleared') }
  } catch (error) {
    results.value[key] = { ok: false, verified: true, text: String(error) }
  } finally {
    clearingSites.value[key] = false
  }
}

async function searchMikan(): Promise<void> {
  const query = searchQuery.value.trim()
  if (!query) return
  searching.value = true
  try {
    const [subtitle, publish] = await Promise.all([
      window.api.searchMikan('subtitleGroup', query),
      window.api.searchMikan('publishGroup', query)
    ])
    const rows = new Map<string, MikanGroupSearchRow>()
    for (const item of subtitle.ok ? (subtitle.data ?? []) : []) {
      const key = item.name.trim().toLocaleLowerCase()
      rows.set(key, { key, name: item.name, subtitleGroup: item })
    }
    for (const item of publish.ok ? (publish.data ?? []) : []) {
      const key = item.name.trim().toLocaleLowerCase()
      const current = rows.get(key)
      rows.set(key, current ? { ...current, publishGroup: item } : { key, name: item.name, publishGroup: item })
    }
    searchResults.value = [...rows.values()]
  } finally {
    searching.value = false
  }
}

function pickMikan(kind: 'subtitleGroup' | 'publishGroup', item: MikanSearchItem): void {
  if (!account.value) return
  if (kind === 'subtitleGroup') {
    account.value.subtitleGroupId = item.id
    account.value.subtitleGroupName = item.name
    subtitleGroupIdText.value = String(item.id)
  } else {
    account.value.publishGroupId = item.id
    account.value.publishGroupName = item.name
    publishGroupIdText.value = String(item.id)
  }
}
</script>

<template>
  <div v-if="account" class="flex min-w-0 flex-col gap-4" data-probe="site-account-editor" :data-site="site">
    <div class="flex items-center justify-between border-b pb-3">
      <div>
        <h3 class="font-medium">{{ SITE_LABELS[site] }}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t(`accounts.siteHint.${site}`) }}</p>
      </div>
      <label class="flex items-center gap-2 text-sm" :class="forced ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'">
        <UiSwitch data-probe="site-enabled-switch" :model-value="forced || account.enabled" :disabled="forced" @update:model-value="setEnabled" />
        {{ forced ? t('accounts.forcedEnabled') : t('accounts.enabled') }}
      </label>
    </div>

    <template v-if="site === 'anibt'">
      <div class="flex flex-col gap-1.5">
        <UiLabel>{{ t('accounts.apiKey') }}</UiLabel>
        <UiSecretInput v-model="account.apiKey" class="font-mono" :placeholder="t('accounts.apiKeyHint')" />
      </div>
      <div v-if="account.slug || account.scopes.length" class="flex flex-wrap gap-1.5">
        <UiBadge v-if="account.slug" variant="secondary">{{ account.slug }}</UiBadge>
        <UiBadge v-for="scope in account.scopes" :key="scope" variant="outline">{{ scope }}</UiBadge>
      </div>
    </template>

    <template v-else-if="site === 'mikan'">
      <div class="flex flex-col gap-1.5">
        <UiLabel>API Token</UiLabel>
        <UiSecretInput v-model="account.apiToken" class="font-mono" />
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1.5" @focusout="normalizeMikanId('subtitleGroupId')">
          <UiLabel>{{ t('accounts.subtitleGroupId') }}（{{ t('common.optional') }}）</UiLabel>
          <UiInput
            data-probe="mikan-subtitle-group-id"
            :model-value="subtitleGroupIdText"
            @update:model-value="(v: string) => updateMikanId('subtitleGroupId', v)"
          />
          <span v-if="account.subtitleGroupName" class="text-xs text-muted-foreground">{{ account.subtitleGroupName }}</span>
        </div>
        <div class="flex flex-col gap-1.5" @focusout="normalizeMikanId('publishGroupId')">
          <UiLabel>{{ t('accounts.publishGroupId') }}（{{ t('common.optional') }}）</UiLabel>
          <UiInput
            data-probe="mikan-publish-group-id"
            :model-value="publishGroupIdText"
            @update:model-value="(v: string) => updateMikanId('publishGroupId', v)"
          />
          <span v-if="account.publishGroupName" class="text-xs text-muted-foreground">{{ account.publishGroupName }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <UiInput v-model="searchQuery" :placeholder="t('accounts.mikanGroupSearch')" @keydown.enter="searchMikan" />
        <UiButton variant="outline" :disabled="searching || !searchQuery.trim()" @click="searchMikan">
          <Loader2 v-if="searching" class="h-4 w-4 animate-spin" />
          <Search v-else class="h-4 w-4" />
          {{ t('accounts.searchId') }}
        </UiButton>
      </div>
      <div v-if="searchResults.length" class="max-h-40 overflow-y-auto rounded-md border" data-probe="mikan-search-results">
        <div class="grid grid-cols-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <span>{{ t('accounts.subtitleGroupId') }}</span>
          <span>{{ t('accounts.publishGroupId') }}</span>
        </div>
        <div
          v-for="row in searchResults"
          :key="row.key"
          class="grid grid-cols-2 border-b text-sm last:border-b-0"
        >
          <button
            class="min-w-0 cursor-pointer px-3 py-2 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
            :disabled="!row.subtitleGroup"
            @click="row.subtitleGroup && pickMikan('subtitleGroup', row.subtitleGroup)"
          >
            <span v-if="row.subtitleGroup" class="block truncate">{{ row.subtitleGroup.name }}</span>
            <span class="font-mono text-xs text-muted-foreground">{{ row.subtitleGroup?.id ?? '—' }}</span>
          </button>
          <button
            class="min-w-0 cursor-pointer border-l px-3 py-2 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
            :disabled="!row.publishGroup"
            @click="row.publishGroup && pickMikan('publishGroup', row.publishGroup)"
          >
            <span v-if="row.publishGroup" class="block truncate">{{ row.publishGroup.name }}</span>
            <span class="font-mono text-xs text-muted-foreground">{{ row.publishGroup?.id ?? '—' }}</span>
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="site === 'acgrip'">
      <div class="flex flex-col gap-1.5">
        <UiLabel>API URL</UiLabel>
        <UiInput v-model="account.apiUrl" class="font-mono" placeholder="https://acg.rip/api/post" />
      </div>
      <div class="flex flex-col gap-1.5">
        <UiLabel>API Token</UiLabel>
        <UiSecretInput v-model="account.apiToken" class="font-mono" />
        <span class="text-xs text-muted-foreground">{{ t('accounts.acgripTokenHint') }}</span>
      </div>
    </template>

    <template v-else-if="site === 'acgnxAsia' || site === 'acgnxGlobal'">
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1.5"><UiLabel>UID</UiLabel><UiInput v-model="account.uid" /></div>
        <div class="flex flex-col gap-1.5"><UiLabel>API Token</UiLabel><UiSecretInput v-model="account.apiToken" class="font-mono" /></div>
      </div>
    </template>

    <template v-else-if="site === 'nyaa'">
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1.5"><UiLabel>{{ t('accounts.username') }}</UiLabel><UiInput v-model="account.username" /></div>
        <div class="flex flex-col gap-1.5"><UiLabel>{{ t('accounts.password') }}</UiLabel><UiSecretInput v-model="account.password" /></div>
      </div>
      <label class="flex cursor-pointer items-center gap-2 text-sm" data-probe="nyaa-anonymous">
        <UiSwitch v-model="account.anonymous" /> {{ t('accounts.anonymousPublish') }}
      </label>
    </template>

    <template v-else-if="cookieSite">
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1.5"><UiLabel>{{ t('accounts.username') }}</UiLabel><UiInput v-model="account.username" /></div>
        <div class="flex flex-col gap-1.5"><UiLabel>{{ t('accounts.password') }}</UiLabel><UiSecretInput v-model="account.password" /></div>
      </div>
      <div v-if="site === 'dmhy' || site === 'bangumiMoe'" class="flex flex-col gap-1.5">
        <UiLabel>{{ t('accounts.identityName') }}</UiLabel>
        <UiInput v-model="account.identityName" :placeholder="t('accounts.identityHint')" />
      </div>
      <div v-if="site === 'dmhy'" class="flex flex-col gap-1.5" data-probe="dmhy-captcha">
        <UiLabel>{{ t('accounts.captcha') }}</UiLabel>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex h-12 w-32 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-white text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-wait"
            :disabled="captchaLoading"
            :aria-label="t('accounts.loadCaptcha')"
            data-probe="dmhy-captcha-image"
            @click="loadDmhyCaptcha()"
          >
            <img v-if="captchaImage" :src="captchaImage" :alt="t('accounts.captcha')" class="max-h-full max-w-full object-contain" />
            <Loader2 v-else-if="captchaLoading" class="h-4 w-4 animate-spin" />
            <span v-else>{{ t('accounts.loadCaptcha') }}</span>
          </button>
          <UiInput
            v-model="captchaCode"
            class="min-w-0 flex-1"
            :placeholder="t('accounts.captchaHint')"
            data-probe="dmhy-captcha-input"
            @keydown.enter="loginWithCredentials"
          />
          <UiTooltip :content="t('accounts.refreshCaptcha')">
            <UiButton
              variant="outline"
              size="icon"
              :disabled="captchaLoading"
              :aria-label="t('accounts.refreshCaptcha')"
              data-probe="dmhy-captcha-refresh"
              @click="loadDmhyCaptcha()"
            >
              <RefreshCw class="h-4 w-4" :class="captchaLoading ? 'animate-spin' : ''" />
            </UiButton>
          </UiTooltip>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UiButton
          variant="outline"
          data-probe="site-credential-login"
          :disabled="loggingIn || clearing || captchaLoading || !account.username.trim() || !account.password"
          @click="loginWithCredentials"
        >
          <Loader2 v-if="loggingIn" class="h-4 w-4 animate-spin" /><LogIn v-else class="h-4 w-4" />
          {{ loggingIn ? t('accounts.loggingIn') : t('accounts.login') }}
        </UiButton>
        <UiButton variant="outline" data-probe="site-open-login" :disabled="loggingIn || clearing" @click="openWebLogin">
          <ExternalLink class="h-4 w-4" />
          {{ t('accounts.openLogin') }}
        </UiButton>
        <UiButton variant="outline" data-probe="site-clear-cookies" :disabled="loggingIn || clearing" @click="clearCookies">
          <Loader2 v-if="clearing" class="h-4 w-4 animate-spin" /><Trash2 v-else class="h-4 w-4" />
          {{ t('accounts.clearCookies') }}
        </UiButton>
        <UiBadge :variant="account.cookies.length ? 'default' : 'secondary'">
          {{ account.cookies.length ? t('accounts.cookiesCaptured', { count: account.cookies.length }) : t('accounts.noCookies') }}
        </UiBadge>
      </div>
    </template>

    <div class="flex items-center gap-3 border-t pt-3">
      <UiButton variant="outline" :disabled="checking" @click="check">
        <Loader2 v-if="checking" class="h-4 w-4 animate-spin" />
        {{ checking ? t('accounts.checking') : t('accounts.checkNow') }}
      </UiButton>
      <span
        v-if="result"
        class="flex min-w-0 items-center gap-1.5 text-sm"
        :class="!result.verified ? 'text-amber-600' : result.ok ? 'text-green-600' : 'text-destructive'"
      >
        <AlertCircle v-if="!result.verified" class="h-4 w-4 shrink-0" />
        <CheckCircle2 v-else-if="result.ok" class="h-4 w-4 shrink-0" />
        <XCircle v-else class="h-4 w-4 shrink-0" />
        <span class="break-all">{{ result.text }}</span>
      </span>
    </div>
  </div>
</template>
