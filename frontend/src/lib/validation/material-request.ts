import type { FieldErrors } from '../../contracts/api-contracts'
import type { MaterialRequestLine } from '../../contracts/domain-contracts'

export function validateMaterialRequestDraft(purpose: string, lines: MaterialRequestLine[]): FieldErrors {
  const errors: FieldErrors = {}
  if (!purpose.trim()) errors.purpose = ['Purpose is required']
  lines.forEach((line, index) => {
    if (!line.description.trim()) errors[`lines.${index}.description`] = ['Description is required']
    const quantity = Number(line.requested_quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) errors[`lines.${index}.requested_quantity`] = ['Quantity must be greater than zero']
  })
  return errors
}
