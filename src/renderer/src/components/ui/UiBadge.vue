<script setup lang="ts">
import { cva } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils.ts'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        destructive: 'border-transparent bg-destructive/15 text-destructive'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

// defineProps 不能用 VariantProps（条件类型，SFC 编译器解析不了），显式写联合类型
interface Props {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
  class?: string
}

withDefaults(defineProps<Props>(), { variant: 'default' })
</script>

<template>
  <span :class="cn(badgeVariants({ variant }), $props.class)">
    <slot />
  </span>
</template>
