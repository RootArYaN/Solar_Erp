import { getStoredFileBlob, getStoredFiles } from '../../api/files'
import type { StoredFile } from '../../types'

export type PdfSignatureImage = {
  bytes: Uint8Array
  width: number
  height: number
}

export type LoadedCustomerSignature = {
  file: StoredFile
  blob: Blob
  dataUrl: string
  pdf: PdfSignatureImage
}

export type DocumentPackRenderAssets = {
  customerSignatureUrl?: string
}

export function isCustomerSignatureFile(file: StoredFile) {
  const owner = file.owner_type.toLowerCase()
  const name = file.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  return owner === 'customer_document:customer_signature'
    || owner.endsWith(':customer_signature')
    || name.includes('customer signature')
}

export function isEmbeddableSignatureFile(file: StoredFile) {
  return isCustomerSignatureFile(file) && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mime_type)
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The uploaded customer signature image could not be read.'))
    }
    image.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The customer signature image could not be prepared for PDF export.')), 'image/jpeg', 0.9)
  })
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The customer signature image could not be prepared for preview.'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareCustomerSignature(blob: Blob): Promise<PdfSignatureImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    throw new Error('Customer signature must be uploaded as a JPG, PNG, or WebP image.')
  }
  const image = await loadImage(blob)
  const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The customer signature image could not be prepared.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const jpeg = await canvasBlob(canvas)
  return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width, height }
}

export async function loadCustomerSignature(customerId: string, knownFiles?: StoredFile[]): Promise<LoadedCustomerSignature | null> {
  if (!customerId) return null
  const files = knownFiles ?? (await getStoredFiles('customer_document', customerId)).data
  const file = files.find(isCustomerSignatureFile)
  if (!file || !isEmbeddableSignatureFile(file)) return null
  const blob = await getStoredFileBlob(file.id)
  const [dataUrl, pdf] = await Promise.all([blobDataUrl(blob), prepareCustomerSignature(blob)])
  return { file, blob, dataUrl, pdf }
}
