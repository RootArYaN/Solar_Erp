export const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

export const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

export function amount(value: string) {
  return Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0
}

export function esc(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function plainAscii(value: unknown) {
  return String(value ?? '')
    .replaceAll('₹', 'INR ')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
}

export function printable(value: unknown) {
  return plainAscii(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

export function wrap(value: unknown, width = 76) {
  const words = plainAscii(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > width && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['-']
}

export function safeName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'customer'
}

export function expiryDate(dateValue: string, daysValue: string) {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date()
  date.setDate(date.getDate() + (Number(daysValue) || 15))
  return date.toLocaleDateString('en-IN')
}
