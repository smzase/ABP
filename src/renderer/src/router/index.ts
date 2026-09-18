import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/publish' },
    { path: '/publish', name: 'publish', component: () => import('../views/PublishView.vue') },
    {
      path: '/templates',
      name: 'templates',
      component: () => import('../views/TemplatesView.vue'),
      meta: { keepAlive: true }
    },
    { path: '/accounts', name: 'accounts', component: () => import('../views/AccountsView.vue') },
    { path: '/records', name: 'records', component: () => import('../views/RecordsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') }
  ]
})
