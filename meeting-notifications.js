/* JOINT active-meeting navigation badge. Counts currently active public meetings in Supabase. */
(async function () {
  'use strict';
  const clientPromise = window.jointSupabaseConnection;
  if (!clientPromise) return;
  let client;
  try { client = await clientPromise; } catch (_) { return; }
  const links = Array.from(document.querySelectorAll('a[href]')).filter(a => {
    const href = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
    return href === 'meetings.html' || href.endsWith('/meetings.html');
  });
  if (!links.length) return;
  links.forEach(a => { a.classList.add('joint-meeting-nav-link'); a.style.position = 'relative'; });
  let badgeStyle = document.getElementById('joint-meeting-badge-style');
  if (!badgeStyle) {
    badgeStyle = document.createElement('style');
    badgeStyle.id = 'joint-meeting-badge-style';
    badgeStyle.textContent = '.joint-count-badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;margin-left:5px;border-radius:999px;background:#e83e69;color:#fff;font-size:11px;font-weight:800;line-height:1;vertical-align:middle}.bottom-nav .joint-count-badge{position:absolute;top:0;right:12%;margin:0}.bottom-nav a{position:relative}';
    document.head.appendChild(badgeStyle);
  }
  function setCount(count) {
    links.forEach(a => {
      let badge = a.querySelector('.joint-count-badge');
      if (count > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'joint-count-badge'; badge.setAttribute('aria-label', 'Active meetings'); a.appendChild(badge); }
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.title = count + ' active public meeting' + (count === 1 ? '' : 's');
      } else if (badge) badge.remove();
    });
  }
  async function refresh() {
    try {
      const { count, error } = await client.from('joint_meetings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .eq('visibility', 'public');
      if (error) throw error;
      setCount(Number(count || 0));
    } catch (e) {
      // Keep the rest of the navigation working if migration is not run yet.
      console.warn('JOINT active-meeting count is unavailable until the meetings migration is applied.', e);
    }
  }
  await refresh();
  window.setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
