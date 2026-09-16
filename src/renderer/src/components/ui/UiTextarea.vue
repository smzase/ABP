<script setup lang="ts">
import { cn } from '@renderer/lib/utils.ts'

defineProps<{ class?: string; placeholder?: string; rows?: number }>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <textarea
    v-model="model"
    :rows="rows ?? 3"
    :placeholder="placeholder"
    :class="
      cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        $props.class
      )
    "
  />
</template>
