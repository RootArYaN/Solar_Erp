import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import appleTouchIconUrl from './assets/apple-touch-icon.png'
import favicon16Url from './assets/favicon-16.png'
import favicon32Url from './assets/favicon-32.png'
import faviconIcoUrl from './assets/favicon.ico'
import faviconSvgUrl from './assets/favicon.svg'
import safariPinnedTabUrl from './assets/safari-pinned-tab.svg'
import { ToastProvider } from './components/ui/ToastProvider'
import './styles/design-tokens.css'
import './styles/base.css'
import './styles/ui-primitives.css'
import './styles/erp-shared.css'
import './styles/shell-admin.css'
import './styles/agents.css'
import './styles/documents-posters.css'
import './styles/operations.css'
import './styles/feedback.css'
import './styles/workflow.css'
import './styles/finance.css'
import './styles/workspace.css'
import './styles/ui-system.css'

type AppIcon = {
  id: string
  rel: string
  href: string
  type?: string
  sizes?: string
  color?: string
}

function installAppIcons() {
  const icons: AppIcon[] = [
    {
      id: 'solar-erp-favicon-svg',
      rel: 'icon',
      type: 'image/svg+xml',
      sizes: 'any',
      href: faviconSvgUrl,
    },
    {
      id: 'solar-erp-favicon-32',
      rel: 'icon',
      type: 'image/png',
      sizes: '32x32',
      href: favicon32Url,
    },
    {
      id: 'solar-erp-favicon-16',
      rel: 'icon',
      type: 'image/png',
      sizes: '16x16',
      href: favicon16Url,
    },
    {
      id: 'solar-erp-favicon-ico',
      rel: 'shortcut icon',
      type: 'image/x-icon',
      href: faviconIcoUrl,
    },
    {
      id: 'solar-erp-apple-touch-icon',
      rel: 'apple-touch-icon',
      sizes: '180x180',
      href: appleTouchIconUrl,
    },
    {
      id: 'solar-erp-safari-mask-icon',
      rel: 'mask-icon',
      color: '#123247',
      href: safariPinnedTabUrl,
    },
  ]

  document
    .querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]',
    )
    .forEach((link) => link.remove())

  icons.forEach(({ id, rel, href, type, sizes, color }) => {
    const link = document.createElement('link')
    link.id = id
    link.rel = rel
    link.href = href
    if (type) link.type = type
    if (sizes) link.setAttribute('sizes', sizes)
    if (color) link.setAttribute('color', color)
    document.head.appendChild(link)
  })

  let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!themeColor) {
    themeColor = document.createElement('meta')
    themeColor.name = 'theme-color'
    document.head.appendChild(themeColor)
  }
  themeColor.content = '#123247'
}

installAppIcons()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
