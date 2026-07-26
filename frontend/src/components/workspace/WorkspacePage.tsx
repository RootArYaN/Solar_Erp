import type { ElementType, HTMLAttributes, ReactNode } from 'react'

export type WorkspacePageVariant = 'default' | 'split' | 'detail' | 'fixed-tabs'

interface WorkspacePageProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  className?: string
  variant?: WorkspacePageVariant
  as?: ElementType
}

export function WorkspacePage({
  children,
  className = '',
  variant = 'default',
  as: Component = 'section',
  ...props
}: WorkspacePageProps) {
  return (
    <Component
      {...props}
      className={['workspace-page', `workspace-page--${variant}`, className].filter(Boolean).join(' ')}
    >
      {children}
    </Component>
  )
}
