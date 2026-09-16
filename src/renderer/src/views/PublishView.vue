<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileUp, UploadCloud } from '@lucide/vue'
import { usePublishStore } from '@renderer/stores/publish.ts'
import UiButton from '@renderer/components/ui/UiButton.vue'
import PublishConfigRow from '@renderer/components/publish/PublishConfigRow.vue'
import PublishFinalRow from '@renderer/components/publish/PublishFinalRow.vue'
import PublishBatchBar from '@renderer/components/publish/PublishBatchBar.vue'

/**
 * 发布向导：
 * ① config：多选/拖拽上传种子 → 自动识别（模板/语言/格式/字幕类型），逐个选择分辨率/格式/字幕类型/字幕语言
 * ② final（右下角「下一步」进入）：标题/集数/语言/展开（版本/标签/简介）/移除
 */
const { t } = useI18n()
const store = usePublishStore()

const dragging = ref(false)

/** 队列为空时投放区占满整页居中；有条目后收成一条窄带，把空间让给列表 */
const empty = computed(() => store.entries.length === 0)

async function pickFiles(): Promise<void> {
  const metas = await window.api.pickTorrents()
  for (const meta of metas) store.addTorrent(meta)
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  dragging.value = true
}

function onDragLeave(): void {
  dragging.value = false
}

async function onDrop(e: DragEvent): Promise<void> {
  // 阻止冒泡到 App.vue 的窗口级兜底，不然拖放会被统一吞掉
  e.preventDefault()
  e.stopPropagation()
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.endsWith('.torrent'))
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer()
      const meta = await window.api.addTorrentBytes(file.name, new Uint8Array(buffer))
      store.addTorrent(meta)
    } catch (err) {
      console.error(`解析失败 ${file.name}:`, err)
    }
  }
}

function goFinal(): void {
  store.fillTitlesFromTemplates()
  store.stage = 'final'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 内容区 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <!-- 阶段一：识别与配置 -->
      <template v-if="store.stage === 'config'">
        <!-- 投放区整块可点：点哪儿都能选文件，不用再去找「选择文件」链接 -->
        <button
          type="button"
          class="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed transition-colors"
          :class="[
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/40',
            empty ? 'min-h-0 flex-1' : 'shrink-0 py-8'
          ]"
          @click="pickFiles"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <UploadCloud class="text-muted-foreground" :class="empty ? 'h-14 w-14' : 'h-9 w-9'" />
          <div class="text-sm text-muted-foreground">{{ t('publish.dropHere') }}</div>
          <div class="text-xs text-muted-foreground/70">{{ t('publish.multiHint') }}</div>
        </button>

        <div v-if="!empty" class="mt-4 flex flex-col gap-2">
          <PublishConfigRow v-for="entry in store.entries" :key="entry.id" :entry="entry" />
        </div>
      </template>

      <!-- 阶段二：最终修改 -->
      <template v-else>
        <div class="flex flex-col gap-2">
          <PublishFinalRow v-for="entry in store.entries" :key="entry.id" :entry="entry" />
        </div>
        <div v-if="empty" class="py-16 text-center text-sm text-muted-foreground">
          {{ t('publish.emptyQueue') }}
        </div>
      </template>
    </div>

    <!-- 底栏 -->
    <div class="flex shrink-0 items-center justify-between border-t bg-card px-4 py-2.5">
      <div>
        <UiButton v-if="store.stage === 'final'" variant="outline" size="sm" @click="store.stage = 'config'">
          {{ t('common.prev') }}
        </UiButton>
      </div>
      <div class="flex items-center gap-3">
        <UiButton v-if="store.stage === 'config' && !empty" variant="ghost" size="sm" @click="pickFiles">
          <FileUp class="h-4 w-4" /> {{ t('publish.addMore') }}
        </UiButton>
        <UiButton v-if="store.stage === 'config'" :disabled="!store.canGoFinal" @click="goFinal">
          {{ t('common.next') }}
        </UiButton>
        <PublishBatchBar v-else />
      </div>
    </div>
  </div>
</template>
