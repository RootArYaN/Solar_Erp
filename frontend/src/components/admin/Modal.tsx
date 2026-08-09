import type { ReactNode } from 'react'
import { Dialog } from '../ui/Dialog'

export function Modal({ title, subtitle, children, footer, className = '', bodyClassName = '', hideTitle = false, onClose }: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  hideTitle?: boolean
  onClose: () => void
}) {
  return (
    <Dialog title={title} subtitle={subtitle} footer={footer} className={className} bodyClassName={bodyClassName} hideTitle={hideTitle} onClose={onClose}>
      {children}
    </Dialog>
  )
}
