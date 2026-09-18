<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Star, Trash2 } from '@lucide/vue'
import { TEMPLATE_VARIABLE_GROUPS, renderTemplate, type TemplateVariable } from '@shared/template.ts'
import { useAppStore } from '@renderer/stores/app.ts'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiCollapsible from '@renderer/components/ui/UiCollapsible.vue'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'
import { confirm } from '@renderer/lib/confirm.ts'

/**
 * 标题模板编辑器：输入框在上，变量面板在下（五类、可展开收起、
 * 点击插入到光标处、悬停显示说明），底部实时预览。
 * 直接按 id 改 store 里的对象（store 即单一数据源），不碰 props。
 */
const props = defineProps<{ id: string }>()
const { t } = useI18n()
const app = useAppStore()

const tpl = computed(() => app.data.titleTemplates.find((x) => x.id === props.id))

const inputRef = ref<HTMLTextAreaElement | null>(null)

const name = computed({
  get: () => tpl.value?.name ?? '',
  set: (v: string) => {
    if (tpl.value) tpl.value.name = v
  }
})
const template = computed({
  get: () => tpl.value?.template ?? '',
  set: (v: string) => {
    if (tpl.value) tpl.value.template = v
  }
})

/** 点击变量 → 插入到输入框当前选中位置 */
function varLabel(name: string): string {
  return '{{' + name + '}}'
}

/** 变量说明优先走 i18n（tplVarNote.<name>），缺 key 时回退到 shared 里的中文原文 */
function varNote(v: TemplateVariable): string {
  const key = `tplVarNote.${v.name}`
  const translated = t(key)
  return translated === key ? v.note : translated
}

function insertVariable(varName: string): void {
  const token = `{{${varName}}}`
  const el = inputRef.value
  if (!el) {
    template.value += token
    return
  }
  const start = el.selectionStart ?? template.value.length
  const end = el.selectionEnd ?? start
  template.value = template.value.slice(0, start) + token + template.value.slice(end)
  requestAnimationFrame(() => {
    el.focus()
    const pos = start + token.length
    el.setSelectionRange(pos, pos)
  })
}

/** 实时预览（用示例数据） */
const preview = computed(() =>
  renderTemplate(template.value, {
    groupName: '字幕组组名',
    titleZh: '我们的雨色协议',
    titleZhHans: '我们的雨色协议',
    titleZhHant: '我們的雨色協議',
    titleRomaji: 'Bokura no Ame-iro Protocol',
    titleEn: 'Protocol: Rain',
    titleNative: '僕らの雨いろプロトコル',
    ep: '8',
    version: 'v2',
    resolution: '1080p',
    dimensions: '1920x1080',
    format: 'MKV',
    codec: 'HEVC',
    bitDepth: '10bit',
    audioCodec: 'AAC',
    source: 'WEB-DL',
    customTags: ['NF', 'VOSTFR'],
    languages: ['CHS', 'CHT', 'JP'],
    subtitleType: 'EMBEDDED'
  })
)

async function remove(): Promise<void> {
  if (!(await confirm({ title: t('tpl.deleteConfirm'), destructive: true }))) return
  const idx = app.data.titleTemplates.findIndex((x) => x.id === props.id)
  if (idx >= 0) app.data.titleTemplates.splice(idx, 1)
  if (app.data.defaultTitleTemplateId === props.id) app.data.defaultTitleTemplateId = null
}

function setDefault(): void {
  app.data.defaultTitleTemplateId = props.id
}
</script>

<template>
  <div v-if="tpl" class="flex flex-col gap-4 p-4">
    <div class="flex items-end gap-2">
      <div class="flex flex-1 flex-col gap-1.5">
        <UiLabel>{{ t('tpl.templateName') }}</UiLabel>
        <UiInput v-model="name" />
      </div>
      <UiTooltip :content="app.data.defaultTitleTemplateId === id ? t('tpl.defaultTemplate') : t('tpl.setDefault')">
        <UiButton variant="outline" size="icon" data-probe="set-default-title-template" @click="setDefault">
          <Star class="h-4 w-4" :class="app.data.defaultTitleTemplateId === id && 'fill-primary text-primary'" />
        </UiButton>
      </UiTooltip>
      <UiButton variant="destructive" size="icon" @click="remove">
        <Trash2 class="h-4 w-4" />
      </UiButton>
    </div>

    <div class="flex flex-col gap-1.5">
      <UiLabel>{{ t('tpl.templateContent') }}</UiLabel>
      <!-- textarea 而非 input：模板往往很长，超出宽度要换行显示而不是横向滚 -->
      <textarea
        ref="inputRef"
        v-model="template"
        rows="3"
        class="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        spellcheck="false"
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <UiLabel>{{ t('tpl.preview') }}</UiLabel>
      <div class="rounded-md border bg-muted/50 px-3 py-2 text-sm break-all">{{ preview }}</div>
    </div>

    <div class="flex flex-col gap-1">
      <UiLabel class="mb-1">{{ t('tpl.variables') }}</UiLabel>
      <UiCollapsible
        v-for="group in TEMPLATE_VARIABLE_GROUPS"
        :key="group.key"
        :title="t(group.labelKey)"
        default-open
      >
        <div class="flex flex-wrap gap-1.5">
          <UiTooltip v-for="v in group.vars" :key="v.name" :content="varNote(v)">
            <button
              class="cursor-pointer rounded-md border bg-secondary px-2 py-1 font-mono text-xs hover:bg-primary/15 hover:text-primary"
              @click="insertVariable(v.name)"
            >
              {{ varLabel(v.name) }}
            </button>
          </UiTooltip>
        </div>
      </UiCollapsible>
    </div>
  </div>
</template>
