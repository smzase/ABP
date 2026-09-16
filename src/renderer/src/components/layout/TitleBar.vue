<script setup lang="ts">
import { Minus, Square, X } from '@lucide/vue'

/**
 * 自绘标题栏：不用系统标题栏，且按需求不在标题栏写项目名。
 * 左侧留空（整栏可拖拽），右侧只放窗口控制按钮。
 */
function minimize(): void {
  void window.api.minimizeWindow()
}
function toggleMaximize(): void {
  void window.api.toggleMaximizeWindow()
}
function close(): void {
  void window.api.closeWindow()
}
</script>

<template>
  <div class="app-drag flex h-9 shrink-0 items-center justify-end border-b bg-background pl-4">
    <div class="app-no-drag flex items-center">
      <button
        class="flex h-9 w-11 cursor-pointer items-center justify-center text-muted-foreground hover:bg-accent"
        @click="minimize"
      >
        <Minus class="h-4 w-4" />
      </button>
      <button
        class="flex h-9 w-11 cursor-pointer items-center justify-center text-muted-foreground hover:bg-accent"
        @click="toggleMaximize"
      >
        <Square class="h-3.5 w-3.5" />
      </button>
      <button
        class="flex h-9 w-11 cursor-pointer items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        @click="close"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
