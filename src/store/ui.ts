import { ref } from 'vue';
import type { ViewName, WordFilter } from '../types';

/** 当前页签（数据载入后若词库为空，App 会切到导入页） */
export const view = ref<ViewName>('today');
/** 词库页当前筛选（其他页面跳转时可指定，如「已掌握」） */
export const wordFilter = ref<WordFilter>('all');

export function setView(v: ViewName): void {
  view.value = v;
}

/** 跳到词库页，并可指定筛选 */
export function openWords(filter?: WordFilter): void {
  if (filter) wordFilter.value = filter;
  view.value = 'words';
}
