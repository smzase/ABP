<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NYAA_CATEGORIES } from '@shared/constants.ts'
import { usePublishStore } from '@renderer/stores/publish.ts'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import UiSelect from '@renderer/components/ui/UiSelect.vue'
import UiSelectItem from '@renderer/components/ui/UiSelectItem.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import { useAppStore } from '@renderer/stores/app.ts'
import { enabledSites, SITE_LABELS } from '@shared/sites.ts'

/**
 * 阶段二底栏右侧：Preview 测试发布开关、Nyaa 代发分类、发布按钮。
 * Nyaa 开关按条目（默认跟随番剧模板），这里给批量统一入口。
 *
 * 注意：Preview / Nyaa 分类都存在 store 里。放组件里的 `ref` 会随着
 * 路由切换卸载而归零 —— 开了「Preview 测试发布」，去别的页面转一圈回来就自己关了。
 */
const { t } = useI18n()
const store = usePublishStore()
const app = useAppStore()
const localMode = computed(() => app.data.settings.publishMode === 'local')
const localSites = computed(() => {
  const sites = new Set<ReturnType<typeof enabledSites>[number]>()
  for (const entry of store.entries) {
    const template = store.templateOf(entry)
    const group = app.data.groups.find((item) => item.id === template?.groupId)
    if (group) for (const site of enabledSites(group)) sites.add(site)
  }
  return [...sites]
})

const preview = computed({
  get: () => store.batch.preview,
  set: (v: boolean) => (store.batch.preview = v)
})
const nyaaCategory = computed({
  get: () => store.batch.nyaaCategory,
  set: (v: string) => (store.batch.nyaaCategory = v)
})

const anyNyaa = computed(() => store.entries.some((e) => e.nyaa))
const pendingCount = computed(() => store.entries.filter((e) => e.publishOk !== true).length)
/** 标题空的条目站点必拒（422），发之前就把按钮按住，别让人白等一轮网络往返 */
const missingTitle = computed(() =>
  store.entries.some((e) => e.publishOk !== true && !e.title.trim())
)
const allNyaa = computed({
  get: () => store.entries.length > 0 && store.entries.every((e) => e.nyaa),
  set: (v: boolean) => {
    for (const e of store.entries) {
      store.replaceEntry({ ...e, nyaa: v })
    }
  }
})

async function publish(): Promise<void> {
  await store.publishAll()
}
</script>

<template>
  <div class="flex items-center gap-4">
    <UiTooltip v-if="!localMode" :content="t('publish.previewHint')">
      <label class="flex cursor-pointer items-center gap-2 text-sm">
        <UiSwitch v-model="preview" />
        {{ t('publish.preview') }}
      </label>
    </UiTooltip>

    <label v-if="!localMode" class="flex cursor-pointer items-center gap-2 text-sm">
      <UiSwitch v-model="allNyaa" />
      {{ t('publish.nyaa') }}
    </label>

    <UiSelect v-if="(!localMode && anyNyaa) || (localMode && localSites.includes('nyaa'))" v-model="nyaaCategory" class="w-56" :title="t('publish.nyaaCategory')">
      <UiSelectItem v-for="c in NYAA_CATEGORIES" :key="c.code" :value="c.code">{{ c.code }} · {{ c.label }}</UiSelectItem>
    </UiSelect>

    <span v-if="localMode" class="max-w-64 truncate text-xs text-muted-foreground">
      {{ localSites.map((site) => SITE_LABELS[site]).join(' · ') }}
    </span>

    <UiTooltip v-if="missingTitle" :content="t('publishCheck.titleRequired')">
      <span>
        <UiButton disabled>{{ `${t('publish.publish')} (${pendingCount})` }}</UiButton>
      </span>
    </UiTooltip>
    <UiButton v-else :disabled="store.publishing || pendingCount === 0" @click="publish">
      {{ store.publishing ? t('publish.publishing') : `${t('publish.publish')} (${pendingCount})` }}
    </UiButton>
  </div>
</template>
