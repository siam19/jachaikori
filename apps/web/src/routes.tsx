import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Shell } from './ui/Shell';
import { RouteErrorBoundary } from './ui/RouteErrorBoundary';
import { FrontPage } from './features/front/FrontPage';

const CheckPage = lazy(() =>
  import('./features/verify/CheckPage').then((m) => ({ default: m.CheckPage }))
);
const EntitiesDirectory = lazy(() =>
  import('./features/entities/Directory').then((m) => ({ default: m.EntitiesDirectory }))
);
const EntityDossier = lazy(() =>
  import('./features/entities/Dossier').then((m) => ({ default: m.EntityDossier }))
);
const EventList = lazy(() =>
  import('./features/events/EventList').then((m) => ({ default: m.EventList }))
);
const EventPage = lazy(() =>
  import('./features/events/EventPage').then((m) => ({ default: m.EventPage }))
);
const SearchPage = lazy(() =>
  import('./features/search/SearchPage').then((m) => ({ default: m.SearchPage }))
);
const ScrapbookPage = lazy(() =>
  import('./features/scrapbook/ScrapbookPage').then((m) => ({ default: m.ScrapbookPage }))
);
const GalleryPage = lazy(() =>
  import('./features/gallery/GalleryPage').then((m) => ({ default: m.GalleryPage }))
);

function RouteLoader() {
  return (
    <div className="py-10 space-y-4 animate-pulse">
      <div className="h-7 w-1/3 rounded bg-paper-sunk" />
      <div className="h-40 rounded bg-paper-sunk" />
    </div>
  );
}

const wrap = (el: React.ReactNode) => <Suspense fallback={<RouteLoader />}>{el}</Suspense>;

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <FrontPage /> },
      { path: 'checks/:id', element: wrap(<CheckPage />) },
      { path: 'check/:id', element: wrap(<CheckPage />) },
      { path: 'entities', element: wrap(<EntitiesDirectory />) },
      { path: 'entities/:id', element: wrap(<EntityDossier />) },
      { path: 'events', element: wrap(<EventList />) },
      { path: 'events/:id', element: wrap(<EventPage />) },
      { path: 'search', element: wrap(<SearchPage />) },
      { path: 'scrapbook', element: wrap(<ScrapbookPage />) },
      { path: 'gallery', element: wrap(<GalleryPage />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
