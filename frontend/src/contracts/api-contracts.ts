export type UUID = string
export type UTCTimestamp = string
export type DecimalString = string
export type RecordNumber = string
export type Cursor = string

export type PaginatedList<T> = {
  items: T[]
  next_cursor: Cursor | null
  sync_cursor: Cursor | null
  page?: number
  page_size?: number
  total?: number
}

export type FieldErrors = Record<string, string[]>

export type ApiErrorBody = {
  code: string
  message: string
  field_errors: FieldErrors
  request_id: string | null
}


export type VersionedRecord = {
  version: number
  created_at: UTCTimestamp
  updated_at: UTCTimestamp
}

export type UploadStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled'

export type FileMetadata = VersionedRecord & {
  id: UUID
  record_number: RecordNumber
  original_name: string
  display_name: string
  mime_type: string
  size_bytes: number
  checksum_sha256: string | null
  status: UploadStatus
  upload_progress: number
  failure_code: string | null
  failure_message: string | null
  preview_url_expires_at: UTCTimestamp | null
  download_url_expires_at: UTCTimestamp | null
}

export type SignedFileUrl = {
  url: string
  expires_at: UTCTimestamp
}

export type SyncCommandName = 'create' | 'update' | 'delete'

export type SyncCommand<TPayload = unknown> = {
  command_id: UUID
  command: SyncCommandName
  entity_type: string
  entity_id: UUID
  expected_version: number | null
  idempotency_key: string
  payload: TPayload
  created_at: UTCTimestamp
}

export type ConflictField = {
  field: string
  client_value: unknown
  server_value: unknown
}

export type ConflictResponse<TRecord = unknown> = ApiErrorBody & {
  code: 'version_conflict'
  current_record: TRecord
  expected_version: number | null
  current_version: number
  conflicts: ConflictField[]
}

export type IdempotentRequestOptions = {
  idempotencyKey?: string
}
