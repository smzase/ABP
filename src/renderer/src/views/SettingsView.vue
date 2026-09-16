<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Captions, Globe, FolderOpen } from '@lucide/vue'
import SubtitleDetectSettings from '@renderer/components/settings/SubtitleDetectSettings.vue'
import ProxySettings from '@renderer/components/settings/ProxySettings.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import { cn } from '@renderer/lib/utils.ts'

/** 设置：左侧二级侧边栏（字幕识别 / 代理 / 数据） */
const { t } = useI18n()

type Section = 'detect' | 'proxy' | 'data'
const section = ref<Section>('detect')

const SECTIONS: Array<{ key: Section; icon: typeof Captions; labelKey: string }> = [
  { key: 'detect', icon: Captions, labelKey: 'settings.subtitleDetect' },
  { key: 'proxy', icon: Globe, labelKey: 'settings.proxy' },
  { key: 'data', icon: FolderOpen, labelKey: 'settings.dataSection' }
]

function openConfigDir(): void {
  void window.api.openConfigDir()
}
</script>

<template>
  <div class="flex h-full">
    <!-- 二级侧边栏 -->
    <div class="w-44 shrink-0 border-r p-2 pt-4">
      <button
        v-for="s in SECTIONS"
        :key="s.key"
        class="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors"
        :class="
          cn(
            section === s.key
              ? 'bg-primary/15 font-medium text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )
        "
        @click="section = s.key"
      >
        <component :is="s.icon" class="h-4 w-4" />
        {{ t(s.labelKey) }}
      </button>
    </div>

    <!-- 内容 -->
    <div class="min-w-0 flex-1 overflow-y-auto p-4">
      <SubtitleDetectSettings v-if="section === 'detect'" />
      <ProxySettings v-else-if="section === 'proxy'" />
      <div v-else class="flex flex-col gap-3">
        <h3 class="font-medium">{{ t('settings.dataSection') }}</h3>
        <p class="text-sm text-muted-foreground">{{ t('settings.configDirHint') }}</p>
        <p class="max-w-2xl text-sm text-muted-foreground">{{ t('settings.secretsHint') }}</p>
        <div>
          <UiButton variant="outline" @click="openConfigDir">
            <FolderOpen class="h-4 w-4" /> {{ t('settings.openConfigDir') }}
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
