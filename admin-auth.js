(() => {
  'use strict';
  const ADMIN_EMAIL = 'technicaldemoses@gmail.com';
  const current = location.pathname.split('/').pop() || 'admin.html';
  const allowed = new Set(['admin.html','admin-school-applications.html','admin-organizations.html']);
  if (!allowed.has(current)) return;
  const loginUrl = 'admin-login.html?next=' + encodeURIComponent(current);
  (async () => {
    try {
      if (!window.jointSupabaseConnection) throw new Error('Supabase not ready');
      const db = await window.jointSupabaseConnection;
      const { data, error } = await db.auth.getUser();
      if (error || !data.user) {
        location.replace(loginUrl);
        return;
      }
      if ((data.user.email || '').toLowerCase() !== ADMIN_EMAIL) {
        await db.auth.signOut();
        location.replace('admin-login.html?next=' + encodeURIComponent(current) + '&denied=1');
        return;
      }
      document.documentElement.classList.add('admin-authenticated');
      document.dispatchEvent(new CustomEvent('joint-admin-authorized', { detail: { user: data.user, db } }));
    } catch (_) {
      location.replace(loginUrl);
    }
  })();
})();