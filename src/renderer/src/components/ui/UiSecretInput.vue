<script setup lang="ts">
import { ref } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { cn } from '@renderer/lib/utils.ts'
import UiInput from './UiInput.vue'
import UiTooltip from './UiTooltip.vue'

defineOptions({ inheritAttrs: false })
defineProps<{ class?: string; placeholder?: string }>()
const model = defineModel<string>({ default: '' })
const visible = ref(false)
const { t } = useI18n()
</script>

<template>
  <div class="relative min-w-0">
    <UiInput
      v-bind="$attrs"
      v-model="model"
      :type="visible ? 'text' : 'password'"
      :placeholder="placeholder"
      :class="cn('pr-10', $props.class)"
    />
    <UiTooltip :content="visible ? t('accounts.hideSecret') : t('accounts.showSecret')">
      <button
        type="button"
        class="absolute right-1 top-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        :aria-label="visible ? t('accounts.hideSecret') : t('accounts.showSecret')"
        @click="visible = !visible"
      >
        <EyeOff v-if="visible" class="h-4 w-4" />
        <Eye v-else class="h-4 w-4" />
      </button>
    </UiTooltip>
  </div>
</template>
