import type { HTMLAttributes, ReactNode } from 'react'

interface WorkspaceHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
  className = '',
  ...props
}: WorkspaceHeaderProps) {
  return (
    <header {...props} className={['workspace-header', className].filter(Boolean).join(' ')}>
      {children ?? (
        <>
          <div className="workspace-header__copy">
            {eyebrow != null && <span className="workspace-header__eyebrow">{eyebrow}</span>}
            {title != null && <h1>{title}</h1>}
            {description != null && <p>{description}</p>}
          </div>
          {actions != null && <div className="workspace-header__actions">{actions}</div>}
        </>
      )}
    </header>
  )
}
