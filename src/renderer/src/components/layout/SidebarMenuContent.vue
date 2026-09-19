<script setup lang="ts">
import { Check, Moon, Sun } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { LOCALE_LABELS } from '@renderer/i18n/index.ts'
import { ACCENT_PRESETS } from '@shared/constants.ts'
import type { DashboardMenuAction, DashboardMenuSettings } from '@shared/dashboard-menu.ts'

defineProps<{ kind: 'appearance' | 'language'; settings: DashboardMenuSettings }>()
const emit = defineEmits<{ action: [action: DashboardMenuAction] }>()
const { t } = useI18n()
function customColor(event: Event): void {
  emit('action', { type: 'accent', value: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <div v-if="kind === 'appearance'" class="flex w-48 flex-col gap-3" data-menu-kind="appearance">
    <div class="text-xs font-medium text-muted-foreground">{{ t('sidebar.appearance') }}</div>
    <div class="flex gap-2">
      <button v-for="mode in ['light', 'dark'] as const" :key="mode" :data-theme="mode"
        class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
        :class="settings.appearance.mode === mode ? 'border-primary text-primary' : ''"
        @click="emit('action', { type: 'theme', value: mode })">
        <component :is="mode === 'light' ? Sun : Moon" class="h-3.5 w-3.5" />
        {{ t(mode === 'light' ? 'sidebar.lightMode' : 'sidebar.darkMode') }}
      </button>
    </div>
    <div class="text-xs font-medium text-muted-foreground">{{ t('sidebar.accentColor') }}</div>
    <div class="flex items-center gap-2">
      <button v-for="color in ACCENT_PRESETS" :key="color"
        class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2"
        :class="settings.appearance.accent === color ? 'border-foreground/60' : 'border-transparent'"
        :style="{ backgroundColor: color }" @click="emit('action', { type: 'accent', value: color })">
        <Check v-if="settings.appearance.accent === color" class="h-3.5 w-3.5 text-white" />
      </button>
      <label class="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed text-muted-foreground"
        :title="t('sidebar.customColor')">
        <input type="color" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" :value="settings.appearance.accent" @input="customColor" />
        <span class="text-xs">+</span>
      </label>
    </div>
  </div>
  <div v-else class="flex w-32 flex-col gap-0.5" data-menu-kind="language">
    <button v-for="l in LOCALE_LABELS" :key="l.value" :data-locale="l.value"
      class="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
      :class="settings.locale === l.value ? 'text-primary' : ''"
      @click="emit('action', { type: 'locale', value: l.value })">
      {{ l.label }}
      <Check v-if="settings.locale === l.value" class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
