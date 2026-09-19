<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TEMPLATE_VARIABLE_GROUPS } from '@shared/template.ts'
import UiTooltip from '@renderer/components/ui/UiTooltip.vue'

const emit = defineEmits<{ insert: [name: string] }>()
const { t } = useI18n()
const label = (name: string): string => '{{' + name + '}}'
</script>

<template>
  <div class="flex flex-col gap-3" data-probe="anime-template-variables">
    <div v-for="group in TEMPLATE_VARIABLE_GROUPS" :key="group.key" class="flex flex-col gap-1.5">
      <span class="text-xs text-muted-foreground">{{ t(group.labelKey) }}</span>
      <div class="flex flex-wrap gap-1.5">
        <UiTooltip v-for="variable in group.vars" :key="variable.name" :content="t('tplVarNote.' + variable.name)">
          <button type="button" class="cursor-pointer rounded-md border bg-secondary px-2 py-1 font-mono text-xs hover:bg-primary/15 hover:text-primary"
            @mousedown.prevent @click="emit('insert', variable.name)">
            {{ label(variable.name) }}
          </button>
        </UiTooltip>
      </div>
    </div>
  </div>
</template>
