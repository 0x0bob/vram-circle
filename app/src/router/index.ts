import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import CreatorView from '../views/CreatorView.vue'
import ProjectView from '../views/ProjectView.vue'
import TaskView from '../views/TaskView.vue'
import ReviewView from '../views/ReviewView.vue'
import MeView from '../views/MeView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/creator', name: 'creator', component: CreatorView },
    { path: '/p/:vault', name: 'project', component: ProjectView, props: true },
    { path: '/p/:vault/task/:taskId', name: 'task', component: TaskView, props: true },
    { path: '/p/:vault/review', name: 'review', component: ReviewView, props: true },
    { path: '/p/:vault/me', name: 'me', component: MeView, props: true },
  ],
})
