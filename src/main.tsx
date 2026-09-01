import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Imported for its side effect: the store stamps `data-theme` on <html> the
// moment it is created. Doing that before the first render is what stops a
// dark-mode user seeing a white flash on every load.
import './store/themeStore'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
