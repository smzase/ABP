<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Pencil, Trash2, Loader2, CheckCircle2, XCircle, KeyRound } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import { genId } from '@renderer/lib/utils.ts'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import { confirm } from '@renderer/lib/confirm.ts'
import type { GroupAccount } from '@shared/types.ts'

/**
 * 站点账号：先创建「组」，再给组填 API Key，可「检查」验证 Key（whoami + scopes）。
 */
const { t } = useI18n()
const app = useAppStore()

const addOpen = ref(false)
const newGroupName = ref('')
const renameOpen = ref(false)
const renameId = ref<string | null>(null)
const renameValue = ref('')

const checkingId = ref<string | null>(null)
const checkMsg = ref<Record<string, { ok: boolean; text: string }>>({})

function addGroup(): void {
  const name = newGroupName.value.trim()
  if (!name) return
  app.data.groups.push({
    id: genId(),
    name,
    apiKey: '',
    slug: '',
    scopes: [],
    status: '',
    lastCheckedAt: null
  })
  newGroupName.value = ''
  addOpen.value = false
}

function beginRename(group: GroupAccount): void {
  renameId.value = group.id
  renameValue.value = group.name
  renameOpen.value = true
}

function saveRename(): void {
  const name = renameValue.value.trim()
  const group = renameId.value ? app.data.groups.find((x) => x.id === renameId.value) : undefined
  if (!group || !name) return
  group.name = name
  renameOpen.value = false
  renameId.value = null
}
async function removeGroup(group: GroupAccount): Promise<void> {
  if (!(await confirm({ title: t('accounts.deleteConfirm'), destructive: true }))) return
  const idx = app.data.groups.findIndex((g) => g.id === group.id)
  if (idx >= 0) app.data.groups.splice(idx, 1)
}

/** 输入时原样存，别在每次按键上 trim —— 那会让人打不进空格、光标乱跳。失焦再清理 */
function patchKey(group: GroupAccount, v: string): void {
  const g = app.data.groups.find((x) => x.id === group.id)
  if (g) g.apiKey = v
}

function trimKey(group: GroupAccount): void {
  const g = app.data.groups.find((x) => x.id === group.id)
  if (g) g.apiKey = g.apiKey.trim()
}

function usedByCount(groupId: string): number {
  return app.data.animeTemplates.filter((x) => x.groupId === groupId).length
}

/** 检查：whoami 确认 Key 可用，groupMe 拿 slug/scopes/status */
async function check(group: GroupAccount): Promise<void> {
  if (!group.apiKey) {
    checkMsg.value[group.id] = { ok: false, text: t('accounts.keyEmpty') }
    return
  }
  checkingId.value = group.id
  delete checkMsg.value[group.id]
  try {
    const me = await window.api.anibtGroupMe(group.apiKey)
    if (me.ok && me.data) {
      const g = app.data.groups.find((x) => x.id === group.id)
      if (g) {
        g.slug = me.data.slug
        g.scopes = me.data.scopes ?? []
        g.status = me.data.status
        g.lastCheckedAt = Date.now()
      }
      checkMsg.value[group.id] = { ok: true, text: t('accounts.checkOk') }
      return
    }
    // groupMe 失败时退回 whoami（至少确认 Key 有效）
    const who = await window.api.anibtWhoami(group.apiKey)
    if (who.ok && who.data) {
      const g = app.data.groups.find((x) => x.id === group.id)
      if (g) {
        g.slug = who.data.groupSlug
        g.scopes = who.data.scopes ?? []
        g.lastCheckedAt = Date.now()
      }
      checkMsg.value[group.id] = { ok: true, text: t('accounts.checkOk') }
    } else {
      checkMsg.value[group.id] = { ok: false, text: who.error ?? me.error ?? t('accounts.checkFail') }
    }
  } finally {
    checkingId.value = null
  }
}

function formatTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : t('accounts.never')
}
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ t('nav.accounts') }}</h2>
      <UiButton size="sm" @click="addOpen = true">
        <Plus class="h-4 w-4" /> {{ t('accounts.addGroup') }}
      </UiButton>
    </div>

    <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <UiCard v-for="group in app.data.groups" :key="group.id" class="p-4">
        <div class="mb-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ group.name }}</span>
            <UiBadge v-if="group.slug" variant="secondary">{{ group.slug }}</UiBadge>
            <UiBadge v-if="group.status" :variant="group.status.toLowerCase() === 'active' ? 'default' : 'destructive'">
              {{ group.status }}
            </UiBadge>
            <UiBadge v-if="usedByCount(group.id) > 0" variant="outline">
              {{ usedByCount(group.id) }} {{ t('accounts.usedBy') }}
            </UiBadge>
          </div>
          <div class="flex items-center gap-1">
            <UiButton variant="ghost" size="icon" :title="t('common.edit')" @click="beginRename(group)">
              <Pencil class="h-4 w-4" />
            </UiButton>
            <UiButton variant="ghost" size="icon" :title="t('common.delete')" @click="removeGroup(group)">
              <Trash2 class="h-4 w-4 text-destructive" />
            </UiButton>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <UiLabel class="flex items-center gap-1.5">
            <KeyRound class="h-3.5 w-3.5" /> {{ t('accounts.apiKey') }}
          </UiLabel>
          <div class="flex gap-2">
            <UiInput
              :model-value="group.apiKey"
              type="password"
              class="flex-1 font-mono"
              :placeholder="t('accounts.apiKeyHint')"
              @update:model-value="(v: string) => patchKey(group, v)"
              @blur="trimKey(group)"
            />
            <UiButton variant="outline" :disabled="checkingId === group.id" @click="check(group)">
              <Loader2 v-if="checkingId === group.id" class="h-4 w-4 animate-spin" />
              {{ checkingId === group.id ? t('accounts.checking') : t('accounts.checkNow') }}
            </UiButton>
          </div>

          <div v-if="checkMsg[group.id]" class="flex items-center gap-1.5 text-xs"
            :class="checkMsg[group.id].ok ? 'text-green-500' : 'text-destructive'">
            <CheckCircle2 v-if="checkMsg[group.id].ok" class="h-3.5 w-3.5" />
            <XCircle v-else class="h-3.5 w-3.5" />
            {{ checkMsg[group.id].text }}
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{{ t('accounts.lastCheck') }}: {{ formatTime(group.lastCheckedAt) }}</span>
            <span v-if="group.scopes.length > 0" class="flex items-center gap-1">
              {{ t('accounts.scopes') }}:
              <UiBadge v-for="s in group.scopes" :key="s" variant="outline">{{ s }}</UiBadge>
            </span>
          </div>
        </div>
      </UiCard>

      <div v-if="app.data.groups.length === 0" class="col-span-full py-16 text-center text-sm text-muted-foreground">
        {{ t('common.empty') }}
      </div>
    </div>

    <UiDialog v-model:open="renameOpen" :title="t('accounts.renameGroup')">
      <div class="flex flex-col gap-3">
        <UiLabel>{{ t('accounts.groupName') }}</UiLabel>
        <UiInput v-model="renameValue" :placeholder="t('accounts.renameHint')" @keydown.enter="saveRename" />
        <div class="flex justify-end gap-2">
          <UiButton variant="outline" @click="renameOpen = false">{{ t('common.cancel') }}</UiButton>
          <UiButton :disabled="!renameValue.trim()" @click="saveRename">{{ t('common.save') }}</UiButton>
        </div>
      </div>
    </UiDialog>
    <UiDialog v-model:open="addOpen" :title="t('accounts.addGroup')">
      <div class="flex flex-col gap-3">
        <UiLabel>{{ t('accounts.groupName') }}</UiLabel>
        <UiInput v-model="newGroupName" placeholder="三明治摆烂组" @keydown.enter="addGroup" />
        <div class="flex justify-end gap-2">
          <UiButton variant="outline" @click="addOpen = false">{{ t('common.cancel') }}</UiButton>
          <UiButton :disabled="!newGroupName.trim()" @click="addGroup">{{ t('common.add') }}</UiButton>
        </div>
      </div>
    </UiDialog>
  </div>
</template>
