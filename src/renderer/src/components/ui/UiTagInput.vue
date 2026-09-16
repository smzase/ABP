<script setup lang="ts">
import { ref } from 'vue'
import { X } from '@lucide/vue'
import { cn } from '@renderer/lib/utils.ts'

/**
 * InputTag 方案：回车/逗号添加、点 × 删除、HTML5 拖拽调整位置。
 * 自定义标签（{{customTags}}）顺序由数组顺序决定。
 */
const props = defineProps<{ class?: string; placeholder?: string }>()
const model = defineModel<string[]>({ default: () => [] })

const input = ref('')
const dragIndex = ref(-1)
const overIndex = ref(-1)

function addTag(): void {
  const v = input.value.trim().replace(/,$/, '')
  if (v && !model.value.includes(v)) {
    model.value = [...model.value, v]
  }
  input.value = ''
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addTag()
  } else if (e.key === 'Backspace' && !input.value && model.value.length > 0) {
    model.value = model.value.slice(0, -1)
  }
}

function removeTag(i: number): void {
  model.value = model.value.filter((_, idx) => idx !== i)
}

function onDragStart(i: number): void {
  dragIndex.value = i
}

function onDragOver(e: DragEvent, i: number): void {
  e.preventDefault()
  overIndex.value = i
}

function onDrop(e: DragEvent, i: number): void {
  e.preventDefault()
  const from = dragIndex.value
  if (from < 0 || from === i) return
  const next = [...model.value]
  const [moved] = next.splice(from, 1)
  next.splice(i, 0, moved)
  model.value = next
  dragIndex.value = -1
  overIndex.value = -1
}

function onDragEnd(): void {
  dragIndex.value = -1
  overIndex.value = -1
}

void props
</script>

<template>
  <div
    :class="
      cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring/50',
        $props.class
      )
    "
  >
    <span
      v-for="(tag, i) in model"
      :key="tag"
      draggable="true"
      class="inline-flex cursor-grab items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary transition-opacity"
      :class="{ 'opacity-40': dragIndex === i, 'ring-1 ring-primary': overIndex === i && dragIndex !== i }"
      @dragstart="onDragStart(i)"
      @dragover="onDragOver($event, i)"
      @drop="onDrop($event, i)"
      @dragend="onDragEnd"
    >
      {{ tag }}
      <button type="button" class="cursor-pointer rounded-sm hover:bg-primary/20" @click="removeTag(i)">
        <X class="h-3 w-3" />
      </button>
    </span>
    <input
      v-model="input"
      :placeholder="model.length === 0 ? placeholder : ''"
      class="min-w-20 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
      @keydown="onKeydown"
      @blur="addTag"
    />
  </div>
</template>
