import { createApp } from 'vue'
import DashboardMenu from './DashboardMenu.vue'
import { i18n } from './i18n/index.ts'
import './styles/main.css'

createApp(DashboardMenu).use(i18n).mount('#app')
