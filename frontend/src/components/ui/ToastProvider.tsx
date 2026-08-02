import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClientId } from '../../lib/client-id'
import { simpleToastError } from '../../lib/error-messages'

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

type ToastInput = {
  title?: string
  message: string
  variant?: ToastVariant
  duration?: number
}

type ToastItem = Required<Pick<ToastInput, 'message' | 'variant' | 'duration'>> & {
  id: string
  title?: string
}

type ToastContextValue = {
  toast: (input: ToastInput | string) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((input: ToastInput | string) => {
    const value = typeof input === 'string' ? { message: input } : input
    const id = createClientId()
    const item: ToastItem = {
      id,
      title: value.title ?? (value.variant === 'error' ? 'Action failed' : undefined),
      message: value.variant === 'error' ? simpleToastError(value.message) : value.message,
      variant: value.variant ?? 'info',
      duration: value.duration ?? (value.variant === 'error' ? 6500 : 4200),
    }

    setItems((current) => {
      const next = [...current, item]
      next.slice(0, -4).forEach((removed) => {
        const timer = timers.current.get(removed.id)
        if (timer !== undefined) window.clearTimeout(timer)
        timers.current.delete(removed.id)
      })
      return next.slice(-4)
    })
    timers.current.set(id, window.setTimeout(() => dismiss(id), item.duration))
    return id
  }, [dismiss])

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer))
    timers.current.clear()
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [dismiss, toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(<div className="toast-viewport" aria-live="polite" aria-relevant="additions removals">
        {items.map((item) => {
          const Icon = icons[item.variant]
          return (
            <article className={`toast toast--${item.variant}`} key={item.id} role={item.variant === 'error' ? 'alert' : 'status'}>
              <div className="toast__icon"><Icon size={18} /></div>
              <div className="toast__content">
                {item.title && <strong>{item.title}</strong>}
                <span>{item.message}</span>
              </div>
              <button type="button" onClick={() => dismiss(item.id)} aria-label="Dismiss notification"><X size={15} /></button>
              <span className="toast__progress" style={{ animationDuration: `${item.duration}ms` }} />
            </article>
          )
        })}
      </div>, document.body)}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
