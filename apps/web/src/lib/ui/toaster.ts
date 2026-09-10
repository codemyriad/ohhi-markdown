/**
 * The app's one toast queue. Notices are announced here without stealing
 * focus (`type: 'background'` → `role=status`, `aria-live=polite`); their
 * durable home is the Activity log (chrome-shaping U5), which is why a toast
 * may vanish — the log does not.
 */
import { createToaster } from '@melt-ui/svelte'

export type ToastLevel = 'error' | 'warn' | 'info'

export interface ToastData {
  level: ToastLevel
  title: string
  description?: string
}

export const toaster = createToaster<ToastData>({ closeDelay: 6000, type: 'background' })

export function toast(data: ToastData, closeDelay?: number): void {
  toaster.helpers.addToast(closeDelay === undefined ? { data } : { data, closeDelay })
}
