<script setup lang="ts">
import { cn } from '@renderer/lib/utils.ts'
defineProps<{ class?: string; vertical?: boolean }>()
</script>

<template>
  <div :class="cn('shrink-0 bg-border', vertical ? 'w-px h-full' : 'h-px w-full', $props.class)" />
</template>
