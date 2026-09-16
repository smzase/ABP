<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, CheckCircle2, XCircle } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiSelect from '@renderer/components/ui/UiSelect.vue'
import UiSelectItem from '@renderer/components/ui/UiSelectItem.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import { cn } from '@renderer/lib/utils.ts'
import type { ProxySettings as ProxySettingsType } from '@shared/types.ts'

/** 代理设置：跟随系统 / 直连 / 自定义（HTTP、HTTPS、SOCKS5），默认可选用户名密码，带测试按钮 */
const { t } = useI18n()
const app = useAppStore()

const proxy = app.data.settings.proxy

const testing = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)

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

async function test(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    // 用当前表单里的配置测（不要求先保存生效）
    const res = await window.api.testProxy({ ...proxy })
    testResult.value = res.ok
      ? { ok: true, text: `${t('settings.testOk')} · ${res.latencyMs}ms` }
      : { ok: false, text: `${t('settings.testFail')}: ${res.error}` }
  } finally {
    testing.value = false
  }
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
          <UiInput v-model="proxy.password" type="password" />
        </div>
      </div>
    </UiCard>

    <div class="flex items-center gap-3">
      <UiButton variant="outline" :disabled="testing" @click="test">
        <Loader2 v-if="testing" class="h-4 w-4 animate-spin" />
        {{ testing ? t('settings.testing') : t('settings.testProxy') }}
      </UiButton>
      <span v-if="testResult" class="flex items-center gap-1.5 text-sm" :class="testResult.ok ? 'text-green-500' : 'text-destructive'">
        <CheckCircle2 v-if="testResult.ok" class="h-4 w-4" />
        <XCircle v-else class="h-4 w-4" />
        {{ testResult.text }}
      </span>
    </div>
  </div>
</template>
