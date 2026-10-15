/* JOINT unread-message badge, loaded on all authenticated app pages. */
(() => {
  let client, currentUser;
  const chatLinks = () => [...document.querySelectorAll('a[href]')].filter(a => {
    const href = a.getAttribute('href') || '';
    return /(^|\/)chat\.html(?:[?#].*)?$/i.test(href) || a.dataset.nav === 'chat';
  });
  function paint(count) {
    for (const link of chatLinks()) {
      let badge = link.querySelector('.joint-unread-nav-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'joint-unread-nav-badge';
          badge.setAttribute('aria-label', `${count} unread messages`);
          badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:5px;border-radius:999px;background:#e63c66;color:#fff;font-size:11px;font-weight:800;line-height:1;vertical-align:middle;box-sizing:border-box';
          link.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.hidden = false;
        badge.setAttribute('aria-label', `${count} unread messages`);
      } else if (badge) badge.remove();
    }
  }
  async function refresh() {
    try {
      if (!client) client = await window.jointSupabaseConnection;
      if (!client) return;
      const {data: s, error: se} = await client.auth.getSession();
      if (se) throw se;
      currentUser = s.session?.user;
      if (!currentUser) { paint(0); return; }
      const {data: convos, error: ce} = await client.from('joint_conversations')
        .select('id').or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`).limit(200);
      if (ce) throw ce;
      if (!convos?.length) { paint(0); return; }
      const ids = convos.map(c => c.id);
      const {data: reads, error: re} = await client.from('joint_message_reads')
        .select('conversation_id,last_read_at').eq('user_id',currentUser.id).in('conversation_id',ids);
      if (re) throw re;
      const readMap = new Map((reads || []).map(r => [r.conversation_id, r.last_read_at]));
      const {data: messages, error: me} = await client.from('joint_messages')
        .select('conversation_id,created_at').in('conversation_id',ids)
        .neq('sender_id',currentUser.id).order('created_at',{ascending:false}).limit(1000);
      if (me) throw me;
      const count = (messages || []).filter(m => {
        const readAt = readMap.get(m.conversation_id);
        return !readAt || new Date(m.created_at) > new Date(readAt);
      }).length;
      paint(count);
    } catch (err) {
      // Keep the page usable if the badge query fails.
      console.debug('JOINT unread badge unavailable:', err);
    }
  }
  window.jointRefreshMessageBadge = refresh;
  document.addEventListener('DOMContentLoaded', () => {
    refresh();
    setInterval(refresh, 15000);
  });
})();