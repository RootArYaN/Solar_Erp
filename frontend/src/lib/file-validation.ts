export type FileValidationRule = {
  maxBytes: number
  allowedMimeTypes: string[]
  allowedExtensions?: string[]
}

export type FileValidationResult = { valid: true } | { valid: false; message: string }

const megabyte = 1024 * 1024
const dangerousEmbeddedExtensions = new Set([
  'app', 'asp', 'aspx', 'bat', 'cgi', 'cmd', 'com', 'dll', 'dmg', 'exe', 'hta', 'jar', 'js', 'jse', 'lnk', 'msi', 'php', 'phtml', 'ps1', 'py', 'rb', 'scr', 'sh', 'vbs', 'vbe',
])

const extensionMimeTypes: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
}

export const fileUploadRules: Record<'customerDocument' | 'customerVerificationDocument' | 'poster' | 'bill', FileValidationRule> = {
  customerDocument: {
    maxBytes: 15 * megabyte,
    allowedMimeTypes: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.docx', '.xlsx'],
  },
  customerVerificationDocument: {
    maxBytes: 10 * megabyte,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  },
  poster: {
    maxBytes: 15 * megabyte,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  },
  bill: {
    maxBytes: 15 * megabyte,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  },
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

function suspiciousName(name: string): boolean {
  if (!name || name.length > 180 || /[\u0000-\u001f\u202a-\u202e\u2066-\u2069\\/]/.test(name) || name.startsWith('.') || /[. ]$/.test(name)) return true
  const parts = name.toLowerCase().split('.')
  return parts.slice(1, -1).some((part) => dangerousEmbeddedExtensions.has(part))
}

function mimeAllowed(mimeType: string, allowed: string[]): boolean {
  return allowed.some((value) => value.endsWith('/*') ? mimeType.startsWith(value.slice(0, -1)) : mimeType === value)
}

export function validateUpload(file: File, rule: FileValidationRule): FileValidationResult {
  if (suspiciousName(file.name)) return { valid: false, message: `${file.name || 'The selected file'} has an unsafe file name` }
  if (file.size <= 0) return { valid: false, message: `${file.name} is empty` }
  if (file.size > rule.maxBytes) return { valid: false, message: `${file.name} exceeds ${formatFileSize(rule.maxBytes)}` }

  const extension = fileExtension(file.name)
  if (rule.allowedExtensions && !rule.allowedExtensions.includes(extension)) {
    return { valid: false, message: `${file.name} has an unsupported extension` }
  }

  if (file.type && !mimeAllowed(file.type.toLowerCase(), rule.allowedMimeTypes)) {
    return { valid: false, message: `${file.name} reports an unsupported file type` }
  }

  const expectedMimeTypes = extensionMimeTypes[extension]
  if (file.type && expectedMimeTypes && !expectedMimeTypes.includes(file.type.toLowerCase())) {
    return { valid: false, message: `${file.name} has a mismatched extension and file type` }
  }

  return { valid: true }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function hasExpectedSignature(extension: string, bytes: Uint8Array): boolean {
  if (extension === '.pdf') {
    const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]
    return bytes.some((_, offset) => offset <= bytes.length - signature.length && signature.every((value, index) => bytes[offset + index] === value))
  }
  if (extension === '.png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (extension === '.jpg' || extension === '.jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff])
  if (extension === '.webp') {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  }
  if (extension === '.docx' || extension === '.xlsx') {
    return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
      || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
      || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  }
  return false
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.onload = () => {
      if (reader.result && typeof reader.result !== 'string') resolve(reader.result)
      else reject(new Error('Could not read file'))
    }
    reader.readAsArrayBuffer(blob)
  })
}

async function hasExpectedOoxmlEntries(file: File, extension: string): Promise<boolean> {
  if (extension !== '.docx' && extension !== '.xlsx') return true
  const tailBytes = 256 * 1024
  const tail = await readBlob(file.slice(Math.max(0, file.size - tailBytes)))
  const entries = new TextDecoder('latin1').decode(tail)
  const subtypeEntry = extension === '.docx' ? 'word/document.xml' : 'xl/workbook.xml'
  return entries.includes('[Content_Types].xml') && entries.includes(subtypeEntry)
}

export async function validateUploadFile(file: File, rule: FileValidationRule): Promise<FileValidationResult> {
  const basic = validateUpload(file, rule)
  if (!basic.valid) return basic

  const extension = fileExtension(file.name)
  try {
    const bytes = new Uint8Array(await readBlob(file.slice(0, 1024)))
    if (!hasExpectedSignature(extension, bytes) || !await hasExpectedOoxmlEntries(file, extension)) {
      return { valid: false, message: `${file.name} content does not match its extension` }
    }
  } catch {
    return { valid: false, message: `${file.name} could not be read safely` }
  }
  return { valid: true }
}

export function formatFileSize(bytes: number): string {
  if (bytes < megabyte) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / megabyte).toFixed(1)} MB`
}
