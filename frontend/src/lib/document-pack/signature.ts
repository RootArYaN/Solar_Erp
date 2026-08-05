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
  vendorSignatureUrl?: string
}

export type PreparedSignatureImage = {
  dataUrl: string
  pdf: PdfSignatureImage
}

const signatureMimeTypes = ['image/jpeg', 'image/png', 'image/webp']

export function isSignatureDataUrl(value: unknown): value is string {
  return typeof value === 'string'
    && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)
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

function loadImage(blob: Blob, label: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`The ${label.toLowerCase()} image could not be read.`))
    }
    image.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement, label: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`The ${label.toLowerCase()} image could not be prepared.`)), 'image/jpeg', 0.88)
  })
}

function blobDataUrl(blob: Blob, label: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`The ${label.toLowerCase()} image could not be prepared for preview.`))
    reader.readAsDataURL(blob)
  })
}

async function prepareSignatureImage(blob: Blob, label: string, maxDimension = 1200): Promise<PreparedSignatureImage> {
  if (!signatureMimeTypes.includes(blob.type)) {
    throw new Error(`${label} must be uploaded as a JPG, PNG, or WebP image.`)
  }
  const image = await loadImage(blob, label)
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error(`The ${label.toLowerCase()} image could not be prepared.`)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const jpeg = await canvasBlob(canvas, label)
  const [dataUrl, bytes] = await Promise.all([
    blobDataUrl(jpeg, label),
    jpeg.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
  ])
  return { dataUrl, pdf: { bytes, width, height } }
}

export async function prepareCustomerSignature(blob: Blob): Promise<PdfSignatureImage> {
  return (await prepareSignatureImage(blob, 'Customer signature')).pdf
}

export function prepareVendorSignature(blob: Blob): Promise<PreparedSignatureImage> {
  return prepareSignatureImage(blob, 'Vendor signature', 800)
}

export async function prepareVendorSignatureDataUrl(value: string): Promise<PdfSignatureImage | undefined> {
  if (!isSignatureDataUrl(value)) return undefined
  const response = await fetch(value)
  return (await prepareSignatureImage(await response.blob(), 'Vendor signature', 800)).pdf
}

export async function loadCustomerSignature(customerId: string, knownFiles?: StoredFile[]): Promise<LoadedCustomerSignature | null> {
  if (!customerId) return null
  const files = knownFiles ?? (await getStoredFiles('customer_document', customerId)).data
  const file = files.find(isCustomerSignatureFile)
  if (!file || !isEmbeddableSignatureFile(file)) return null
  const downloaded = await getStoredFileBlob(file.id)
  const blob = downloaded.type === file.mime_type
    ? downloaded
    : new Blob([downloaded], { type: file.mime_type })
  const [dataUrl, pdf] = await Promise.all([blobDataUrl(blob, 'Customer signature'), prepareCustomerSignature(blob)])
  return { file, blob, dataUrl, pdf }
}
