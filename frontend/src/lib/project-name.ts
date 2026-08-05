export function projectDisplayName(value: string, customerName: string): string {
  const title = value.trim()
  const customer = customerName.trim()
  if (!title || !customer) return title

  const separator = title.lastIndexOf('·')
  if (separator < 0) return title

  const suffix = title.slice(separator + 1).trim()
  return suffix.localeCompare(customer, undefined, { sensitivity: 'base' }) === 0
    ? title.slice(0, separator).trim()
    : title
}
