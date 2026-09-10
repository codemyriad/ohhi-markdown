import { getContext, hasContext, setContext } from 'svelte'

/** What a `Field` publishes to the controls inside it. Getters stay reactive. */
export interface FieldContext {
  readonly name: string
  readonly errors: string[]
  readonly required: boolean
  readonly ids: { control: string; errors: string; description: string }
  /** Set by `Description` on mount so the control's `aria-describedby` includes it. */
  hasDescription: boolean
}

const FIELD = Symbol('field')

/** @private — `Field` only. */
export function setField(ctx: FieldContext): FieldContext {
  setContext(FIELD, ctx)
  return ctx
}

/** The closest `Field`; throws with the fix spelled out, as Edible's does. */
export function getField(): FieldContext {
  if (!hasContext(FIELD)) {
    throw new Error('Unable to find `Field` context. Did you forget to wrap the control in a `<Field>`?')
  }
  return getContext<FieldContext>(FIELD)
}
