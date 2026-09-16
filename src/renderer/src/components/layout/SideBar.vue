<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  UploadCloud,
  LayoutTemplate,
  Users,
  History,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Languages,
  Sun,
  Moon,
  Check
} from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import UiPopover from '@renderer/components/ui/UiPopover.vue'
import { LOCALE_LABELS } from '@renderer/i18n/index.ts'
import type { Locale } from '@shared/types.ts'

/**
 * 侧边栏：发布 / 番剧模板 / 站点账号 / 发布记录 / 设置。
 * - 支持展开收起，收起按钮在右下角
 * - 左下角：外观（深浅色 + 主题色）、语言切换
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()

const collapsed = computed(() => app.data.settings.sidebarCollapsed)

const NAV_ITEMS = [
  { name: 'publish', icon: UploadCloud, labelKey: 'nav.publish' },
  { name: 'templates', icon: LayoutTemplate, labelKey: 'nav.templates' },
  { name: 'accounts', icon: Users, labelKey: 'nav.accounts' },
  { name: 'records', icon: History, labelKey: 'nav.records' },
  { name: 'settings', icon: Settings, labelKey: 'nav.settings' }
] as const

function toggleCollapsed(): void {
  app.data.settings.sidebarCollapsed = !collapsed.value
}

function isActive(name: string): boolean {
  return route.name === name
}

function navigate(name: string): void {
  void router.push({ name })
}

function setAccent(color: string): void {
  app.setAccent(color)
}

function onCustomColor(e: Event): void {
  const target = e.target as HTMLInputElement
  app.setAccent(target.value)
}

function setLocale(locale: Locale): void {
  app.setLocale(locale)
}
</script>

<template>
  <aside
    class="flex h-full shrink-0 flex-col border-r bg-card transition-[width] duration-200"
    :class="collapsed ? 'w-14' : 'w-40'"
  >
    <!-- 导航项 -->
    <nav class="flex flex-1 flex-col gap-1 overflow-y-auto p-2 pt-3">
      <!-- 展开时标题就写在按钮上，再浮一个同样的气泡纯属噪音 → 只有收起时才提示 -->
      <UiTooltip
        v-for="item in NAV_ITEMS"
        :key="item.name"
        :content="t(item.labelKey)"
        side="right"
        :disabled="!collapsed"
      >
        <button
          class="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
          :class="[
            collapsed ? 'justify-center px-0' : '',
            isActive(item.name)
              ? 'bg-primary/15 font-medium text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          ]"
          @click="navigate(item.name)"
        >
          <component :is="item.icon" class="h-4.5 w-4.5 shrink-0" style="width: 18px; height: 18px" />
          <span v-if="!collapsed" class="truncate">{{ t(item.labelKey) }}</span>
        </button>
      </UiTooltip>
    </nav>

    <!-- 底部：外观 / 语言 / 收起 -->
    <div class="flex items-center gap-1 border-t p-2" :class="collapsed ? 'flex-col' : ''">
      <div class="flex flex-1 items-center gap-1" :class="collapsed ? 'flex-col' : ''">
        <!-- 外观 -->
        <UiPopover side="top" align="start">
          <template #trigger>
            <button
              class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              :title="t('sidebar.appearance')"
            >
              <Palette class="h-4 w-4" />
            </button>
          </template>
          <div class="flex w-48 flex-col gap-3">
            <div class="text-xs font-medium text-muted-foreground">{{ t('sidebar.appearance') }}</div>
            <div class="flex gap-2">
              <button
                class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
                :class="app.data.settings.appearance.mode === 'light' ? 'border-primary text-primary' : ''"
                @click="app.setThemeMode('light')"
              >
                <Sun class="h-3.5 w-3.5" /> {{ t('sidebar.lightMode') }}
              </button>
              <button
                class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
                :class="app.data.settings.appearance.mode === 'dark' ? 'border-primary text-primary' : ''"
                @click="app.setThemeMode('dark')"
              >
                <Moon class="h-3.5 w-3.5" /> {{ t('sidebar.darkMode') }}
              </button>
            </div>
            <div class="text-xs font-medium text-muted-foreground">{{ t('sidebar.accentColor') }}</div>
            <div class="flex items-center gap-2">
              <button
                v-for="color in app.accentPresets"
                :key="color"
                class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2"
                :class="app.data.settings.appearance.accent === color ? 'border-foreground/60' : 'border-transparent'"
                :style="{ backgroundColor: color }"
                @click="setAccent(color)"
              >
                <Check v-if="app.data.settings.appearance.accent === color" class="h-3.5 w-3.5 text-white" />
              </button>
              <label
                class="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed text-muted-foreground"
                :title="t('sidebar.customColor')"
              >
                <input
                  type="color"
                  class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  :value="app.data.settings.appearance.accent"
                  @input="onCustomColor"
                />
                <span class="text-xs">+</span>
              </label>
            </div>
          </div>
        </UiPopover>

        <!-- 语言 -->
        <UiPopover side="top" align="start">
          <template #trigger>
            <button
              class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              :title="t('sidebar.language')"
            >
              <Languages class="h-4 w-4" />
            </button>
          </template>
          <div class="flex w-32 flex-col gap-0.5">
            <button
              v-for="l in LOCALE_LABELS"
              :key="l.value"
              class="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              :class="app.data.settings.locale === l.value ? 'text-primary' : ''"
              @click="setLocale(l.value)"
            >
              {{ l.label }}
              <Check v-if="app.data.settings.locale === l.value" class="h-3.5 w-3.5" />
            </button>
          </div>
        </UiPopover>
      </div>

      <!-- 收起/展开：右下角 -->
      <UiTooltip :content="collapsed ? t('sidebar.expand') : t('sidebar.collapse')" side="right">
        <button
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          @click="toggleCollapsed"
        >
          <PanelLeftClose v-if="!collapsed" class="h-4 w-4" />
          <PanelLeftOpen v-else class="h-4 w-4" />
        </button>
      </UiTooltip>
    </div>
  </aside>
</template>
