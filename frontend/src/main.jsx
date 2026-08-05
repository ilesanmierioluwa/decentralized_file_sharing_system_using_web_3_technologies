import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import './index.css'
import App from './App.jsx'

// Buffer polyfill for libraries like @metamask/eth-sig-util that assume a
// Node-style environment.
if (!window.Buffer) {
  window.Buffer = Buffer
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
