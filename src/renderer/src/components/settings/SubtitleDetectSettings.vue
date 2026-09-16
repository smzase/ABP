<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, X, RotateCcw } from '@lucide/vue'
import { SUBTITLE_TYPES, type SubtitleType } from '@shared/types.ts'
import { SUBTITLE_TYPE_I18N_KEY, DEFAULT_LANGUAGES } from '@shared/constants.ts'
import { detectSubtitle, DEFAULT_SUBTITLE_RULES } from '@shared/subtitle-detect.ts'
import { useAppStore } from '@renderer/stores/app.ts'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiBadge from '@renderer/components/ui/UiBadge.vue'
import UiCard from '@renderer/components/ui/UiCard.vue'
import { cn } from '@renderer/lib/utils.ts'

/**
 * 字幕识别设置：
 * 主页四个大按钮（外挂/内封/内嵌/无字幕）→ 点进去管理该类目下的「词」。
 * 每个词可勾选归属语言（CHS/CHT/JP/EN）；预设词可自由修改删除。
 * 底部提供文件名识别测试。
 */
const { t } = useI18n()
const app = useAppStore()

const rules = computed(() => app.data.settings.subtitleDetect.rules)

/** 当前选中的字幕类型（null = 未选，显示总览） */
const activeType = ref<SubtitleType | null>(null)

/** 词分两类展示：带类型的词（外挂/内封…）+ 纯语言词 */
const typeRules = computed(() => rules.value.filter((r) => r.type === activeType.value))
const langRules = computed(() => rules.value.filter((r) => r.type === null))

// 两个「添加词」输入框各用各的 ref —— 共用一个的话在上面打字下面会跟着变
const newTypeWord = ref('')
const newLangWord = ref('')
const newWordLangs = ref<string[]>(['CHS'])

function addWord(withType: boolean): void {
  const source = withType ? newTypeWord : newLangWord
  const w = source.value.trim()
  if (!w) return
  rules.value.push({
    word: w,
    langs: [...newWordLangs.value],
    type: withType ? activeType.value : null
  })
  source.value = ''
}

function removeRule(rule: (typeof rules.value)[number]): void {
  const idx = rules.value.indexOf(rule)
  if (idx >= 0) rules.value.splice(idx, 1)
}

function toggleLang(rule: (typeof rules.value)[number], lang: string): void {
  if (rule.langs.includes(lang)) {
    rule.langs = rule.langs.filter((l) => l !== lang)
  } else {
    rule.langs = [...rule.langs, lang]
  }
}

function toggleNewLang(lang: string): void {
  if (newWordLangs.value.includes(lang)) {
    newWordLangs.value = newWordLangs.value.filter((l) => l !== lang)
  } else {
    newWordLangs.value = [...newWordLangs.value, lang]
  }
}

function resetPresets(): void {
  app.data.settings.subtitleDetect.rules = structuredClone(DEFAULT_SUBTITLE_RULES)
}

// ---------- 识别测试 ----------
const testName = ref('')
const testResult = computed(() =>
  testName.value.trim() ? detectSubtitle(testName.value, rules.value) : null
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <p class="max-w-2xl text-sm text-muted-foreground">{{ t('settings.detectIntro') }}</p>
      <UiButton variant="outline" size="sm" @click="resetPresets">
        <RotateCcw class="h-3.5 w-3.5" /> {{ t('common.reset') }}
      </UiButton>
    </div>

    <!-- 四个类型大按钮 -->
    <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
      <button
        v-for="st in SUBTITLE_TYPES"
        :key="st"
        class="cursor-pointer rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
        :class="
          cn(
            activeType === st ? 'border-primary bg-primary/10 text-primary' : 'bg-card hover:bg-accent',
            activeType === null && 'bg-card hover:bg-accent'
          )
        "
        @click="activeType = activeType === st ? null : st"
      >
        {{ t(SUBTITLE_TYPE_I18N_KEY[st]) }}
        <span class="ml-1.5 text-xs text-muted-foreground">
          {{ rules.filter((r) => r.type === st).length }}
        </span>
      </button>
    </div>

    <!-- 选中类型后的词管理 -->
    <UiCard v-if="activeType" class="p-4">
      <h4 class="mb-3 text-sm font-medium">
        {{ t(SUBTITLE_TYPE_I18N_KEY[activeType]) }} · {{ t('settings.word') }}
      </h4>
      <div class="flex flex-wrap gap-1.5">
        <UiBadge v-for="rule in typeRules" :key="rule.word" variant="secondary" class="gap-1 py-1">
          {{ rule.word }}
          <span v-if="rule.langs.length" class="text-muted-foreground">[{{ rule.langs.join('&') }}]</span>
          <button class="cursor-pointer rounded-sm hover:text-destructive" @click="removeRule(rule)">
            <X class="h-3 w-3" />
          </button>
        </UiBadge>
        <span v-if="typeRules.length === 0" class="text-xs text-muted-foreground">{{ t('common.empty') }}</span>
      </div>
      <div class="mt-3 flex gap-2">
        <UiInput v-model="newTypeWord" class="w-56" :placeholder="t('settings.addWordHint')" @keydown.enter="addWord(true)" />
        <UiButton variant="secondary" size="sm" :disabled="!newTypeWord.trim()" @click="addWord(true)">
          <Plus class="h-3.5 w-3.5" /> {{ t('settings.addWord') }}
        </UiButton>
      </div>
    </UiCard>

    <!-- 语言词（简体/繁体归类） -->
    <UiCard class="p-4">
      <h4 class="mb-1 text-sm font-medium">{{ t('settings.langs') }} · {{ t('settings.word') }}</h4>
      <p class="mb-3 text-xs text-muted-foreground">CHS / CHT / JP / EN</p>
      <div class="flex flex-col gap-1.5">
        <div
          v-for="rule in langRules"
          :key="rule.word"
          class="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
        >
          <span class="min-w-24 font-mono text-sm">{{ rule.word }}</span>
          <div class="flex gap-1">
            <button
              v-for="lang in DEFAULT_LANGUAGES"
              :key="lang"
              class="cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors"
              :class="
                cn(rule.langs.includes(lang) ? 'border-primary bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')
              "
              @click="toggleLang(rule, lang)"
            >
              {{ lang }}
            </button>
          </div>
          <button class="ml-auto cursor-pointer rounded-sm text-muted-foreground hover:text-destructive" @click="removeRule(rule)">
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div class="mt-3 flex items-center gap-2">
        <UiInput v-model="newLangWord" class="w-56" :placeholder="t('settings.addWordHint')" @keydown.enter="addWord(false)" />
        <div class="flex gap-1">
          <button
            v-for="lang in DEFAULT_LANGUAGES"
            :key="lang"
            class="cursor-pointer rounded border px-1.5 py-1 text-xs transition-colors"
            :class="
              cn(newWordLangs.includes(lang) ? 'border-primary bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')
            "
            @click="toggleNewLang(lang)"
          >
            {{ lang }}
          </button>
        </div>
        <UiButton variant="secondary" size="sm" :disabled="!newLangWord.trim()" @click="addWord(false)">
          <Plus class="h-3.5 w-3.5" /> {{ t('settings.addWord') }}
        </UiButton>
      </div>
    </UiCard>

    <!-- 识别测试 -->
    <UiCard class="p-4">
      <h4 class="mb-3 text-sm font-medium">{{ t('settings.testFileName') }}</h4>
      <UiInput v-model="testName" :placeholder="t('settings.testPlaceholder')" class="font-mono" />
      <div v-if="testResult" class="mt-3 flex items-center gap-4 text-sm">
        <span class="text-muted-foreground">{{ t('settings.testResult') }}:</span>
        <span class="flex items-center gap-1">
          {{ t('settings.detectedLangs') }}
          <UiBadge v-for="l in testResult.languages" :key="l">{{ l }}</UiBadge>
          <span v-if="testResult.languages.length === 0" class="text-muted-foreground">{{ t('settings.noneDetected') }}</span>
        </span>
        <span class="flex items-center gap-1">
          {{ t('settings.detectedType') }}
          <UiBadge v-if="testResult.subtitleType" variant="secondary">
            {{ t(SUBTITLE_TYPE_I18N_KEY[testResult.subtitleType]) }}
          </UiBadge>
          <span v-else class="text-muted-foreground">{{ t('settings.noneDetected') }}</span>
        </span>
      </div>
    </UiCard>
  </div>
</template>
