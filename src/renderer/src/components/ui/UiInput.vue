<script setup lang="ts">
import { cn } from '@renderer/lib/utils.ts'

defineProps<{ class?: string; placeholder?: string; type?: string; disabled?: boolean }>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <input
    v-model="model"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="
      cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        $props.class
      )
    "
  />
</template>
