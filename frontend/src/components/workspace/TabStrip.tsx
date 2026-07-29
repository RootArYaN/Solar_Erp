import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from 'react'

interface TabStripProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  label: string
}

export function TabStrip({ children, className = '', label, onKeyDown, ...props }: TabStripProps) {
  return (
    <div
      {...props}
      role="tablist"
      className={['workspace-tab-strip', className].filter(Boolean).join(' ')}
      aria-label={label}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
        if (!tabs.length) return
        const currentIndex = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement))
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : event.key === 'ArrowLeft'
              ? (currentIndex - 1 + tabs.length) % tabs.length
              : (currentIndex + 1) % tabs.length

        event.preventDefault()
        tabs[nextIndex].focus()
        tabs[nextIndex].click()
      }}
    >
      {children}
    </div>
  )
}

interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean
  controls?: string
}

export function TabButton({ active, controls, className = '', children, ...props }: TabButtonProps) {
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      className={[className, active ? 'is-active active' : ''].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  )
}

interface TabPanelProps extends HTMLAttributes<HTMLElement> {
  active: boolean
  children: ReactNode
  className?: string
  labelledBy?: string
}

export function TabPanel({ active, children, className = '', labelledBy, ...props }: TabPanelProps) {
  if (!active) return null
  return (
    <section {...props} role="tabpanel" aria-labelledby={labelledBy} className={className}>
      {children}
    </section>
  )
}
