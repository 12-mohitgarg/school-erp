import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { store } from '@/store';
import { AppRoutes } from '@/routes';
import { useSessionRestore } from '@/features/auth/useAuth';
import { useRealtime } from '@/lib/useRealtime';
import '@/styles/globals.css';

function App() {
  // Both hooks must live inside the Provider, hence this inner component.
  useSessionRestore();
  useRealtime();

  return (
    <>
      <AppRoutes />
      <Toaster
        position="top-right"
        // Match the app's surface tokens rather than the library's defaults.
        toastOptions={{
          classNames: {
            toast: 'rounded-lg border border-hairline bg-surface text-ink shadow-lg',
            description: 'text-ink-muted',
            actionButton: 'bg-brand-600 text-white',
          },
        }}
      />
    </>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
