import type { ReactNode } from 'react'
import { Dialog } from '../ui/Dialog'

export function Modal({ title, subtitle, children, className = '', bodyClassName = '', hideTitle = false, onClose }: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
  hideTitle?: boolean
  onClose: () => void
}) {
  return (
    <Dialog title={title} subtitle={subtitle} className={className} bodyClassName={bodyClassName} hideTitle={hideTitle} onClose={onClose}>
      {children}
    </Dialog>
  )
}
