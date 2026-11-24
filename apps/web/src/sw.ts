/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback (excluding API routes if proxied)
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/share-target$/],
  })
);

// Android PWA Share Target handler — parks shared photo/text into Cache Storage and redirects 303
registerRoute(
  ({ url }) => url.pathname === '/share-target',
  async ({ request }) => {
    const form = await request.formData();
    const file = form.get('image');
    const text = String(form.get('text') || form.get('url') || '');
    const inbox = await caches.open('share-inbox');

    if (file instanceof File && file.size > 0) {
      await inbox.put(
        '/inbox/image',
        new Response(file, {
          headers: {
            'content-type': file.type || 'image/jpeg',
            'x-filename': encodeURIComponent(file.name || 'shared-card.jpg'),
          },
        })
      );
    } else {
      await inbox.delete('/inbox/image');
    }

    if (text.trim()) {
      await inbox.put('/inbox/text', new Response(text));
    } else {
      await inbox.delete('/inbox/text');
    }

    return Response.redirect('/?shared=1', 303);
  },
  'POST'
);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
