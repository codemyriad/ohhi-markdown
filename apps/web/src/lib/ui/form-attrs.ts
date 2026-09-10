/**
 * The ARIA wiring of a form control, as pure functions — the same names and
 * the same outputs as Edible's `form-field` builder (itself lifted from
 * formsnap), so the pattern transfers unchanged even though the reactive
 * plumbing here is runes rather than stores.
 */

/** `aria-describedby` from a description and/or a validation message. */
export function getAriaDescribedBy({
  descriptionId,
  fieldErrorsId,
  errors,
}: {
  descriptionId: string | undefined
  fieldErrorsId: string | undefined
  errors: string[]
}): string | undefined {
  const ids: string[] = []
  if (descriptionId) ids.push(descriptionId)
  if (errors.length > 0 && fieldErrorsId) ids.push(fieldErrorsId)
  return ids.length > 0 ? ids.join(' ') : undefined
}

export function getAriaInvalid(errors: string[] | undefined): 'true' | undefined {
  return errors && errors.length > 0 ? 'true' : undefined
}

export function getRequiredAttr(required: boolean): true | undefined {
  return required ? true : undefined
}

export function getAriaRequired(required: boolean): 'true' | undefined {
  return required ? 'true' : undefined
}

export interface ControlAttrs {
  id: string
  name: string
  'aria-describedby': string | undefined
  'aria-invalid': 'true' | undefined
  required: true | undefined
  'aria-required': 'true' | undefined
}

export function controlAttrs(field: {
  name: string
  errors: string[]
  required: boolean
  hasDescription: boolean
  ids: { control: string; errors: string; description: string }
}): ControlAttrs {
  return {
    id: field.ids.control,
    name: field.name,
    'aria-describedby': getAriaDescribedBy({
      descriptionId: field.hasDescription ? field.ids.description : undefined,
      fieldErrorsId: field.ids.errors,
      errors: field.errors,
    }),
    'aria-invalid': getAriaInvalid(field.errors),
    required: getRequiredAttr(field.required),
    'aria-required': getAriaRequired(field.required),
  }
}
