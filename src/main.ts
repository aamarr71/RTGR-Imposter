import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installChunkRecovery } from './router/chunkRecovery'
import { installPwaUpdateLifecycle } from './services/pwaUpdate'
import './styles/base.css'

installChunkRecovery(router)
createApp(App).use(createPinia()).use(router).mount('#app')
installPwaUpdateLifecycle()
