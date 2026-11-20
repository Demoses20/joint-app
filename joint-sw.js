/* JOINT service worker: push display only; no fetch interception or cache changes. */
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }

  const title = payload.title || 'JOINT notification';
  // The sender avatar is only the small notification icon. Never use it as
  // the large attachment image; that was masking missing image/video media.
  const options = {
    body: payload.body || 'You have a new notification on JOINT.',
    icon: payload.icon || payload.avatar_url || '/icons/icon-192.png',
    image: payload.image || undefined,
    badge: payload.badge || '/icons/icon-192.png',
    data: {
      url: payload.url || payload.target_url || '/notifications.html',
      media_url: payload.media_url || '',
      media_type: payload.media_type || '',
      video_url: payload.video_url || ''
    },
    tag: payload.tag || payload.notification_id || undefined,
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(
    (event.notification.data && event.notification.data.url) || '/notifications.html',
    self.location.origin
  ).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(destination);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(destination);
  })());
});
