import type { HTMLAttributes, ReactNode } from 'react'

export type ActionBarLayout = 'wrap' | 'grid' | 'scroll'
export type ActionBarAlign = 'start' | 'end' | 'stretch'

interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  layout?: ActionBarLayout
  align?: ActionBarAlign
}

export function ActionBar({
  children,
  layout = 'wrap',
  align = 'end',
  className = '',
  ...props
}: ActionBarProps) {
  return (
    <div
      {...props}
      className={[
        'ui-action-bar',
        `ui-action-bar--${layout}`,
        `ui-action-bar--${align}`,
        className,
      ].filter(Boolean).join(' ')}
      data-action-layout={layout}
    >
      {children}
    </div>
  )
}
