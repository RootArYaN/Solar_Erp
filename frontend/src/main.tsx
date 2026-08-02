import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider } from './components/ui/ToastProvider'
import './styles/base.css'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
