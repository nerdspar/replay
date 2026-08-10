import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <React.StrictMode>
    {/*
      Hash routing sidesteps the ingress base path entirely: every route lives
      after the `#`, so the rotating `/api/hassio_ingress/<token>/` prefix is
      never part of a route the router has to know about (§3.3).
    */}
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
