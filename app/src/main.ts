import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { WagmiPlugin } from '@wagmi/vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { wagmiConfig } from './wagmi'
import './style.css'

createApp(App)
  .use(createPinia())
  .use(router)
  .use(VueQueryPlugin)
  .use(WagmiPlugin, { config: wagmiConfig })
  .mount('#app')
