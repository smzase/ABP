<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, Trash2, GripVertical } from '@lucide/vue'
import UiContextMenu from '@renderer/components/ui/UiContextMenu.vue'
import UiContextMenuItem from '@renderer/components/ui/UiContextMenuItem.vue'
import { cn } from '@renderer/lib/utils.ts'

/**
 * 模板页左侧列表：三个 tab（标题 / 简介 / 番剧）共用，宽度也因此统一。
 *
 * - 单击选中，右键出菜单（重命名 / 删除）
 * - 重命名是就地编辑：把当前项换成一个 input，回车或失焦提交，Esc 取消
 * - 拖拽调整上下顺序（HTML5 DnD，和 UiTagInput 一个路子）
 *
 * 自己不改数组：拖放和改名都 emit 出去，由持有 store 的父组件落库。
 */
export interface SideListItem {
  id: string
  /** 主标题 */
  label: string
  /** 副标题（番剧模板用来显示 bgmId / 发布组） */
  sub?: string
}

const props = defineProps<{
  items: SideListItem[]
  selectedId: string | null
  /** 番剧模板的卡片有副标题，行高更高 */
  variant?: 'plain' | 'card'
  emptyText: string
}>()

const emit = defineEmits<{
  select: [id: string]
  rename: [id: string, name: string]
  remove: [id: string]
  reorder: [from: number, to: number]
}>()

const { t } = useI18n()

// ---------- 就地重命名 ----------
const editingId = ref<string | null>(null)
const draftName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

async function startRename(item: SideListItem): Promise<void> {
  editingId.value = item.id
  draftName.value = item.label
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function commitRename(): void {
  const id = editingId.value
  if (!id) return
  const name = draftName.value.trim()
  editingId.value = null
  // 空名字当作取消，不然列表里会出现一行看不见的项
  if (name) emit('rename', id, name)
}

function cancelRename(): void {
  editingId.value = null
}

// ---------- 拖拽排序 ----------
const dragIndex = ref(-1)
const overIndex = ref(-1)

function onDragStart(e: DragEvent, i: number): void {
  dragIndex.value = i
  // 不设 dataTransfer 的话 Firefox/部分场景不会真的开始拖
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, i: number): void {
  e.preventDefault()
  // App.vue 挂了窗口级的拖放兜底（防止拖文件进来导致白屏），这里必须拦住冒泡
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  overIndex.value = i
}

function onDrop(e: DragEvent, i: number): void {
  e.preventDefault()
  e.stopPropagation()
  const from = dragIndex.value
  dragIndex.value = -1
  overIndex.value = -1
  if (from < 0 || from === i) return
  emit('reorder', from, i)
}

function onDragEnd(): void {
  dragIndex.value = -1
  overIndex.value = -1
}

void props
</script>

<template>
  <div class="flex w-52 shrink-0 flex-col overflow-y-auto border-r p-2">
    <template v-for="(item, i) in items" :key="item.id">
      <!-- 改名中：整行换成输入框，不挂右键菜单免得和文本选择打架 -->
      <input
        v-if="editingId === item.id"
        ref="inputRef"
        v-model="draftName"
        class="mb-1 w-full rounded-md border border-primary bg-transparent px-3 py-2 text-sm outline-none"
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />

      <UiContextMenu v-else>
        <template #trigger>
          <button
            draggable="true"
            class="mb-1 w-full cursor-pointer rounded-md text-left transition-colors"
            :class="
              cn(
                variant === 'card' ? 'border px-3 py-2.5' : 'truncate px-3 py-2 text-sm',
                selectedId === item.id
                  ? variant === 'card'
                    ? 'border-primary bg-primary/10'
                    : 'bg-primary/15 text-primary'
                  : cn('hover:bg-accent', variant === 'card' && 'bg-card'),
                dragIndex === i && 'opacity-40',
                overIndex === i && dragIndex !== i && dragIndex >= 0 && 'ring-2 ring-primary'
              )
            "
            @click="emit('select', item.id)"
            @dragstart="onDragStart($event, i)"
            @dragover="onDragOver($event, i)"
            @drop="onDrop($event, i)"
            @dragend="onDragEnd"
          >
            <div class="flex items-center gap-1.5">
              <GripVertical class="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              <span :class="cn('min-w-0 flex-1 truncate', variant === 'card' && 'text-sm font-medium')">
                {{ item.label }}
              </span>
            </div>
            <div v-if="item.sub" class="mt-0.5 truncate pl-5 text-xs text-muted-foreground">{{ item.sub }}</div>
          </button>
        </template>

        <UiContextMenuItem @select="startRename(item)">
          <Pencil class="h-3.5 w-3.5" /> {{ t('tpl.rename') }}
        </UiContextMenuItem>
        <UiContextMenuItem destructive @select="emit('remove', item.id)">
          <Trash2 class="h-3.5 w-3.5" /> {{ t('common.delete') }}
        </UiContextMenuItem>
      </UiContextMenu>
    </template>

    <div v-if="items.length === 0" class="p-3 text-xs text-muted-foreground">{{ emptyText }}</div>
    <div v-else class="mt-1 px-2 text-[11px] leading-relaxed text-muted-foreground/70">{{ t('tpl.listHint') }}</div>
  </div>
</template>
