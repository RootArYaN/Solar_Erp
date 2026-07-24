export type FileValidationRule = {
  maxBytes: number
  allowedMimeTypes: string[]
  allowedExtensions?: string[]
}

export type FileValidationResult = { valid: true } | { valid: false; message: string }

export function validateUpload(file: File, rule: FileValidationRule): FileValidationResult {
  if (file.size <= 0) return { valid: false, message: `${file.name} is empty` }
  if (file.size > rule.maxBytes) {
    return { valid: false, message: `${file.name} exceeds ${formatFileSize(rule.maxBytes)}` }
  }

  const extension = file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : ''
  const mimeAllowed = rule.allowedMimeTypes.some((allowed) => (
    allowed.endsWith('/*') ? file.type.startsWith(allowed.slice(0, -1)) : file.type === allowed
  ))
  const extensionAllowed = Boolean(rule.allowedExtensions?.includes(extension))

  if (!mimeAllowed && !extensionAllowed) return { valid: false, message: `${file.name} has an unsupported file type` }
  return { valid: true }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
