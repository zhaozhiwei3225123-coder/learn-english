import { ref } from 'vue';

export const toastMessage = ref('');
let timer: number | undefined;

/** duration 传 0 时保持显示，直到下一次 toast 覆盖 */
export function toast(msg: string, duration = 2200): void {
  toastMessage.value = msg;
  if (timer) window.clearTimeout(timer);
  timer = duration > 0
    ? window.setTimeout(() => {
        toastMessage.value = '';
      }, duration)
    : undefined;
}
