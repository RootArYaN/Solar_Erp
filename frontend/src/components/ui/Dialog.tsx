import { X } from 'lucide-react'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let bodyLockCount = 0
let bodyOverflowBeforeLock = ''
const dialogStack: symbol[] = []

function registerDialog(id: symbol): void { dialogStack.push(id) }
function unregisterDialog(id: symbol): void {
  const index = dialogStack.lastIndexOf(id)
  if (index >= 0) dialogStack.splice(index, 1)
}
function isTopDialog(id: symbol): boolean { return dialogStack[dialogStack.length - 1] === id }

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  bodyLockCount += 1
}

function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1)
  if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock
}

export function useDialogLifecycle({
  open,
  containerRef,
  initialFocusRef,
  onClose,
  closeOnEscape = true,
  trapFocus = true,
}: {
  open: boolean
  containerRef: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  onClose: () => void
  closeOnEscape?: boolean
  trapFocus?: boolean
}) {
  const dialogIdRef = useRef(Symbol('dialog'))
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  const trapFocusRef = useRef(trapFocus)
  onCloseRef.current = onClose
  closeOnEscapeRef.current = closeOnEscape
  trapFocusRef.current = trapFocus

  useEffect(() => {
    if (!open) return

    const dialogId = dialogIdRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    registerDialog(dialogId)
    lockBodyScroll()

    const focusTimer = window.setTimeout(() => {
      if (!isTopDialog(dialogId)) return
      const preferred = initialFocusRef?.current
      const firstFocusable = containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(preferred ?? firstFocusable ?? containerRef.current)?.focus()
    }, 0)

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopDialog(dialogId)) return
      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !trapFocusRef.current) return
      const focusable = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      if (!focusable.length) {
        event.preventDefault()
        containerRef.current?.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleKeyDown, true)
      unregisterDialog(dialogId)
      unlockBodyScroll()
      previousFocus?.focus()
    }
  }, [containerRef, initialFocusRef, open])

  return () => isTopDialog(dialogIdRef.current)
}

type DialogContextValue = {
  titleId: string
  descriptionId: string
}

const DialogContext = createContext<DialogContextValue | null>(null)

export function useDialogIds() {
  const value = useContext(DialogContext)
  if (!value) throw new Error('useDialogIds must be used inside Dialog')
  return value
}

export type DialogProps = {
  open?: boolean
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  headerClassName?: string
  layerClassName?: string
  hideTitle?: boolean
  role?: 'dialog' | 'alertdialog'
  closeLabel?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  trapFocus?: boolean
  closeDisabled?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  dialogRef?: MutableRefObject<HTMLElement | null>
  onClose: () => void
}

export function Dialog({
  open = true,
  title,
  subtitle,
  children,
  footer,
  className = '',
  bodyClassName = '',
  headerClassName = '',
  layerClassName = '',
  hideTitle = false,
  role = 'dialog',
  closeLabel = 'Close dialog',
  closeOnBackdrop = true,
  closeOnEscape = true,
  trapFocus = true,
  closeDisabled = false,
  initialFocusRef,
  dialogRef,
  onClose,
}: DialogProps) {
  const internalRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const activeRef = dialogRef ?? internalRef

  const isTopMostDialog = useDialogLifecycle({
    open,
    containerRef: activeRef,
    initialFocusRef,
    onClose,
    closeOnEscape: closeOnEscape && !closeDisabled,
    trapFocus,
  })

  if (!open) return null

  return createPortal(
    <DialogContext.Provider value={{ titleId, descriptionId }}>
      <div
        className={['modal-layer', layerClassName].filter(Boolean).join(' ')}
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && isTopMostDialog() && closeOnBackdrop && !closeDisabled) onClose()
        }}
      >
        <section
          ref={activeRef}
          className={['modal-card', className].filter(Boolean).join(' ')}
          role={role}
          aria-modal="true"
          aria-labelledby={hideTitle ? undefined : titleId}
          aria-label={hideTitle && typeof title === 'string' ? title : undefined}
          aria-describedby={!hideTitle && subtitle ? descriptionId : undefined}
          tabIndex={-1}
        >
          <header className={['modal-card__header', hideTitle ? 'modal-card__header--titleless' : '', headerClassName].filter(Boolean).join(' ')}>
            {!hideTitle && (
              <div>
                <h2 id={titleId}>{title}</h2>
                {subtitle && <p id={descriptionId}>{subtitle}</p>}
              </div>
            )}
            <button type="button" className="icon-button" onClick={onClose} disabled={closeDisabled} aria-label={closeLabel}>
              <X size={18} />
            </button>
          </header>
          <div className={['modal-card__body', bodyClassName].filter(Boolean).join(' ')} data-scroll-surface="modal-body">
            {children}
          </div>
          {footer}
        </section>
      </div>
    </DialogContext.Provider>,
    document.body,
  )
}
