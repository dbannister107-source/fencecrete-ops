import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App';
import BUILD_INFO from './build-info.json';

// Sentry init -- guarded by env var so missing DSN = silently no Sentry,
// not a crash. Set REACT_APP_SENTRY_DSN in Vercel env to enable.
if (process.env.REACT_APP_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.REACT_APP_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    // Tag every event with the build version so we can correlate errors
    // to a specific deployment. build-info.json has shortSha (e.g. "dev-177").
    release: BUILD_INFO?.shortSha || BUILD_INFO?.sha || 'unknown',
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Internal app, ~25 known users -- fine to capture text/media
        // for full debug context. If sensitive data ever flows through
        // the OPS web client (PIS portal is a separate edge function,
        // not relevant), switch to maskAllText: true.
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: 0.1,            // 10% perf transaction sampling
    replaysSessionSampleRate: 0.05,   // 5% baseline session replay
    replaysOnErrorSampleRate: 1.0,    // 100% replay when an error happens (the useful ones)
    beforeSend(event) {
      // Drop noisy Mapbox-token warnings -- the anon key is public anyway
      const msg = event.message || event.exception?.values?.[0]?.value || '';
      if (typeof msg === 'string' && msg.includes('REACT_APP_MAPBOX_TOKEN')) return null;
      return event;
    },
  });
}

// Fallback shown when a render-time error escapes the entire React tree.
// Without this, an uncaught render error white-screens the whole app.
function ErrorFallback({ resetError }) {
  return (
    <div style={{
      padding: 40, fontFamily: 'Inter, system-ui, sans-serif',
      maxWidth: 540, margin: '60px auto', textAlign: 'left',
    }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#8A261D', marginBottom: 12 }}>
        Something went wrong.
      </h1>
      <p style={{ color: '#625650', lineHeight: 1.5, marginBottom: 16 }}>
        The error has been logged for review. Refresh to continue, or contact David if it keeps happening.
      </p>
      <button
        onClick={resetError}
        style={{
          padding: '8px 16px', background: '#8A261D', color: '#FFF',
          border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
        }}
      >
        Refresh
      </button>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={ErrorFallback} showDialog={false}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
