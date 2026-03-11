import { createBrowserRouter } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import MainLayout from '../layouts/MainLayout';

const HomePage = lazy(() => import('../pages/HomePage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const AnalyzePage = lazy(() => import('../pages/AnalyzePage'));
const AuthCallback = lazy(() => import('../pages/AuthCallback'));

function SuspenseWrapper({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-blue animate-spin" />
      </div>
    }>
      {children}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <MainLayout />,
    children: [
      {
        path: '/',
        element: <SuspenseWrapper><HomePage /></SuspenseWrapper>,
      },
      {
        path: '/repo/:owner/:repo',
        element: <SuspenseWrapper><DashboardPage /></SuspenseWrapper>,
      },
      {
        path: '/repo/:owner/:repo/analyze',
        element: <SuspenseWrapper><AnalyzePage /></SuspenseWrapper>,
      },
      {
        path: '/auth/callback',
        element: <SuspenseWrapper><AuthCallback /></SuspenseWrapper>,
      },
    ],
  },
]);
