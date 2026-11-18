/**
 * The typing aids in the shell (Settings › Editor): spell checking,
 * autocorrect and sentence capitalisation, the device preference mirrored
 * reactively so every open editor follows Settings the moment it changes
 * (the editor applies them through a compartment — no note is reopened).
 * The pattern is `read.svelte.ts`'s: one module owns the preference,
 * Settings writes through it, and nothing else reads config for it.
 */
import type { TypingAids } from '@ohhi/editor'
import { setTypingPrefs, typingPrefs, type TypingPrefs } from './config.js'

/** Replaced whole on a change, so a consumer holding the object sees a new one. */
export const typingState = $state<{ aids: TypingAids }>({ aids: typingPrefs() })

export function setTypingAid(key: keyof TypingPrefs, on: boolean): void {
  typingState.aids = { ...typingState.aids, [key]: on }
  setTypingPrefs({ [key]: on })
}
