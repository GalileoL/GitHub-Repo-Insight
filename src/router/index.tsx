import { createBrowserRouter } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import MainLayout from '../layouts/MainLayout';

const HomePage = lazy(() => import('../pages/HomePage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const AnalyzePage = lazy(() => import('../pages/AnalyzePage'));
const AuthCallback = lazy(() => import('../pages/AuthCallback'));

const fallback = (
  <div className="flex items-center justify-center h-screen bg-bg-primary">
    <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-blue animate-spin" />
  </div>
);

export const router = createBrowserRouter([
  {
    element: <MainLayout />,
    children: [
      {
        path: '/',
        element: <Suspense fallback={fallback}><HomePage /></Suspense>,
      },
      {
        path: '/repo/:owner/:repo',
        element: <Suspense fallback={fallback}><DashboardPage /></Suspense>,
      },
      {
        path: '/repo/:owner/:repo/analyze',
        element: <Suspense fallback={fallback}><AnalyzePage /></Suspense>,
      },
      {
        path: '/auth/callback',
        element: <Suspense fallback={fallback}><AuthCallback /></Suspense>,
      },
    ],
  },
]);
