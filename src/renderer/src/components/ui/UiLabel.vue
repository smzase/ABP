<script setup lang="ts">
import { cn } from '@renderer/lib/utils.ts'
defineProps<{ class?: string }>()
</script>

<template>
  <label :class="cn('text-sm font-medium leading-none text-muted-foreground', $props.class)">
    <slot />
  </label>
</template>
