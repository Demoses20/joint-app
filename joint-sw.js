/* JOINT service worker: displays notification media independently from sender avatar. */
self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'JOINT notification';
  const avatar = payload.avatar_url || payload.actor_avatar_url || payload.icon || '';
  const attachmentPreview =
    payload.attachment_preview_url ||
    payload.image ||
    '';
  let body = payload.body || 'You have a new notification on JOINT.';

  // Defensive fallback for older notification rows that still contain sticker JSON.
  if (body.includes('JOINT_CHAT_STICKER::')) {
    const prefix = body.split('JOINT_CHAT_STICKER::')[0].trim().replace(/[:\-–—]+$/, '').trim();
    body = prefix ? `${prefix}: sent a sticker` : 'Sent you a sticker';
  }

  const options = {
    body,
    icon: avatar || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    data: {
      url: payload.url || payload.target_url || '/notifications.html',
      attachment_url: payload.attachment_url || '',
      attachment_type: payload.attachment_type || ''
    },
    tag: payload.tag || payload.notification_id || undefined,
    renotify: false
  };

  // The large image must be the message attachment, never the sender avatar.
  if (attachmentPreview) options.image = attachmentPreview;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications.html';
  const destination = new URL(target, self.location.origin).href;
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
