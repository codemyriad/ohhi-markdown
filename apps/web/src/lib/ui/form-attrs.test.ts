import { describe, expect, it } from 'vitest'
import { controlAttrs, getAriaDescribedBy, getAriaInvalid } from './form-attrs.js'

describe('form-attrs (the Edible form-field contract)', () => {
  it('describes by the description, and by the errors only when there are some', () => {
    expect(getAriaDescribedBy({ descriptionId: 'd', fieldErrorsId: 'e', errors: [] })).toBe('d')
    expect(getAriaDescribedBy({ descriptionId: 'd', fieldErrorsId: 'e', errors: ['x'] })).toBe('d e')
    expect(getAriaDescribedBy({ descriptionId: undefined, fieldErrorsId: 'e', errors: ['x'] })).toBe('e')
    expect(getAriaDescribedBy({ descriptionId: undefined, fieldErrorsId: 'e', errors: [] })).toBeUndefined()
  })

  it('marks invalid only with errors present', () => {
    expect(getAriaInvalid([])).toBeUndefined()
    expect(getAriaInvalid(['bad'])).toBe('true')
  })

  it('assembles the control attrs from a field', () => {
    const ids = { control: 'c', errors: 'e', description: 'd' }
    expect(controlAttrs({ name: 'link', errors: [], required: true, hasDescription: false, ids })).toEqual({
      id: 'c',
      name: 'link',
      'aria-describedby': undefined,
      'aria-invalid': undefined,
      required: true,
      'aria-required': 'true',
    })
    expect(
      controlAttrs({ name: 'link', errors: ['no'], required: false, hasDescription: true, ids })
    ).toMatchObject({ 'aria-describedby': 'd e', 'aria-invalid': 'true', required: undefined })
  })
})
