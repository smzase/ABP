<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { Star, Trash2 } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import { confirm } from '@renderer/lib/confirm.ts'

const UiMarkdownEditor = defineAsyncComponent(() => import('@renderer/components/ui/UiMarkdownEditor.vue'))

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const app = useAppStore()

const tpl = computed(() => app.data.descTemplates.find((x) => x.id === props.id))

const name = computed({
  get: () => tpl.value?.name ?? '',
  set: (v: string) => {
    if (tpl.value) tpl.value.name = v
  }
})
const markdown = computed({
  get: () => tpl.value?.markdown ?? '',
  set: (v: string) => {
    if (tpl.value) tpl.value.markdown = v
  }
})

async function remove(): Promise<void> {
  if (!(await confirm({ title: t('tpl.deleteConfirm'), destructive: true }))) return
  const idx = app.data.descTemplates.findIndex((x) => x.id === props.id)
  if (idx >= 0) app.data.descTemplates.splice(idx, 1)
  if (app.data.defaultDescTemplateId === props.id) app.data.defaultDescTemplateId = null
}

function setDefault(): void {
  app.data.defaultDescTemplateId = props.id
}
</script>

<template>
  <div v-if="tpl" class="flex h-full min-w-0 flex-col gap-4 p-4">
    <div class="flex items-end gap-2">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <UiLabel>{{ t('tpl.templateName') }}</UiLabel>
        <UiInput v-model="name" />
      </div>
      <UiTooltip :content="app.data.defaultDescTemplateId === id ? t('tpl.defaultTemplate') : t('tpl.setDefault')">
        <UiButton variant="outline" size="icon" data-probe="set-default-desc-template" @click="setDefault">
          <Star class="h-4 w-4" :class="app.data.defaultDescTemplateId === id && 'fill-primary text-primary'" />
        </UiButton>
      </UiTooltip>
      <UiButton variant="destructive" size="icon" @click="remove">
        <Trash2 class="h-4 w-4" />
      </UiButton>
    </div>
    <!-- 高度撑满剩余空间：编辑器跟着窗口缩放，不用写死 px -->
    <UiMarkdownEditor v-model="markdown" class="min-h-0 flex-1" />
  </div>
</template>
