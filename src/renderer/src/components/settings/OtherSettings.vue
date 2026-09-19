<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, FolderPen, Loader2, RotateCcw } from '@lucide/vue'
import { useAppStore } from '@renderer/stores/app.ts'
import { toPlain } from '@shared/plain.ts'
import { confirm } from '@renderer/lib/confirm.ts'
import UiButton from '@renderer/components/ui/UiButton.vue'
import FontSelect from './FontSelect.vue'

const app = useAppStore()
const { t } = useI18n()
const directory = ref('')
const moving = ref(false)
const dataError = ref('')
const dataMessage = ref('')
const fonts = ref<string[]>([])
const fontLoading = ref(false)
const fontError = ref('')

async function loadFonts(): Promise<void> {
  if (fontLoading.value) return
  fontLoading.value = true
  fontError.value = ''
  try { fonts.value = await window.api.listFonts() }
  catch (error) { fontError.value = String(error) }
  finally { fontLoading.value = false }
}
onMounted(async () => {
  try { directory.value = await window.api.getConfigDir() }
  catch (error) { dataError.value = String(error) }
  void loadFonts()
})

async function openDirectory(): Promise<void> {
  try { directory.value = await window.api.openConfigDir() }
  catch (error) { dataError.value = String(error) }
}
async function changeDirectory(): Promise<void> {
  if (moving.value) return
  moving.value = true
  dataError.value = ''
  dataMessage.value = ''
  try {
    const target = await window.api.pickConfigDir()
    if (!target || target === directory.value) return
    if (!(await confirm({ title: t('settings.changeDataDir'), description: t('settings.changeDataDirConfirm', { path: target }) }))) return
    directory.value = await window.api.changeConfigDir(target, toPlain(app.data))
    dataMessage.value = t('settings.dataDirChanged')
  } catch (error) {
    const message = String(error)
    dataError.value = message.includes('DATA_DIR_NOT_EMPTY') ? t('settings.dataDirNotEmpty')
      : message.includes('DATA_DIR_RELATED') ? t('settings.dataDirRelated') : message
  } finally { moving.value = false }
}
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-8">
    <section class="flex flex-col gap-3">
      <h3 class="font-medium">{{ t('settings.dataSection') }}</h3>
      <p class="text-sm text-muted-foreground">{{ t('settings.dataDir') }}</p>
      <div class="select-text rounded-md border bg-muted/40 px-3 py-2 text-sm break-all" data-probe="config-directory">{{ directory }}</div>
      <div class="flex flex-wrap gap-2">
        <UiButton variant="outline" :disabled="moving" data-probe="change-data-directory" @click="changeDirectory">
          <Loader2 v-if="moving" class="h-4 w-4 animate-spin" /><FolderPen v-else class="h-4 w-4" />
          {{ t('settings.changeDataDir') }}
        </UiButton>
        <UiButton variant="outline" @click="openDirectory"><FolderOpen class="h-4 w-4" />{{ t('settings.openConfigDir') }}</UiButton>
      </div>
      <p v-if="dataError" class="text-sm text-destructive" role="alert">{{ dataError }}</p>
      <p v-if="dataMessage" class="text-sm text-muted-foreground" role="status">{{ dataMessage }}</p>
    </section>
    <section class="flex flex-col gap-3 border-t pt-5">
      <h3 class="font-medium">{{ t('settings.font') }}</h3>
      <div class="flex max-w-lg flex-col gap-2">
        <div class="flex items-center gap-2">
          <FontSelect :model-value="app.data.settings.appearance.fontFamily" :fonts="fonts" :disabled="fontLoading" @update:model-value="app.setFontFamily" />
          <Loader2 v-if="fontLoading" class="h-4 w-4 shrink-0 animate-spin" />
          <UiButton variant="outline" size="icon" :aria-label="t('settings.systemFont')" :title="t('settings.systemFont')" @click="app.setFontFamily('')"><RotateCcw class="h-4 w-4" /></UiButton>
        </div>
        <div v-if="fontError" class="flex items-center gap-2 text-xs text-destructive">
          <span>{{ t('settings.fontLoadFailed') }} {{ fontError }}</span>
          <UiButton variant="outline" size="sm" @click="loadFonts">{{ t('records.retry') }}</UiButton>
        </div>
      </div>
      <p class="rounded-md border bg-muted/40 p-3 text-base" data-probe="font-preview">{{ t('settings.fontPreview') }}</p>
    </section>
  </div>
</template>
