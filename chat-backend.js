/* JOINT private chat: messages and conversations are stored in Supabase. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const initials = (name) => String(name || 'J').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase() || 'J';
  const when = (value) => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  };
  let client, user, profiles = [], activeConversationId = null, otherUserId = null, pollTimer = null;
  let loadingMessages = false;

  async function init() {
    try {
      client = await window.jointSupabaseConnection;
      const {data: sessionData, error: sessionError} = await client.auth.getSession();
      if (sessionError) throw sessionError;
      user = sessionData.session?.user;
      if (!user) { location.replace('auth.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search)); return; }
      if ($('jchat-members')) await initChatList();
      if ($('jconv-form')) await initConversation();
    } catch (err) {
      console.error('JOINT chat initialization failed:', err);
      const target = $('jchat-status') || $('jconv-status');
      if (target) target.textContent = 'Chat could not load. Please refresh and try again.';
    }
  }

  async function loadProfiles() {
    const {data, error} = await client.from('joint_profiles')
      .select('id,display_name,avatar_url,account_type')
      .neq('id', user.id)
      .order('display_name', {ascending:true})
      .limit(300);
    if (error) throw error;
    profiles = data || [];
    return profiles;
  }

  function avatarMarkup(profile, className='jchat-avatar') {
    if (profile?.avatar_url) return `<img class="${className}" src="${esc(profile.avatar_url)}" alt="">`;
    return `<div class="${className}">${esc(initials(profile?.display_name))}</div>`;
  }

  async function initChatList() {
    const memberTarget = $('jchat-members');
    const convoTarget = $('jchat-conversations');
    const search = $('jchat-member-search');
    try {
      await loadProfiles();
      renderMembers('');
      await renderConversations();
      search.addEventListener('input', () => renderMembers(search.value));
    } catch (err) {
      console.error('Could not load chat list:', err);
      memberTarget.innerHTML = '<p class="jchat-empty">Members could not be loaded. Please try again later.</p>';
      convoTarget.innerHTML = '<p class="jchat-empty">Conversations could not be loaded.</p>';
    }
  }

  function renderMembers(query) {
    const target = $('jchat-members');
    const q = String(query || '').trim().toLowerCase();
    const list = profiles.filter(p => String(p.display_name || '').toLowerCase().includes(q));
    if (!list.length) {
      target.innerHTML = `<p class="jchat-empty">${q ? 'No members match your search.' : 'No other members are available yet.'}</p>`;
      return;
    }
    target.innerHTML = list.map(p => `<div class="jchat-person"><a href="member-profile.html?id=${encodeURIComponent(p.id)}" style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;color:inherit;text-decoration:none">${avatarMarkup(p)}<div class="jchat-person-main"><h3>${esc(p.display_name || 'JOINT member')}</h3><p>${esc(p.account_type || 'Member')}</p></div></a><a class="jchat-button" href="conversation.html?user=${encodeURIComponent(p.id)}">Message</a></div>`).join('');
  }

  async function renderConversations() {
    const target = $('jchat-conversations');
    const {data: convos, error} = await client.from('joint_conversations')
      .select('id,user1_id,user2_id,updated_at')
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .order('updated_at', {ascending:false}).limit(100);
    if (error) throw error;
    if (!convos?.length) {
      target.innerHTML = '<p class="jchat-empty">Your conversations will appear here when you message a member.</p>';
      return;
    }
    const otherIds = [...new Set(convos.map(c => c.user1_id === user.id ? c.user2_id : c.user1_id))];
    const {data: otherProfiles, error: pErr} = await client.from('joint_profiles')
      .select('id,display_name,avatar_url,account_type').in('id', otherIds);
    if (pErr) throw pErr;
    const pMap = new Map((otherProfiles || []).map(p => [p.id,p]));
    const ids = convos.map(c=>c.id);
    const {data: msgs, error: mErr} = await client.from('joint_messages')
      .select('conversation_id,body,created_at,sender_id').in('conversation_id', ids)
      .order('created_at', {ascending:false}).limit(500);
    if (mErr) throw mErr;
    const lastMap = new Map();
    for (const m of msgs || []) if (!lastMap.has(m.conversation_id)) lastMap.set(m.conversation_id,m);
    const {data: reads, error: rErr} = await client.from('joint_message_reads')
      .select('conversation_id,last_read_at').eq('user_id', user.id).in('conversation_id', ids);
    if (rErr) throw rErr;
    const readMap = new Map((reads || []).map(r => [r.conversation_id, r.last_read_at]));
    const unreadMap = new Map();
    for (const c of convos) {
      const readAt = readMap.get(c.id) || '1970-01-01T00:00:00.000Z';
      unreadMap.set(c.id, (msgs || []).filter(m => m.conversation_id === c.id && m.sender_id !== user.id && new Date(m.created_at) > new Date(readAt)).length);
    }
    convos.sort((a,b) => new Date(lastMap.get(b.id)?.created_at || b.updated_at) - new Date(lastMap.get(a.id)?.created_at || a.updated_at));
    target.innerHTML = convos.map(c => {
      const otherId = c.user1_id === user.id ? c.user2_id : c.user1_id;
      const p = pMap.get(otherId) || {id:otherId,display_name:'JOINT member'};
      const last = lastMap.get(c.id);
      const preview = last ? (last.sender_id === user.id ? 'You: ' : '') + last.body : 'Start your conversation';
      const unread = unreadMap.get(c.id) || 0;
      return `<div class="jchat-person"> <a href="member-profile.html?id=${encodeURIComponent(otherId)}" style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;color:inherit;text-decoration:none">${avatarMarkup(p)}<div class="jchat-person-main"><h3>${esc(p.display_name)} ${unread ? `<span class="jchat-unread">${unread}</span>` : ''}</h3><p>${esc(preview)}</p></div></a><a class="jchat-button" href="conversation.html?id=${encodeURIComponent(c.id)}">Open chat</a></div>`;
    }).join('');
  }

  async function getProfile(id) {
    const {data,error} = await client.from('joint_profiles').select('id,display_name,avatar_url,account_type').eq('id',id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getOrCreateConversation(otherId) {
    if (!otherId || otherId === user.id) throw new Error('Choose another JOINT member to message.');
    const [first, second] = [user.id, otherId].sort();
    const {data: existing, error: findError} = await client.from('joint_conversations')
      .select('id,user1_id,user2_id').eq('user1_id',first).eq('user2_id',second).maybeSingle();
    if (findError) throw findError;
    if (existing) return existing;
    const {data: created, error: createError} = await client.from('joint_conversations')
      .insert({user1_id:first,user2_id:second}).select('id,user1_id,user2_id').single();
    if (createError) {
      // A simultaneous first message may create the pair first; fetch it again.
      const {data: raced, error: raceError} = await client.from('joint_conversations')
        .select('id,user1_id,user2_id').eq('user1_id',first).eq('user2_id',second).maybeSingle();
      if (raceError || !raced) throw createError;
      return raced;
    }
    return created;
  }

  async function initConversation() {
    const params = new URLSearchParams(location.search);
    const targetId = params.get('user');
    const conversationId = params.get('id');
    const status = $('jconv-status');
    try {
      if (targetId) {
        otherUserId = targetId;
        const p = await getProfile(otherUserId);
        if (!p) throw new Error('This member profile could not be found.');
        setConversationHeader(p);
        const c = await getOrCreateConversation(otherUserId);
        activeConversationId = c.id;
        history.replaceState(null, '', 'conversation.html?id=' + encodeURIComponent(c.id));
      } else if (conversationId) {
        const {data:c,error} = await client.from('joint_conversations').select('id,user1_id,user2_id').eq('id',conversationId).maybeSingle();
        if (error) throw error;
        if (!c || (c.user1_id !== user.id && c.user2_id !== user.id)) throw new Error('This conversation is not available to your account.');
        activeConversationId = c.id;
        otherUserId = c.user1_id === user.id ? c.user2_id : c.user1_id;
        const p = await getProfile(otherUserId);
        if (!p) throw new Error('This member profile could not be found.');
        setConversationHeader(p);
      } else {
        location.replace('chat.html');
        return;
      }
      await markConversationRead();
      await loadMessages();
      $('jconv-form').addEventListener('submit', sendMessage);
      $('jconv-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('jconv-form').requestSubmit(); }
      });
      pollTimer = setInterval(loadMessages, 5000);
      window.addEventListener('pagehide', () => clearInterval(pollTimer), {once:true});
    } catch (err) {
      console.error('Could not open conversation:', err);
      $('jconv-messages').innerHTML = '';
      status.textContent = err.message && /permission|policy|row-level|schema cache/i.test(err.message)
        ? 'Chat permissions need to be checked in Supabase.'
        : (err.message || 'This conversation could not be opened.');
      $('jconv-send').disabled = true;
    }
  }

  function setConversationHeader(profile) {
    $('jconv-title').textContent = profile.display_name || 'Conversation';
    $('jconv-name').innerHTML = '<a href="member-profile.html?id=' + encodeURIComponent(profile.id || otherUserId || '') + '" style="color:inherit;text-decoration:none">' + esc(profile.display_name || 'JOINT member') + '</a>';
    $('jconv-subtitle').textContent = profile.account_type || 'Private conversation';
    const avatar = $('jconv-avatar');
    if (profile.avatar_url) {
      const img = document.createElement('img');
      img.src = profile.avatar_url; img.alt = ''; img.className = 'jconv-avatar';
      avatar.replaceWith(img); img.id = 'jconv-avatar';
    } else avatar.textContent = initials(profile.display_name);
  }

  async function markConversationRead() {
    if (!activeConversationId || !user) return;
    const {error} = await client.from('joint_message_reads').upsert({
      conversation_id: activeConversationId,
      user_id: user.id,
      last_read_at: new Date().toISOString()
    }, {onConflict:'conversation_id,user_id'});
    if (error) console.error('Could not mark conversation read:', error);
  }

  async function loadMessages() {
    if (!activeConversationId || loadingMessages) return;
    loadingMessages = true;
    try {
      const {data,error} = await client.from('joint_messages')
        .select('id,sender_id,body,created_at')
        .eq('conversation_id',activeConversationId)
        .order('created_at',{ascending:true}).limit(500);
      if (error) throw error;
      const target = $('jconv-messages');
      const previousCount = target.querySelectorAll('[data-message-id]').length;
      const wasNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
      target.innerHTML = (data || []).map(m => `<div class="jconv-bubble ${m.sender_id === user.id ? 'mine' : 'theirs'}" data-message-id="${esc(m.id)}">${esc(m.body)}<small class="jconv-meta">${esc(when(m.created_at))}</small></div>`).join('');
      if (!data?.length) target.innerHTML = '<p class="jconv-status">No messages yet. Say hello to start the conversation.</p>';
      if (wasNearBottom || data.length !== previousCount) target.scrollTop = target.scrollHeight;
      $('jconv-status').textContent = '';
      await markConversationRead();
      if (window.jointRefreshMessageBadge) window.jointRefreshMessageBadge();
    } catch (err) {
      console.error('Could not load messages:', err);
      $('jconv-status').textContent = 'Messages could not be refreshed. Check your connection.';
    } finally { loadingMessages = false; }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const input = $('jconv-input');
    const button = $('jconv-send');
    const body = input.value.trim();
    if (!body || !activeConversationId) return;
    button.disabled = true;
    try {
      const {error} = await client.from('joint_messages').insert({
        conversation_id:activeConversationId,
        sender_id:user.id,
        body
      });
      if (error) throw error;
      input.value = '';
      await client.from('joint_conversations').update({updated_at:new Date().toISOString()}).eq('id',activeConversationId);
      await loadMessages();
      $('jconv-status').textContent = '';
    } catch (err) {
      console.error('Could not send message:', err);
      $('jconv-status').textContent = /permission|policy|row-level/i.test(err.message)
        ? 'You do not have permission to send this message. Check the Supabase chat policies.'
        : 'Message was not sent. Please try again.';
    } finally { button.disabled = false; input.focus(); }
  }

  document.addEventListener('DOMContentLoaded', init);
})();