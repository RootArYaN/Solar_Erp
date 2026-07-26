import type { HTMLAttributes, ReactNode } from 'react'

interface WorkspaceToolbarProps extends HTMLAttributes<HTMLDivElement> {
  controls?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export function WorkspaceToolbar({ controls, actions, children, className = '', ...props }: WorkspaceToolbarProps) {
  return (
    <div {...props} className={['workspace-toolbar', className].filter(Boolean).join(' ')}>
      {children ?? (
        <>
          {controls != null && <div className="workspace-toolbar__controls">{controls}</div>}
          {actions != null && <div className="workspace-toolbar__actions">{actions}</div>}
        </>
      )}
    </div>
  )
}
