import type { ElementType, HTMLAttributes, ReactNode } from 'react'

export type CardVariant = 'surface' | 'subtle' | 'interactive'

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
  variant?: CardVariant
  children: ReactNode
}

export function Card({ as: Component = 'section', variant = 'surface', className = '', children, ...props }: CardProps) {
  return (
    <Component
      {...props}
      className={['ui-card', `ui-card--${variant}`, className].filter(Boolean).join(' ')}
    >
      {children}
    </Component>
  )
}
