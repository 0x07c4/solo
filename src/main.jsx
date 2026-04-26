import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Solo render failed', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main
          style={{
            minHeight: '100vh',
            padding: 32,
            background: '#11110f',
            color: '#f4ead2',
            fontFamily: 'monospace',
          }}
        >
          <h1>Solo render failed</h1>
          <h2>{this.state.error?.name || 'Error'}</h2>
          <p>{this.state.error?.message || String(this.state.error)}</p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
          </pre>
        </main>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary key="solo-root-boundary-v2">
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
