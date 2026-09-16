<script setup lang="ts">
import {
  AlertDialogRoot,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription
} from 'reka-ui'
import { useI18n } from 'vue-i18n'
import UiButton from '@renderer/components/ui/UiButton.vue'
import { confirmState, settleConfirm } from '@renderer/lib/confirm.ts'

/**
 * 全局确认弹窗，在 App.vue 挂一份就够（由 lib/confirm.ts 的 confirm() 驱动）。
 * 替代 window.confirm —— 原生模态框会夺走键盘焦点且还不回来，
 * 之后整个窗口的输入框都打不进字。详见 lib/confirm.ts 的注释。
 *
 * 这里刻意**不用** AlertDialogAction / AlertDialogCancel 包按钮：
 * 那两个组件自带「点击即关闭」的内部处理，会和按钮自己的 @click 抢执行顺序。
 * 内部处理先跑的话，先触发 onOpenChange(false) 把 Promise 结算成 false，
 * 等我们的 settleConfirm(true) 再跑时 resolve 已经被置空 —— 结果就是
 * 「点了确认删除却没删掉」。用普通按钮显式结算，顺序就没有歧义了。
 */
const { t } = useI18n()

function onOpenChange(v: boolean): void {
  // 只负责 Esc / 点遮罩这类「非按钮」的关闭；settleConfirm 幂等，重复调用无副作用
  if (!v) settleConfirm(false)
}
</script>

<template>
  <AlertDialogRoot :open="confirmState.open" @update:open="onOpenChange">
    <AlertDialogPortal v-if="confirmState.open">
      <AlertDialogOverlay
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
      />
      <AlertDialogContent
        class="fixed left-1/2 top-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out"
      >
        <div class="flex flex-col gap-1.5">
          <AlertDialogTitle class="text-base font-semibold">{{ confirmState.title }}</AlertDialogTitle>
          <AlertDialogDescription v-if="confirmState.description" class="text-sm text-muted-foreground">
            {{ confirmState.description }}
          </AlertDialogDescription>
        </div>
        <div class="flex justify-end gap-2">
          <UiButton variant="outline" size="sm" @click="settleConfirm(false)">
            {{ confirmState.cancelText || t('common.cancel') }}
          </UiButton>
          <UiButton
            :variant="confirmState.destructive ? 'destructive' : 'default'"
            size="sm"
            @click="settleConfirm(true)"
          >
            {{ confirmState.confirmText || t('common.confirm') }}
          </UiButton>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
