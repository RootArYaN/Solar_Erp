import type { ReactNode } from 'react'
import { Dialog } from '../ui/Dialog'

export function Modal({ title, subtitle, children, className = '', hideTitle = false, onClose }: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  hideTitle?: boolean
  onClose: () => void
}) {
  return (
    <Dialog title={title} subtitle={subtitle} className={className} hideTitle={hideTitle} onClose={onClose}>
      {children}
    </Dialog>
  )
}
