/* JOINT service worker: push display only; no fetch interception or cache changes. */
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'JOINT notification';
  const avatar = payload.avatar_url || payload.icon || payload.image || '';
  const options = {
    body: payload.body || 'You have a new notification on JOINT.',
    // Use the actor's real photo for the notification icon and large image when available.
    icon: avatar || '/icons/icon-192.png',
    image: payload.image || avatar || undefined,
    badge: payload.badge || '/icons/icon-192.png',
    data: { url: payload.url || payload.target_url || '/notifications.html' },
    tag: payload.tag || payload.notification_id || undefined,
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL((event.notification.data && event.notification.data.url) || '/notifications.html', self.location.origin).href;
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
