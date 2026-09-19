<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, LogIn, LogOut, ShieldCheck, Trash2 } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiSecretInput from '@renderer/components/ui/UiSecretInput.vue'

const app = useAppStore()
const { t } = useI18n()
const challenge = ref(false)
const host = ref<HTMLElement>()
const challengeHeight = ref(88)
const stopHeight = window.api.onAnibtWebLoginHeight(height => {
  if (challenge.value) challengeHeight.value = height
})
let resize: ResizeObserver | undefined
let disposed = false
function bounds(): { x: number; y: number; width: number; height: number } {
  const rect = host.value!.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}
function syncBounds(): void {
  if (challenge.value && host.value && !disposed) void window.api.setAnibtWebLoginBounds(bounds())
}
async function login(): Promise<void> {
  if (app.webBusy || challenge.value) return
  challengeHeight.value = 88
  challenge.value = true
  await nextTick()
  if (disposed || !host.value) return
  resize = new ResizeObserver(syncBounds)
  resize.observe(host.value)
  // Parent/sidebar layout changes can move the host without changing its size.
  resize.observe(document.querySelector('aside')!)
  await app.webAction('login', bounds())
  resize.disconnect()
  challenge.value = false
}
function cancel(): void { void window.api.cancelAnibtWebLogin() }
onBeforeUnmount(() => { disposed = true; stopHeight(); resize?.disconnect(); if (challenge.value) cancel() })
</script>

<template>
  <section class="h-full overflow-y-auto p-6" data-probe="web-account-page" @scroll="syncBounds">
    <h1 class="mb-5 text-lg font-semibold">{{ t('nav.anibtWebAccount') }}</h1>
    <div class="max-w-xl space-y-5 rounded-lg border bg-card p-5">
      <p class="text-sm leading-relaxed text-muted-foreground">{{ t('webAccount.hint') }}</p>
      <div class="space-y-2">
        <UiLabel for="anibt-web-email">{{ t('accounts.email') }}</UiLabel>
        <UiInput id="anibt-web-email" v-model="app.data.anibtWebAccount.username" type="email" autocomplete="username" :disabled="app.webBusy" />
      </div>
      <div class="space-y-2">
        <UiLabel for="anibt-web-password">{{ t('accounts.password') }}</UiLabel>
        <UiSecretInput id="anibt-web-password" v-model="app.data.anibtWebAccount.password" autocomplete="current-password" :disabled="app.webBusy" />
      </div>
      <div class="flex flex-wrap gap-2">
        <UiButton :disabled="app.webBusy || challenge || !app.data.anibtWebAccount.username.trim() || !app.data.anibtWebAccount.password" data-probe="web-login" @click="login">
          <Loader2 v-if="app.webBusy" class="h-4 w-4 animate-spin" /><LogIn v-else class="h-4 w-4" />{{ t('accounts.login') }}
        </UiButton>
        <UiButton variant="outline" :disabled="app.webBusy" data-probe="web-check" @click="app.webAction('check')"><ShieldCheck class="h-4 w-4" />{{ t('common.check') }}</UiButton>
        <UiButton variant="outline" :disabled="app.webBusy" data-probe="web-logout" @click="app.webAction('logout')"><LogOut class="h-4 w-4" />{{ t('accounts.logout') }}</UiButton>
        <UiButton variant="outline" :disabled="app.webBusy" data-probe="web-clear" @click="app.webAction('clear')"><Trash2 class="h-4 w-4" />{{ t('accounts.clearCookies') }}</UiButton>
      </div>
      <div v-if="challenge" class="space-y-2">
        <div ref="host" class="w-[324px] max-w-full overflow-hidden rounded-md" :style="{ height: `${challengeHeight}px` }" data-probe="web-challenge-host" />
        <UiButton variant="outline" data-probe="web-login-cancel" @click="cancel">{{ t('common.cancel') }}</UiButton>
      </div>
      <p v-if="app.webBusy" class="text-sm text-muted-foreground">{{ t('webAccount.waiting') }}</p>
      <p v-if="app.webResult" role="status" class="break-words text-sm" :class="app.webResult.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'">{{ app.webResult.message }}</p>
    </div>
  </section>
</template>
