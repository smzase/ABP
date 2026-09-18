<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, CheckCircle2, RefreshCw, XCircle } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiSecretInput from '@renderer/components/ui/UiSecretInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiSelect from '@renderer/components/ui/UiSelect.vue'
import UiSelectItem from '@renderer/components/ui/UiSelectItem.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import { cn } from '@renderer/lib/utils.ts'
import { toPlain } from '@shared/plain.ts'
import type { ProxySettings as ProxySettingsType } from '@shared/types.ts'
import { SITE_LABELS, SITE_URLS } from '@shared/sites.ts'
import { PUBLISH_SITES, type PublishSite, type SiteConnectionResult } from '@shared/types.ts'

/** 代理设置：跟随系统 / 直连 / 自定义（HTTP、HTTPS、SOCKS5），默认可选用户名密码，带测试按钮 */
const { t } = useI18n()
const app = useAppStore()

const proxy = app.data.settings.proxy

const testingAll = ref(false)
const testingSites = ref<Partial<Record<PublishSite, boolean>>>({})
const testing = computed(() => testingAll.value || Object.values(testingSites.value).some(Boolean))
const siteResults = ref<Partial<Record<PublishSite, SiteConnectionResult>>>({})

/**
 * 端口输入保留原始文本：直接把 store 里的数字回灌输入框的话，
 * 任何一次非法中间态（清空、首字符是 0、暂时超出 65535）都会被拒绝并弹回旧值 ——
 * 用户会觉得「删得掉但打不进去」。这里只在解析成功时同步到 store，失焦再兜底。
 */
const portText = ref(String(proxy.port))
watch(portText, (v) => {
  const n = Number(v.trim())
  if (Number.isInteger(n) && n > 0 && n < 65536) proxy.port = n
})
function onPortBlur(): void {
  const n = Number(portText.value.trim())
  if (!Number.isInteger(n) || n <= 0 || n >= 65536) portText.value = String(proxy.port)
}

function setMode(mode: ProxySettingsType['mode']): void {
  proxy.mode = mode
}

function clearSiteResult(site: PublishSite): void {
  const next = { ...siteResults.value }
  delete next[site]
  siteResults.value = next
}

async function runSiteTest(site: PublishSite): Promise<void> {
  if (testingSites.value[site]) return
  testingSites.value = { ...testingSites.value, [site]: true }
  clearSiteResult(site)
  try {
    const result = await window.api.testProxySite(site)
    siteResults.value = { ...siteResults.value, [site]: result }
  } catch (error) {
    siteResults.value = {
      ...siteResults.value,
      [site]: { site, ok: false, error: String(error) }
    }
  } finally {
    testingSites.value = { ...testingSites.value, [site]: false }
  }
}

async function testAll(): Promise<void> {
  if (testing.value) return
  testingAll.value = true
  siteResults.value = {}
  try {
    await window.api.applyProxy(toPlain(proxy))
    await Promise.all(PUBLISH_SITES.map((site) => runSiteTest(site)))
  } catch (error) {
    siteResults.value = Object.fromEntries(
      PUBLISH_SITES.map((site) => [site, { site, ok: false, error: String(error) }])
    ) as Record<PublishSite, SiteConnectionResult>
  } finally {
    testingAll.value = false
  }
}

async function testOne(site: PublishSite): Promise<void> {
  if (testingSites.value[site]) return
  try {
    await window.api.applyProxy(toPlain(proxy))
    await runSiteTest(site)
  } catch (error) {
    siteResults.value = { ...siteResults.value, [site]: { site, ok: false, error: String(error) } }
  }
}

function siteResult(site: PublishSite): SiteConnectionResult | undefined {
  return siteResults.value[site]
}

const MODES: Array<{ key: ProxySettingsType['mode']; labelKey: string }> = [
  { key: 'system', labelKey: 'settings.proxySystem' },
  { key: 'direct', labelKey: 'settings.proxyDirect' },
  { key: 'custom', labelKey: 'settings.proxyCustom' }
]
</script>

<template>
  <div class="flex max-w-xl flex-col gap-4">
    <UiCard class="p-4">
      <UiLabel class="mb-3 block">{{ t('settings.proxyMode') }}</UiLabel>
      <div class="flex gap-2">
        <button
          v-for="m in MODES"
          :key="m.key"
          class="flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors"
          :class="cn(proxy.mode === m.key ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')"
          @click="setMode(m.key)"
        >
          {{ t(m.labelKey) }}
        </button>
      </div>
    </UiCard>

    <UiCard v-if="proxy.mode === 'custom'" class="flex flex-col gap-3 p-4">
      <div class="flex flex-col gap-1.5">
        <UiLabel>{{ t('settings.proxyType') }}</UiLabel>
        <UiSelect
          :model-value="proxy.type"
          class="w-40"
          @update:model-value="(v: string) => (proxy.type = v as ProxySettingsType['type'])"
        >
          <UiSelectItem value="HTTP">HTTP</UiSelectItem>
          <UiSelectItem value="HTTPS">HTTPS</UiSelectItem>
          <UiSelectItem value="SOCKS5">SOCKS5</UiSelectItem>
        </UiSelect>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2 flex flex-col gap-1.5">
          <UiLabel>{{ t('settings.proxyHost') }}</UiLabel>
          <UiInput v-model="proxy.host" placeholder="127.0.0.1" />
        </div>
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('settings.proxyPort') }}</UiLabel>
          <UiInput v-model="portText" placeholder="7890" @blur="onPortBlur" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('settings.proxyUser') }}（{{ t('common.optional') }}）</UiLabel>
          <UiInput v-model="proxy.username" />
        </div>
        <div class="flex flex-col gap-1.5">
          <UiLabel>{{ t('settings.proxyPass') }}（{{ t('common.optional') }}）</UiLabel>
          <UiSecretInput v-model="proxy.password" />
        </div>
      </div>
    </UiCard>

    <div class="flex items-center gap-3">
      <UiButton variant="outline" :disabled="testing" @click="testAll">
        <Loader2 v-if="testingAll" class="h-4 w-4 animate-spin" />
        {{ testingAll ? t('settings.testing') : t('settings.testProxy') }}
      </UiButton>
    </div>
    <div class="flex flex-col gap-2" data-probe="proxy-site-results">
      <div
        v-for="site in PUBLISH_SITES"
        :key="site"
        class="flex min-h-12 items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"
        :data-proxy-site="site"
      >
        <div class="min-w-0">
          <div class="font-medium">{{ SITE_LABELS[site] }}</div>
          <a
            :href="SITE_URLS[site]"
            target="_blank"
            rel="noreferrer"
            class="block break-all text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            {{ SITE_URLS[site] }}
          </a>
        </div>
        <div class="flex min-w-0 shrink-0 items-center justify-end gap-2">
          <span
            v-if="siteResult(site)"
            class="flex max-w-72 min-w-0 items-center gap-1.5"
            :class="siteResult(site)?.ok ? 'text-green-600' : 'text-destructive'"
          >
            <CheckCircle2 v-if="siteResult(site)?.ok" class="h-3.5 w-3.5 shrink-0" />
            <XCircle v-else class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">
              {{ siteResult(site)?.ok ? `${siteResult(site)?.latencyMs ?? 0}ms` : (siteResult(site)?.error || t('settings.testFail')) }}
            </span>
          </span>
          <span v-else class="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            <Loader2 v-if="testingSites[site]" class="h-3.5 w-3.5 animate-spin" />
            {{ testingSites[site] ? t('settings.testing') : t('settings.notTested') }}
          </span>
          <UiButton
            variant="ghost"
            size="icon"
            class="h-8 w-8 shrink-0"
            data-probe="proxy-site-test"
            :data-testing="testingSites[site] ? 'true' : 'false'"
            :disabled="testingSites[site]"
            :title="`${t('settings.testProxy')} · ${SITE_LABELS[site]}`"
            :aria-label="`${t('settings.testProxy')} · ${SITE_LABELS[site]}`"
            @click="testOne(site)"
          >
            <Loader2 v-if="testingSites[site]" class="h-4 w-4 animate-spin" />
            <RefreshCw v-else class="h-4 w-4" />
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
