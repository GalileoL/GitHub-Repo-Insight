import { Outlet } from 'react-router-dom';

export default function MainLayout() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <nav className="sticky top-0 z-50 border-b border-border-default bg-bg-surface/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <a href="/" className="text-lg font-semibold text-text-primary">GitHub Repo Insight</a>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
