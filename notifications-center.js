/* JOINT notification inbox + global unread badge. Requires the notification migration. */
(async function () {
  'use strict';
  if (window.__jointNotificationsCenterLoaded) return;
  window.__jointNotificationsCenterLoaded = true;
  const style = document.createElement('style');
  style.textContent = `
    .joint-notification-link{position:relative!important;white-space:nowrap}
    .joint-notification-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:5px;border-radius:99px;background:#e83e69;color:#fff;font:800 11px/1 Arial,sans-serif;vertical-align:middle}
    .bottom-nav .joint-notification-badge{position:absolute;top:0;right:8%;margin:0}
    .joint-notification-bell{display:inline-flex;align-items:center;gap:6px;border:1px solid #e2d8f2;border-radius:12px;padding:9px 12px;background:#f7f1ff;color:#5b2ab9;text-decoration:none;font-weight:800}
    .joint-notification-row{padding:14px;border-radius:13px;background:#fff;border:1px solid #e8e2f2;margin:10px 0;overflow-wrap:anywhere}
    .joint-notification-row.unread{border-left:4px solid #6938d1;background:#faf7ff}
    .joint-notification-row p{margin:6px 0;color:#655f72}
    .joint-notification-row a{color:#5b2ab9;font-weight:700}
    .joint-notification-small{font-size:12px;color:#827b90}
    .joint-notification-actor{display:flex;width:42px;height:42px;border-radius:50%;overflow:hidden;align-items:center;justify-content:center;background:#f0eaff;margin-bottom:8px;text-decoration:none}
    .joint-notification-actor img{width:100%;height:100%;object-fit:cover}
  `;
  document.head.appendChild(style);
  const clientPromise = window.jointSupabaseConnection;
  if (!clientPromise) return;
  let client, user;
  try {
    client = await clientPromise;
    const result = await client.auth.getUser();
    if (result.error || !result.data.user) return;
    user = result.data.user;
  } catch (_) { return; }

  const notificationLinks = Array.from(document.querySelectorAll('a[href]')).filter(a => {
    const href = (a.getAttribute('href') || '').split(/[?#]/)[0];
    return href === 'notifications.html' || href.endsWith('/notifications.html');
  });
  const topActions = document.querySelector('.top-actions');
  if (topActions && !notificationLinks.length) {
    const link = document.createElement('a');
    link.href = 'notifications.html'; link.className = 'joint-notification-bell';
    link.innerHTML = '<span aria-hidden="true">🔔</span><span>Inbox</span>';
    link.setAttribute('aria-label', 'Open notifications inbox');
    topActions.insertBefore(link, topActions.firstChild);
    notificationLinks.push(link);
  }
  notificationLinks.forEach(a => a.classList.add('joint-notification-link'));

  const settingsList = document.getElementById('settings-notification-list');
  const unreadNode = document.getElementById('settings-unread-count');
  const refreshBtn = document.getElementById('settings-refresh-notifications');
  const markBtn = document.getElementById('settings-mark-all-read');
  const centerList = document.getElementById('joint-notifications-list');
  const centerUnread = document.getElementById('joint-notifications-unread');

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function timeLabel(value) { try { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); } catch (_) { return ''; } }
  function badgeCount(count) {
    notificationLinks.forEach(a => {
      let badge = a.querySelector('.joint-notification-badge');
      if (count > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'joint-notification-badge'; a.appendChild(badge); }
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.setAttribute('aria-label', `${count} unread notifications`);
      } else if (badge) badge.remove();
    });
    if (unreadNode) unreadNode.textContent = `${count} unread`;
    if (centerUnread) centerUnread.textContent = `${count} unread`;
  }
  function render(rows, target) {
    if (!target) return;
    if (!rows.length) { target.innerHTML = '<p>You’re all caught up. New JOINT activity will appear here.</p>'; return; }
    target.innerHTML = rows.map(n => { const actorId = n.actor_user_id || n.actor_id || n.sender_user_id || n.from_user_id || ''; const actorName = n.actor_name || n.sender_name || ''; const actorAvatar = n.actor_avatar_url || n.sender_avatar_url || ''; const actor = actorId ? `<a class="joint-notification-actor" href="member-profile.html?id=${encodeURIComponent(actorId)}" aria-label="View ${escapeHtml(actorName || 'profile')} profile">${actorAvatar ? `<img src="${escapeHtml(actorAvatar)}" alt="" loading="lazy">` : '👤'}</a>` : ''; return `<article class="joint-notification-row ${n.read_at ? '' : 'unread'}" data-notification-id="${escapeHtml(n.id)}">${actor}<strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.body)}</p><div class="joint-notification-small">${escapeHtml(timeLabel(n.created_at))}${n.read_at ? ' · Read' : ' · Unread'}</div>${n.target_url ? `<p><a href="${escapeHtml(n.target_url)}" data-notification-open="${escapeHtml(n.id)}">Open</a></p>` : ''}${!n.read_at ? `<button type="button" data-notification-read="${escapeHtml(n.id)}" class="settings-button secondary" style="min-height:36px;padding:8px 12px;margin-top:8px">Mark read</button>` : ''}</article>`; }).join('');
  }
  async function refresh() {
    const { data, error } = await client.from('joint_notifications').select('*').eq('recipient_user_id', user.id).order('created_at',{ascending:false}).limit(100);
    if (error) {
      const message = 'Notifications are not connected yet. Apply the JOINT notifications SQL migration, then refresh.';
      if (settingsList) settingsList.textContent = message;
      if (centerList) centerList.textContent = message;
      console.warn('JOINT notifications inbox query failed:', error.message);
      return;
    }
    const rows = data || [];
    const actorIds = [...new Set(rows.map(n => n.actor_user_id || n.actor_id || n.sender_user_id || n.from_user_id).filter(Boolean))];
    if (actorIds.length) {
      const { data: actors, error: actorError } = await client.from('joint_profiles').select('id,display_name,avatar_url').in('id', actorIds);
      if (!actorError) { const actorMap = new Map((actors || []).map(p => [p.id, p])); rows.forEach(n => { const actor = actorMap.get(n.actor_user_id || n.actor_id || n.sender_user_id || n.from_user_id); if (actor) { n.actor_name = n.actor_name || actor.display_name; n.actor_avatar_url = n.actor_avatar_url || actor.avatar_url; } }); }
    }
    badgeCount(rows.filter(n => !n.read_at).length);
    render(rows, settingsList); render(rows, centerList);
  }
  async function markRead(id) {
    const { error } = await client.from('joint_notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('recipient_user_id',user.id);
    if (error) { alert('Could not update this notification. Please try again.'); return; }
    await refresh();
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-notification-read]');
    const link = event.target.closest('[data-notification-open]');
    if (button) { event.preventDefault(); await markRead(button.getAttribute('data-notification-read')); }
    else if (link) { await markRead(link.getAttribute('data-notification-open')); }
  });
  refreshBtn?.addEventListener('click', refresh);
  markBtn?.addEventListener('click', async () => {
    const { error } = await client.from('joint_notifications').update({read_at:new Date().toISOString()}).eq('recipient_user_id',user.id).is('read_at',null);
    if (error) { alert('Could not mark notifications as read. Please try again.'); return; }
    await refresh();
  });
  await refresh();
  window.setInterval(() => { if (!document.hidden) refresh(); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
