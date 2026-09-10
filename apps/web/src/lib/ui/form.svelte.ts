/**
 * Schema-validated form state for the shell's dialogs (chrome-shaping Fork 1,
 * shape B): zod for the rules, runes for the reactivity, and the `Field` /
 * `TextControl` / `FieldErrors` components for the ARIA. Superforms is the
 * right tool the day there is a SvelteKit form action to enhance; there is
 * not one in a local-first Tauri shell, and this is the part of that pattern
 * which carries the accessibility.
 *
 * Errors surface per field once it has been touched (blurred) or the form
 * submitted — never on first paint, which would shout at an empty dialog.
 */
import type { ZodType } from 'zod'

export interface Form<T extends Record<string, unknown>> {
  /** Live, bindable: `bind:value={form.data.link}`. */
  readonly data: T
  readonly valid: boolean
  readonly busy: boolean
  /** A failure thrown by the submit handler, for the dialog to show. */
  readonly formError: string
  /** Errors for one field, empty until the field is touched or a submit happened. */
  errorsFor(name: keyof T & string): string[]
  touch(name: keyof T & string): void
  /**
   * Validate, then run `handler` with the parsed value. Resolves true on
   * success; on a thrown error, `formError` carries the message and the
   * dialog stays open so the user can fix and retry.
   */
  submit(handler: (value: T) => Promise<void> | void): Promise<boolean>
  reset(): void
}

export function createForm<T extends Record<string, unknown>>(
  schema: ZodType<T>,
  initial: T
): Form<T> {
  let data = $state<T>(structuredClone(initial))
  let touched = $state<Partial<Record<keyof T, boolean>>>({})
  let submitted = $state(false)
  let busy = $state(false)
  let formError = $state('')

  const parsed = $derived(schema.safeParse(data))
  const errors = $derived.by(() => {
    const out: Partial<Record<keyof T, string[]>> = {}
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '') as keyof T
        ;(out[key] ??= []).push(issue.message)
      }
    }
    return out
  })

  return {
    get data() {
      return data
    },
    get valid() {
      return parsed.success
    },
    get busy() {
      return busy
    },
    get formError() {
      return formError
    },
    errorsFor(name) {
      return touched[name] || submitted ? (errors[name] ?? []) : []
    },
    touch(name) {
      touched[name] = true
    },
    async submit(handler) {
      submitted = true
      if (!parsed.success) return false
      busy = true
      formError = ''
      try {
        await handler(parsed.data)
        return true
      } catch (err) {
        formError = err instanceof Error ? err.message : String(err)
        return false
      } finally {
        busy = false
      }
    },
    reset() {
      data = structuredClone(initial)
      touched = {}
      submitted = false
      formError = ''
    },
  }
}
