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
  LayoutDashboard,
  UserRound,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Languages
} from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import UiPopover from '@renderer/components/ui/UiPopover.vue'
import SidebarMenuContent from './SidebarMenuContent.vue'
import type { DashboardMenuAction } from '@shared/dashboard-menu.ts'

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
const isAnibtMode = computed(() => app.data.settings.publishMode === 'anibt')
const WEB_ITEMS = [
  { name: 'anibt-web-account', icon: UserRound, labelKey: 'nav.anibtWebAccount' },
  { name: 'anibt-dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' }
] as const

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

function menuAction(action: DashboardMenuAction): void {
  if (action.type === 'theme') app.setThemeMode(action.value)
  else if (action.type === 'locale') app.setLocale(action.value)
  else app.setAccent(action.value)
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
      <div v-if="isAnibtMode" class="mt-2 flex flex-col gap-1 border-t pt-2">
        <UiTooltip v-for="item in WEB_ITEMS" :key="item.name" :content="t(item.labelKey)" side="right" :disabled="!collapsed">
          <button
            class="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
            :class="[collapsed ? 'justify-center px-0' : '', isActive(item.name) ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground']"
            :data-probe="item.name"
            @click="navigate(item.name)"
          >
            <component :is="item.icon" class="h-4.5 w-4.5 shrink-0" style="width: 18px; height: 18px" />
            <span v-if="!collapsed" class="truncate">{{ t(item.labelKey) }}</span>
          </button>
        </UiTooltip>
      </div>
    </nav>

    <!-- 底部：外观 / 语言 / 收起 -->
    <div class="flex items-center gap-1 border-t p-2" :class="collapsed ? 'flex-col' : ''">
      <div class="flex flex-1 items-center gap-1" :class="collapsed ? 'flex-col' : ''">
        <!-- 外观 -->
        <UiPopover side="top" align="start" dashboard-menu="appearance">
          <template #trigger>
            <button
              class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              :title="t('sidebar.appearance')"
            >
              <Palette class="h-4 w-4" />
            </button>
          </template>
          <SidebarMenuContent kind="appearance" :settings="app.data.settings" @action="menuAction" />
        </UiPopover>

        <!-- 语言 -->
        <UiPopover side="top" align="start" dashboard-menu="language">
          <template #trigger>
            <button
              class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              :title="t('sidebar.language')"
              data-probe="sidebar-language"
            >
              <Languages class="h-4 w-4" />
            </button>
          </template>
          <SidebarMenuContent kind="language" :settings="app.data.settings" @action="menuAction" />
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
