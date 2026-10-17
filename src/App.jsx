import { ToastProvider } from '@/components/ui/primitives';
import Home from '@/pages/Home';

/**
 * The base44 build wrapped this page in a router, an auth provider and a query
 * client for a single route with no server. Self-hosted, ECHO is one page.
 */
export default function App() {
  return (
    <ToastProvider>
      <Home />
    </ToastProvider>
  );
}
