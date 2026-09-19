<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Plus, Trash2, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@renderer/stores/app.ts'
import { genId } from '@renderer/lib/utils.ts'
import { confirm } from '@renderer/lib/confirm.ts'
import { defaultSiteAccounts, isSiteConfigured, SITE_LABELS } from '@shared/sites.ts'
import { PUBLISH_SITES, type GroupAccount, type PublishSite } from '@shared/types.ts'
import SiteAccountEditor from '@renderer/components/accounts/SiteAccountEditor.vue'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiLabel from '@renderer/components/ui/UiLabel.vue'
import { cn } from '@renderer/lib/utils.ts'

const { t } = useI18n()
const app = useAppStore()
const addOpen = ref(false)
const newGroupName = ref('')
const renameOpen = ref(false)
const renameId = ref<string | null>(null)
const renameValue = ref('')
const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const activeSite = ref<PublishSite>('anibt')
const editingGroup = computed(() => app.data.groups.find((group) => group.id === editingId.value))

function addGroup(): void {
  const name = newGroupName.value.trim()
  if (!name) return
  const group: GroupAccount = { id: genId(), name, sites: defaultSiteAccounts() }
  app.data.groups.push(group)
  newGroupName.value = ''
  addOpen.value = false
  openEditor(group)
}

function openEditor(group: GroupAccount): void {
  editingId.value = group.id
  activeSite.value = 'anibt'
  editorOpen.value = true
}

function beginRename(group: GroupAccount): void {
  renameId.value = group.id
  renameValue.value = group.name
  renameOpen.value = true
}

function saveRename(): void {
  const group = app.data.groups.find((item) => item.id === renameId.value)
  const name = renameValue.value.trim()
  if (!group || !name) return
  group.name = name
  renameOpen.value = false
}

async function removeGroup(group: GroupAccount): Promise<void> {
  if (!(await confirm({ title: t('accounts.deleteConfirm'), destructive: true }))) return
  const index = app.data.groups.findIndex((item) => item.id === group.id)
  if (index >= 0) app.data.groups.splice(index, 1)
}

function siteEnabled(group: GroupAccount, site: PublishSite): boolean {
  return (site === 'anibt' && app.data.settings.publishMode === 'anibt') || group.sites[site].enabled
}

function enabledCount(group: GroupAccount): number {
  return PUBLISH_SITES.filter((site) => siteEnabled(group, site)).length
}
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ t('nav.accounts') }}</h2>
      <UiButton size="sm" @click="addOpen = true"><Plus class="h-4 w-4" /> {{ t('accounts.addGroup') }}</UiButton>
    </div>

    <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <UiCard v-for="group in app.data.groups" :key="group.id" class="cursor-pointer p-4 hover:border-primary/40" @click="openEditor(group)">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div class="min-w-0"><div class="truncate font-medium">{{ group.name }}</div><div class="text-xs text-muted-foreground">{{ t('accounts.enabledCount', { count: enabledCount(group) }) }}</div></div>
          <div class="flex items-center gap-1">
            <UiButton variant="ghost" size="icon" :title="t('common.edit')" @click.stop="beginRename(group)"><Pencil class="h-4 w-4" /></UiButton>
            <UiButton variant="ghost" size="icon" :title="t('common.delete')" @click.stop="removeGroup(group)"><Trash2 class="h-4 w-4 text-destructive" /></UiButton>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <UiBadge v-for="site in PUBLISH_SITES" :key="site" :variant="siteEnabled(group, site) ? (isSiteConfigured(site, group.sites[site]) ? 'default' : 'outline') : 'secondary'" :class="!siteEnabled(group, site) ? 'opacity-50' : undefined">
            {{ SITE_LABELS[site] }} · {{ siteEnabled(group, site) ? (isSiteConfigured(site, group.sites[site]) ? t('accounts.configured') : t('accounts.notConfigured')) : t('accounts.disabled') }}
          </UiBadge>
        </div>
      </UiCard>
      <button v-if="app.data.groups.length === 0" class="col-span-full flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed text-muted-foreground hover:border-primary/50 hover:text-foreground" @click="addOpen = true">
        <Plus class="h-5 w-5" />{{ t('accounts.addGroup') }}
      </button>
    </div>

    <UiDialog v-model:open="addOpen" :title="t('accounts.addGroup')">
      <div class="flex flex-col gap-1.5"><UiLabel>{{ t('accounts.groupName') }}</UiLabel><UiInput v-model="newGroupName" data-probe="new-group-name" :placeholder="t('accounts.groupName')" @keydown.enter="addGroup" /></div>
      <div class="flex justify-end gap-2"><UiButton variant="outline" @click="addOpen = false">{{ t('common.cancel') }}</UiButton><UiButton :disabled="!newGroupName.trim()" @click="addGroup">{{ t('common.add') }}</UiButton></div>
    </UiDialog>

    <UiDialog v-model:open="renameOpen" :title="t('accounts.renameGroup')">
      <UiInput v-model="renameValue" :placeholder="t('accounts.renameHint')" @keydown.enter="saveRename" />
      <div class="flex justify-end gap-2"><UiButton variant="outline" @click="renameOpen = false">{{ t('common.cancel') }}</UiButton><UiButton :disabled="!renameValue.trim()" @click="saveRename">{{ t('common.save') }}</UiButton></div>
    </UiDialog>

    <UiDialog v-model:open="editorOpen" :title="editingGroup?.name" class="max-w-5xl">
      <div v-if="editingGroup" class="grid min-h-[480px] grid-cols-[180px_minmax(0,1fr)] gap-4">
        <nav class="flex flex-col gap-1 border-r pr-3">
          <button v-for="site in PUBLISH_SITES" :key="site" :data-account-site="site" class="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-left text-sm" :class="cn(activeSite === site ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent')" @click="activeSite = site">
            <span>{{ SITE_LABELS[site] }}</span><span class="h-2 w-2 rounded-full" :class="siteEnabled(editingGroup, site) ? 'bg-green-500' : 'bg-muted-foreground/30'" />
          </button>
        </nav>
        <div class="min-w-0 overflow-y-auto pr-1"><SiteAccountEditor :group-id="editingGroup.id" :site="activeSite" /></div>
      </div>
      <div class="flex justify-end"><UiButton variant="outline" @click="editorOpen = false"><X class="h-4 w-4" />{{ t('common.close') }}</UiButton></div>
    </UiDialog>
  </div>
</template>
