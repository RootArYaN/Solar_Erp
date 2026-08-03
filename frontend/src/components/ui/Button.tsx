import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'default' | 'compact' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'default',
  leadingIcon,
  trailingIcon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={[
        'ui-button',
        `ui-button--${variant}`,
        `ui-button--${size}`,
        className,
      ].filter(Boolean).join(' ')}
    >
      {leadingIcon != null && <span className="ui-button__icon" aria-hidden="true">{leadingIcon}</span>}
      {children != null && <span className="ui-button__label">{children}</span>}
      {trailingIcon != null && <span className="ui-button__icon" aria-hidden="true">{trailingIcon}</span>}
    </button>
  )
}
