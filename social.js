/* JOINT profile integration. Profile, posts, follows and post interactions use Supabase. */
(() => {
  'use strict';
  /* Profile post comments: hidden forms must stay hidden despite inline flex;
     keep nested reply lists independently scrollable on mobile. */
  const jointCommentUiStyle = document.createElement('style');
  jointCommentUiStyle.textContent = `
    @keyframes jointCommentStickerMotion{0%,100%{transform:translateY(0) rotate(-4deg) scale(1)}50%{transform:translateY(-5px) rotate(4deg) scale(1.12)}}.joint-comment-animated-emoji{display:inline-block;transform-origin:center;animation:jointCommentStickerMotion 1.15s ease-in-out infinite;will-change:transform;}
    .comment-sticker,.joint-comment-sticker-media{display:block!important;width:70px!important;height:70px!important;min-width:70px!important;min-height:70px!important;max-width:70px!important;max-height:70px!important;aspect-ratio:1/1!important;box-sizing:border-box!important;object-fit:cover!important;object-position:center center!important;border:0!important;border-radius:0!important;border-top-left-radius:0!important;border-top-right-radius:0!important;border-bottom-left-radius:0!important;border-bottom-right-radius:0!important;padding:0!important;margin:0!important;transform:none!important;clip-path:inset(0)!important;-webkit-clip-path:inset(0)!important;mask:none!important;-webkit-mask:none!important;box-shadow:none!important;vertical-align:top!important;flex:0 0 70px!important;}
    
    
    
    #joint-own-posts form[hidden],
    #joint-own-posts .joint-comment-form[hidden],
    #joint-own-posts .joint-reply-form[hidden] { display:none !important; }
    #joint-own-posts .joint-comment-panel[hidden],
    #joint-own-posts form[hidden],
    #joint-own-posts .joint-comment-form[hidden],
    #joint-own-posts .joint-reply-form[hidden] { display:none !important; }
    #joint-own-posts .joint-comment-panel {
      max-height:58vh; min-height:0; overflow:hidden; width:100%; box-sizing:border-box;
    }
    #joint-own-posts .joint-own-comment-list {
      flex:1 1 auto; min-height:0; max-height:42vh !important;
      overflow-y:auto !important; overflow-x:hidden !important;
      overscroll-behavior:contain; -webkit-overflow-scrolling:touch; touch-action:pan-y;
      display:flex; flex-direction:column; align-items:stretch;
    }
    #joint-own-posts .joint-own-comment-list > div {
      flex:0 0 auto; align-self:stretch; height:auto; min-height:fit-content;
    }
    #joint-own-posts .joint-reply-area {
      display:flex; flex:0 0 auto; flex-direction:column; align-items:stretch;
      gap:7px; max-height:none; overflow:visible; width:100%; min-width:0;
    }
    #joint-own-posts .joint-comment-form {
      position:sticky; bottom:0; z-index:5; flex:0 0 auto;
      background:#fff; padding:10px 0 calc(10px + env(safe-area-inset-bottom));
      border-top:1px solid #eee7f5;
    }
  `;
  document.head.appendChild(jointCommentUiStyle);


  const STORAGE = {
    profile: 'joint_profile_demo_v2',
    posts: 'joint_user_posts_demo_v2',
    follows: 'joint_social_follows_demo_v1'
  };
  let supabaseClient = null;
  let currentUser = null;
  let remoteProfile = null;
  let selectedAvatarFile = null;

  const readLocal = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  };
  const writeLocal = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  };
  const localProfile = () => readLocal(STORAGE.profile, {
    name: 'JOINT Learner', bio: '', interests: '', age: '', avatar: ''
  });
  const posts = () => readLocal(STORAGE.posts, []);
  const follows = () => readLocal(STORAGE.follows, []);
  const safe = value => String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function localShareCount(postId) {
    try { const totals = JSON.parse(localStorage.getItem('joint_social_shares_demo_v1') || '{}'); return Number(totals[postId] || 0); } catch (_) { return 0; }
  }

  function localViewCount(postId) {
    try { const totals = JSON.parse(localStorage.getItem('joint_social_views_demo_v1') || '{}'); return Number(totals[postId] || 0); } catch (_) { return 0; }
  }

  function recordLocalPostView(postId) {
    // Count at most once per browser session for each post, avoiding repeated refresh inflation.
    try {
      const seenKey = 'joint_social_views_seen_session_v1';
      const seen = JSON.parse(sessionStorage.getItem(seenKey) || '[]');
      if (seen.includes(String(postId))) return;
      seen.push(String(postId));
      sessionStorage.setItem(seenKey, JSON.stringify(seen));
      const totals = JSON.parse(localStorage.getItem('joint_social_views_demo_v1') || '{}');
      totals[postId] = Number(totals[postId] || 0) + 1;
      localStorage.setItem('joint_social_views_demo_v1', JSON.stringify(totals));
    } catch (_) { /* Storage may be unavailable; the UI still renders. */ }
  }

  async function getClient() {
    if (supabaseClient) return supabaseClient;
    if (!window.jointSupabaseConnection) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './supabase.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load JOINT Supabase.'));
        document.head.appendChild(script);
      });
    }
    supabaseClient = await window.jointSupabaseConnection;
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) throw error;
    currentUser = data.user;
    if (!currentUser) throw new Error('Please sign in to manage your profile.');
    return supabaseClient;
  }

  function fallbackProfile() {
    const local = localProfile();
    return {
      id: currentUser?.id || '',
      username: remoteProfile?.username || (currentUser?.email || '').split('@')[0],
      display_name: remoteProfile?.display_name || local.name || currentUser?.user_metadata?.display_name || 'JOINT Learner',
      bio: remoteProfile?.bio ?? local.bio ?? '',
      interests: remoteProfile?.interests ?? local.interests ?? '',
      age: remoteProfile?.age ?? local.age ?? '',
      date_of_birth: remoteProfile?.date_of_birth || local.date_of_birth || '',
      country: remoteProfile?.country || '',
      state_region: remoteProfile?.state_region || '',
      gender: remoteProfile?.gender || '',
      avatar_url: remoteProfile?.avatar_url || local.avatar || '',
      account_type: remoteProfile?.account_type || 'student'
    };
  }

  async function loadProfile() {
    const client = await getClient();
    const { data, error } = await client
      .from('joint_profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    remoteProfile = data || null;

    // If this user's profile row does not exist, create it with their auth identity.
    if (!remoteProfile) {
      const local = localProfile();
      const base = ((currentUser.email || 'joint-user').split('@')[0])
        .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'joint-user';
      const candidate = `${base}_${currentUser.id.replace(/-/g, '').slice(0, 6)}`;
      const row = {
        id: currentUser.id,
        username: candidate,
        display_name: String(currentUser.user_metadata?.display_name || local.name || base).slice(0, 80),
        bio: String(local.bio || '').slice(0, 600),
        interests: String(local.interests || '').slice(0, 250),
        age: local.age ? Number(local.age) : null,
        date_of_birth: local.date_of_birth || null,
        avatar_url: null,
        account_type: 'student'
      };
      const { data: inserted, error: insertError } = await client
        .from('joint_profiles').insert(row).select('*').single();
      if (insertError) throw insertError;
      remoteProfile = inserted;
    }

    // Cache only as a convenience for the avatar/header; Supabase remains the source of truth.
    writeLocal(STORAGE.profile, {
      name: remoteProfile.display_name || 'JOINT Learner',
      bio: remoteProfile.bio || '',
      interests: remoteProfile.interests || '',
      age: remoteProfile.age || '',
      date_of_birth: remoteProfile.date_of_birth || '',
      avatar: remoteProfile.avatar_url || ''
    });
    return fallbackProfile();
  }

  function profileCard(profile) {
    const root = document.getElementById('joint-profile-summary');
    if (!root) return;
    root.innerHTML = '';
    const photo = document.createElement('div');
    photo.className = 'joint-profile-photo';
    if (profile.avatar_url) {
      const image = document.createElement('img');
      image.src = profile.avatar_url;
      image.alt = 'Profile picture';
      photo.appendChild(image);
    } else {
      photo.textContent = (profile.display_name || 'J').trim()
        .split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
    }
    root.appendChild(photo);
    const details = document.createElement('div');
    details.className = 'joint-profile-details';
    const title = document.createElement('h2');
    title.textContent = profile.display_name || 'JOINT Learner';
    const bio = document.createElement('p');
    bio.textContent = profile.bio || 'Add a short introduction to your profile.';
    const username = document.createElement('p');
    username.className = 'muted';
    username.textContent = profile.username ? '@' + profile.username : '';
    const stats = document.createElement('div');
    stats.className = 'joint-follow-stats';
    stats.id = 'joint-follow-stats';
    stats.innerHTML = '<button type="button" class="joint-follow-pill" data-follow-list="followers" disabled>Followers <strong>…</strong></button><button type="button" class="joint-follow-pill" data-follow-list="following" disabled>Following <strong>…</strong></button>';
    details.append(title, bio, username, stats);
    if (profile.interests) {
      let interestValues = profile.interests;
      if (typeof interestValues === 'string') {
        const raw = interestValues.trim();
        try {
          const parsed = JSON.parse(raw);
          interestValues = Array.isArray(parsed) ? parsed : raw.split(/[,;|]/);
        } catch (_) {
          interestValues = raw.split(/[,;|]/);
        }
      }
      if (!Array.isArray(interestValues)) interestValues = [interestValues];
      const cleanInterests = [...new Set(interestValues.map(value => String(value || '').trim()).filter(Boolean))];
      if (cleanInterests.length) {
        const interestHeading = document.createElement('p');
        interestHeading.className = 'muted';
        interestHeading.textContent = 'Interests';
        interestHeading.style.marginBottom = '8px';
        const interests = document.createElement('div');
        interests.className = 'joint-profile-interests';
        cleanInterests.forEach(value => {
          const chip = document.createElement('span');
          chip.className = 'joint-profile-interest';
          chip.textContent = value.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
          interests.appendChild(chip);
        });
        details.append(interestHeading, interests);
      }
    }
    root.appendChild(details);
    refreshFollowStats();
  }

  async function refreshFollowStats() {
    const stats = document.getElementById('joint-follow-stats');
    if (!stats) return;
    try {
      const client = await getClient();
      const [followers, following] = await Promise.all([
        client.from('joint_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_user_id', currentUser.id),
        client.from('joint_follows').select('followed_user_id', { count: 'exact', head: true }).eq('follower_id', currentUser.id)
      ]);
      if (followers.error) throw followers.error;
      if (following.error) throw following.error;
      stats.querySelector('[data-follow-list="followers"] strong').textContent = Number(followers.count || 0).toLocaleString();
      stats.querySelector('[data-follow-list="following"] strong').textContent = Number(following.count || 0).toLocaleString();
      stats.querySelectorAll('[data-follow-list]').forEach(button => {
        button.disabled = false;
        button.addEventListener('click', () => openFollowList(button.dataset.followList, currentUser.id));
      });
      ensureFollowListStyles();
    } catch (error) {
      console.error('JOINT follow counts could not load:', error);
      stats.querySelectorAll('button').forEach(button => { button.disabled = false; button.querySelector('strong').textContent = '—'; button.title = 'Could not load follow count'; });
      stats.querySelectorAll('[data-follow-list]').forEach(button => button.addEventListener('click', () => openFollowList(button.dataset.followList, currentUser.id)));
      ensureFollowListStyles();
    }
  }

  function ensureFollowListStyles() {
    if (document.getElementById('joint-follow-list-styles')) return;
    const style = document.createElement('style'); style.id = 'joint-follow-list-styles';
    style.textContent = `.joint-follow-stats{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 16px}.joint-follow-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid #e6dcf7;border-radius:999px;background:#faf7ff;color:#5b2bb8;font-family:inherit;font-size:12px;font-weight:600;line-height:1.3;cursor:pointer}.joint-follow-pill strong{font-size:12px;color:#292238}.joint-follow-pill:disabled{opacity:.7;cursor:wait}.joint-follow-pill:focus-visible{outline:2px solid #8c62e8;outline-offset:2px}.joint-follow-overlay{position:fixed;inset:0;z-index:10000;background:#17112680;display:flex;align-items:center;justify-content:center;padding:16px}.joint-follow-dialog{width:min(100%,430px);max-height:min(78vh,680px);display:flex;flex-direction:column;background:#fff;border:1px solid #e9e1f4;border-radius:20px;box-shadow:0 20px 70px #17112640;overflow:hidden}.joint-follow-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #f0ebf6}.joint-follow-dialog-head h2{margin:0;font-size:1.1rem;color:#292238}.joint-follow-close{width:34px;height:34px;border:0;border-radius:50%;background:#f4effb;color:#51465f;font-size:22px;cursor:pointer}.joint-follow-list{overflow:auto;padding:8px 12px 14px}.joint-follow-row{display:flex;align-items:center;gap:12px;padding:10px;border-radius:12px;color:inherit;text-decoration:none}.joint-follow-row:hover{background:#f8f4ff}.joint-follow-avatar{width:44px;height:44px;flex:0 0 44px;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:#eee5ff;color:#5424b5;font-weight:800}.joint-follow-person{min-width:0;display:flex;flex-direction:column;gap:3px}.joint-follow-person strong{overflow-wrap:anywhere;color:#292238}.joint-follow-person small{color:#777486;overflow-wrap:anywhere}.joint-follow-empty{padding:26px 16px;text-align:center;color:#777486}`;
    document.head.appendChild(style);
  }

  async function openFollowList(kind, profileId) {
    ensureFollowListStyles();
    document.querySelector('.joint-follow-overlay')?.remove();
    const overlay = document.createElement('div'); overlay.className = 'joint-follow-overlay'; overlay.setAttribute('role','presentation');
    const dialog = document.createElement('section'); dialog.className = 'joint-follow-dialog'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-label', kind === 'followers' ? 'Followers' : 'Following');
    const head = document.createElement('div'); head.className = 'joint-follow-dialog-head';
    const heading = document.createElement('h2'); heading.textContent = kind === 'followers' ? 'Followers' : 'Following';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'joint-follow-close'; close.setAttribute('aria-label','Close'); close.textContent = '×';
    const list = document.createElement('div'); list.className = 'joint-follow-list'; list.innerHTML = '<p class="joint-follow-empty">Loading people…</p>';
    close.addEventListener('click', () => overlay.remove()); head.append(heading,close); dialog.append(head,list); overlay.append(dialog); document.body.append(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    const onKey = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } }; document.addEventListener('keydown', onKey);
    close.focus();
    try {
      const client = await getClient();
      const query = kind === 'followers'
        ? client.from('joint_follows').select('follower_id').eq('followed_user_id', profileId)
        : client.from('joint_follows').select('followed_user_id').eq('follower_id', profileId);
      const { data: relations, error } = await query;
      if (error) throw error;
      const ids = [...new Set((relations || []).map(row => kind === 'followers' ? row.follower_id : row.followed_user_id).filter(Boolean))];
      if (!ids.length) { list.innerHTML = '<p class="joint-follow-empty">No ' + (kind === 'followers' ? 'followers' : 'following') + ' yet.</p>'; return; }
      const { data: people, error: peopleError } = await client.from('joint_profiles').select('id,username,display_name,avatar_url').in('id', ids);
      if (peopleError) throw peopleError;
      const byId = new Map((people || []).map(person => [person.id, person]));
      list.replaceChildren();
      ids.forEach(id => {
        const person = byId.get(id) || { id, display_name: 'JOINT member', username: '', avatar_url: '' };
        const link = document.createElement('a'); link.className = 'joint-follow-row'; link.href = 'member-profile.html?id=' + encodeURIComponent(id);
        if (person.avatar_url) { const avatar = document.createElement('img'); avatar.className = 'joint-follow-avatar'; avatar.src = person.avatar_url; avatar.alt = ''; avatar.loading = 'lazy'; avatar.onerror = () => { const fallback = document.createElement('span'); fallback.className = 'joint-follow-avatar'; fallback.textContent = (person.display_name || 'J').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase(); avatar.replaceWith(fallback); }; link.append(avatar); }
        else { const avatar = document.createElement('span'); avatar.className = 'joint-follow-avatar'; avatar.textContent = (person.display_name || 'J').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase(); link.append(avatar); }
        const text = document.createElement('span'); text.className = 'joint-follow-person'; const name = document.createElement('strong'); name.textContent = person.display_name || 'JOINT member'; text.append(name); if (person.username) { const username = document.createElement('small'); username.textContent = '@' + person.username; text.append(username); } link.append(text); list.append(link);
      });
    } catch (error) { console.error('Could not load JOINT follow list:', error); list.innerHTML = '<p class="joint-follow-empty">Could not load this list. Please try again.</p>'; }
  }

  function appendPostLinkButtons(container, text) {
    const matches = [...String(text || '').matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+/ig)]
      .map(match => match[0].replace(/[.,!?;:]+$/, ''));
    const urls = [...new Set(matches.map(raw => {
      const candidate = raw.startsWith('www.') ? 'https://' + raw : raw;
      try { const parsed = new URL(candidate); return /^https?:$/.test(parsed.protocol) ? parsed.href : ''; }
      catch (_) { return ''; }
    }).filter(Boolean))].slice(0, 5);
    if (!urls.length) return;
    const box = document.createElement('div');
    box.className = 'post-link-buttons';
    box.style.cssText = 'display:grid;gap:8px;margin:8px 0';
    urls.forEach((href, index) => {
      const link = document.createElement('a');
      link.className = 'link-card';
      link.textContent = urls.length > 1 ? 'Open link ' + (index + 1) + ' →' : 'Open link →';
      link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;align-self:start;padding:10px 15px;border-radius:999px;background:#6938d1;color:#fff;font-weight:800;text-decoration:none';
      box.appendChild(link);
    });
    container.appendChild(box);
  }

  async function renderOwnPosts(target, profile) {
    if (!target) return;
    const previousY = window.scrollY;
    const hadContent = target.children.length > 0;
    if (!hadContent) target.innerHTML = '<div class="card muted">Loading your posts…</div>';
    try {
      const client = await getClient();
      const { data: items, error } = await client.from('joint_posts')
        .select('id, author_id, content, media_urls, created_at, updated_at')
        .eq('author_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const postIds = (items || []).map(item => item.id).filter(Boolean);
      const metrics = { likes: {}, comments: {}, saves: {} };
      if (postIds.length) {
        const [likesResult, commentsResult, savesResult] = await Promise.all([
          client.from('joint_likes').select('post_id').in('post_id', postIds),
          client.from('joint_comments').select('post_id').in('post_id', postIds),
          client.from('joint_saves').select('post_id').in('post_id', postIds)
        ]);
        if (likesResult.error) console.warn('Could not load post like counts:', likesResult.error.message);
        else (likesResult.data || []).forEach(row => metrics.likes[row.post_id] = (metrics.likes[row.post_id] || 0) + 1);
        if (commentsResult.error) console.warn('Could not load post comment counts:', commentsResult.error.message);
        else (commentsResult.data || []).forEach(row => metrics.comments[row.post_id] = (metrics.comments[row.post_id] || 0) + 1);
        // joint_saves has an owner-only read policy, so this count may represent only saves visible to this user.
        if (savesResult.error) console.warn('Could not load post save counts:', savesResult.error.message);
        else (savesResult.data || []).forEach(row => metrics.saves[row.post_id] = (metrics.saves[row.post_id] || 0) + 1);
      }
      target.innerHTML = '';
      if (!items || !items.length) {
        target.innerHTML = '<div class="card muted">No shared posts yet. Publish an update to make it available to JOINT users.</div>';
        return;
      }
      items.forEach(post => {
        const card = document.createElement('article');
        card.className = 'card joint-user-post';
        const head = document.createElement('div');
        head.className = 'joint-post-head';
        const avatarLink = document.createElement('a');
        avatarLink.className = 'joint-own-post-avatar';
        avatarLink.href = 'profile.html';
        avatarLink.setAttribute('aria-label', 'Open your profile');
        avatarLink.style.cssText = 'width:48px;height:48px;flex:0 0 48px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#eee5ff;color:#5424b5;font-weight:800;text-decoration:none';
        const ownName = profile.display_name || 'JOINT Learner';
        const ownInitials = ownName.trim().split(/\s+/).slice(0,2).map(part => part.charAt(0)).join('').toUpperCase() || 'J';
        if (profile.avatar_url) {
          const avatarImg = document.createElement('img');
          avatarImg.src = profile.avatar_url; avatarImg.alt = ownName + ' profile picture';
          avatarImg.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;border:0;border-radius:50%';
          avatarImg.onerror = () => { avatarImg.remove(); avatarLink.textContent = ownInitials; };
          avatarLink.appendChild(avatarImg);
        } else avatarLink.textContent = ownInitials;
        const author = document.createElement('a');
        author.href = 'profile.html'; author.textContent = ownName;
        author.style.cssText = 'font-weight:800;color:inherit;text-decoration:none';
        const identity = document.createElement('div'); identity.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;flex:1';
        const date = document.createElement('small');
        date.textContent = post.created_at ? new Date(post.created_at).toLocaleString() : '';
        date.style.cssText = 'color:#777486'; identity.append(author, date); head.append(avatarLink, identity);
        const body = document.createElement('p');
        body.textContent = post.content || '';
        card.append(head, body);
        appendPostLinkButtons(card, post.content || '');
        (Array.isArray(post.media_urls) ? post.media_urls : []).forEach(media => {
          if (!media || !media.url) return;
          const mediaUrl = String(media.url || '');
          const mediaType = String(media.type || media.mime_type || media.content_type || '').toLowerCase();
          const isVideo = mediaType.startsWith('video') || /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(mediaUrl);
          if (isVideo) {
            const video = document.createElement('video');
            video.className = 'joint-post-media joint-autoplay-video'; video.controls = false; video.muted = false; video.loop = true; video.playsInline = true;
            video.preload = 'metadata'; video.src = mediaUrl; video.setAttribute('webkit-playsinline','true'); video.setAttribute('aria-label','Video post');
            video.addEventListener('click', () => { if (video.paused) video.play().catch(()=>{}); }, {passive:true});
            card.appendChild(video);
          } else {
            const image = document.createElement('img');
            image.className = 'joint-post-media'; image.loading = 'lazy'; image.alt = 'Image shared in this post';
            image.src = media.url; card.appendChild(image);
          }
        });
        recordLocalPostView(post.id);
        const viewCount = localViewCount(post.id);

        // Interactive controls for the owner's profile posts. All likes, comments and saves
        // use the existing Supabase tables; share totals remain local until a shared counter exists.
        const interactionBox = document.createElement('section');
        interactionBox.className = 'joint-profile-interactions';
        interactionBox.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #eeeaf5';
        const actionRow = document.createElement('div');
        actionRow.className = 'joint-profile-action-row';
        const compact = value => { const n=Number(value)||0; if(n>=1000000)return (n/1000000).toFixed(n>=10000000?0:1).replace(/\.0$/,'')+'M+'; if(n>=1000)return (n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'K+'; return String(n); };
        const iconSvg = name => {
          const paths={save:'<path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21z"/>',view:'<path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',share:'<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'};
          return paths[name]||'';
        };
        const makeAction = (icon, value, handler, selected=false, title='') => {
          const b=document.createElement('button'); b.type='button'; b.className='joint-profile-action'+(selected?' selected':''); b.title=title; b.setAttribute('aria-label',title||icon);
          const ico=document.createElement('span');ico.className='jp-icon';ico.setAttribute('aria-hidden','true');
          const svg=iconSvg(icon);
          if(svg){ico.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+svg+'</svg>';}else{ico.textContent=icon;}
          const count=document.createElement('span');count.className='jp-count';count.textContent=compact(value);b.append(ico,count);
          b.addEventListener('click', handler); actionRow.appendChild(b); return b;
        };
        const loadCounts = async () => {
          const c=await getClient();
          const [lr,cr,sr]=await Promise.all([
            c.from('joint_likes').select('id',{count:'exact',head:true}).eq('post_id',post.id),
            c.from('joint_comments').select('id',{count:'exact',head:true}).eq('post_id',post.id),
            c.from('joint_saves').select('id',{count:'exact',head:true}).eq('post_id',post.id)
          ]);
          return {likes:lr.count??0,comments:cr.count??0,saves:sr.count??0,errors:[lr.error,cr.error,sr.error].filter(Boolean)};
        };
        const refreshCard = async () => { await renderOwnPosts(target, profile); };
        makeAction('❤️',metrics.likes[post.id]||0,async ev=>{},false,'Like post');
        actionRow.lastElementChild.onclick = async (ev) => {
          const b=ev.currentTarget; b.disabled=true;
          try { const c=await getClient();
            const {data:existing,error:findErr}=await c.from('joint_likes').select('id').eq('post_id',post.id).eq('user_id',currentUser.id).maybeSingle();
            if(findErr) throw findErr;
            const result=existing?await c.from('joint_likes').delete().eq('id',existing.id):await c.from('joint_likes').insert({post_id:post.id,user_id:currentUser.id});
            if(result.error) throw result.error; await refreshCard();
          } catch(err){alert('Could not update like: '+err.message);b.disabled=false;}
        };
        makeAction('💬',metrics.comments[post.id]||0,()=>{},false,'Show comments');
        const shareBtn=makeAction('share',localShareCount(post.id),async()=>{},false,'Share post');
        shareBtn.onclick=async()=>{
          const link=new URL('index.html',location.href); link.searchParams.set('post',post.id);
          const payload={title:'JOINT post',text:(profile.display_name||'JOINT member')+' on JOINT: '+(post.content||''),url:link.href};
          try { if(navigator.share) await navigator.share(payload); else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(payload.url);alert('Post link copied.')} else prompt('Copy this post link:',payload.url);
            const totals=JSON.parse(localStorage.getItem('joint_social_shares_demo_v1')||'{}');totals[post.id]=Number(totals[post.id]||0)+1;localStorage.setItem('joint_social_shares_demo_v1',JSON.stringify(totals));shareBtn.querySelector('.jp-count').textContent=compact(totals[post.id]);
          } catch(err){if(err.name!=='AbortError')alert('Could not share this post.');}
        };
        const saveAction=makeAction('save',metrics.saves[post.id]||0,async ev=>{
          const b=ev.currentTarget;b.disabled=true;
          try {const c=await getClient();const {data:existing,error:findErr}=await c.from('joint_saves').select('id').eq('post_id',post.id).eq('user_id',currentUser.id).maybeSingle();if(findErr)throw findErr;const result=existing?await c.from('joint_saves').delete().eq('id',existing.id):await c.from('joint_saves').insert({post_id:post.id,user_id:currentUser.id});if(result.error)throw result.error;await refreshCard();}
          catch(err){alert('Could not update saved post: '+err.message);b.disabled=false;}
        });
        const viewsButton = makeAction('view', viewCount, () => {},false,'Views');
        viewsButton.disabled = true;
        viewsButton.style.opacity = '0.85';
        viewsButton.title = 'Views are counted on this browser only until a shared post-views table is added.';
        interactionBox.appendChild(actionRow);
        // Boost this post. A campaign is only queued for payment; this browser never charges money.
        const boostButton=document.createElement('button');boostButton.type='button';boostButton.textContent='🚀 Boost post';boostButton.style.cssText='margin-top:10px;border:0;border-radius:11px;padding:10px 15px;background:#6938d1;color:#fff;font-weight:800;cursor:pointer';
        const boostPanel=document.createElement('section');boostPanel.hidden=true;boostPanel.style.cssText='margin-top:10px;padding:13px;border:1px solid #e5deef;border-radius:13px;background:#fbf9ff';
        const boostMetrics=document.createElement('div');boostMetrics.style.cssText='display:flex;gap:8px;overflow-x:auto;margin:10px 0';
        const boostForm=document.createElement('form');boostForm.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px';
        const boostCountries=document.createElement('select');boostCountries.multiple=false;boostCountries.size=1;boostCountries.setAttribute('aria-label','Target country');boostCountries.style.cssText='grid-column:1/-1;width:100%;min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#fff';
        const boostGeo=window.JOINT_GEO_DATA||{countries:[],states:{},interests:[]};
        boostCountries.add(new Option('Select one country',''));
        (boostGeo.countries||[]).forEach(row=>{const name=Array.isArray(row)?row[1]:row.name;if(name)boostCountries.add(new Option(name,name))});
        const boostStates=document.createElement('select');boostStates.setAttribute('aria-label','Target state or region');boostStates.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#fff';
        const fillBoostStates=()=>{const selectedName=boostCountries.value;const row=(boostGeo.countries||[]).find(x=>(Array.isArray(x)?x[1]:x.name)===selectedName);const code=Array.isArray(row)?row[0]:row?.code;const states=code?(boostGeo.states?.[code]||[]):[];boostStates.replaceChildren(new Option(states.length?'All states / regions':'State list unavailable for this country',''));states.forEach(name=>boostStates.add(new Option(name,name)))};
        fillBoostStates();boostCountries.addEventListener('change',async()=>{fillBoostStates();const row=(boostGeo.countries||[]).find(x=>(Array.isArray(x)?x[1]:x.name)===boostCountries.value);const code=Array.isArray(row)?row[0]:row?.code;if(code&&!boostGeo.states?.[code]?.length&&boostGeo.getStatesForCountry){try{const rows=await boostGeo.getStatesForCountry(code);if(boostCountries.value===(Array.isArray(row)?row[1]:row.name)&&rows.length){boostGeo.states[code]=rows;fillBoostStates()}}catch(_){}}updateBoostEstimate()});
        
        const boostAge=document.createElement('select');boostAge.innerHTML='<option value="all">All eligible ages</option><option value="13-17">13–17</option><option value="18-24">18–24</option><option value="25-34">25–34</option><option value="35-44">35–44</option><option value="45+">45+</option>';boostAge.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';
        const boostGender=document.createElement('select');boostGender.innerHTML='<option value="all">All genders</option><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Non-binary</option>';boostGender.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';
        const boostInterestWrap=document.createElement('div');boostInterestWrap.style.cssText='grid-column:1/-1;min-width:0';const boostInterests=document.createElement('input');boostInterests.type='hidden';boostInterests.value='';const boostInterestToggle=document.createElement('button');boostInterestToggle.type='button';boostInterestToggle.textContent='Choose interests ▾';boostInterestToggle.style.cssText='width:100%;text-align:left;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#fff;color:#242033';const boostInterestPicker=document.createElement('div');boostInterestPicker.hidden=true;boostInterestPicker.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:7px;max-height:220px;overflow:auto;padding:10px;margin-top:6px;border:1px solid #ded7eb;border-radius:9px;background:#fff';const boostInterestOptions=(boostGeo.interests||[]).map(x=>typeof x==='string'?{value:x,label:x}:x).filter(x=>x&&x.value);boostInterestOptions.forEach(item=>{const label=document.createElement('label');label.style.cssText='display:flex;gap:7px;align-items:center;font-size:14px';const cb=document.createElement('input');cb.type='checkbox';cb.value=item.value;cb.addEventListener('change',()=>{boostInterests.value=[...boostInterestPicker.querySelectorAll('input:checked')].map(x=>x.value).join(',');const count=boostInterestPicker.querySelectorAll('input:checked').length;boostInterestToggle.textContent=(count?count+' interests selected':'Choose interests')+' ▾'});label.append(cb,document.createTextNode(item.label||item.value));boostInterestPicker.appendChild(label)});boostInterestToggle.onclick=()=>{boostInterestPicker.hidden=!boostInterestPicker.hidden;boostInterestToggle.textContent=(boostInterestPicker.hidden?'Choose interests ▾':'Hide interests ▴')};boostInterestWrap.append(boostInterestToggle,boostInterestPicker,boostInterests);
        const boostBudget=document.createElement('input');boostBudget.type='number';boostBudget.min='1';boostBudget.step='1';boostBudget.value='5000';boostBudget.placeholder='Promotion budget (NGN)';boostBudget.setAttribute('aria-label','Campaign budget in NGN');boostBudget.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';
        // Charge currency remains NGN; this read-only display follows saved JOINT Settings.
        const boostCurrency=document.createElement('div');boostCurrency.setAttribute('aria-label','Preferred display currency from JOINT Settings');boostCurrency.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#f1eaff;color:#5424b5;font-weight:700;display:flex;align-items:center;grid-column:1/-1';
        const boostCurrencyHint=document.createElement('div');boostCurrencyHint.textContent='The JOINT main administrator sets the pricing currency. The estimate is converted to your saved Settings currency and includes the 2% JOINT margin. Actual checkout currency is validated separately.';boostCurrencyHint.style.cssText='grid-column:1/-1;color:#6d6578;line-height:1.45';
        const boostMethod=document.createElement('div');boostMethod.textContent='Payment methods are selected securely at Paystack checkout.';boostMethod.style.cssText='grid-column:1/-1;color:#6d6578;line-height:1.45';
        const boostEst=document.createElement('div');boostEst.style.cssText='grid-column:1/-1;font-weight:800;color:#5424b5;line-height:1.5';
        const boostPin=document.createElement('input');boostPin.type='password';boostPin.inputMode='numeric';boostPin.autocomplete='off';boostPin.maxLength=6;boostPin.pattern='[0-9]{6}';boostPin.placeholder='Six-digit Diamond Wallet PIN';boostPin.setAttribute('aria-label','Six-digit Diamond Wallet PIN');boostPin.required=true;boostPin.style.cssText='grid-column:1/-1;min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';const boostSubmit=document.createElement('button');boostSubmit.type='submit';boostSubmit.textContent='Pay with Diamonds';boostSubmit.style.cssText='border:0;border-radius:10px;padding:11px;background:#6938d1;color:#fff;font-weight:800';
        const boostCancel=document.createElement('button');boostCancel.type='button';boostCancel.textContent='Cancel';boostCancel.style.cssText='border:1px solid #e5deef;border-radius:10px;padding:11px;background:#fff;color:#5424b5;font-weight:800;min-height:44px;display:block';boostForm.append(boostCountries,boostStates,boostAge,boostGender,boostInterestWrap,boostBudget,boostCurrency,boostCurrencyHint,boostMethod,boostEst,boostPin,boostSubmit,boostCancel);boostPanel.appendChild(boostForm);boostButton.onclick=async()=>{boostPanel.hidden=!boostPanel.hidden;if(!boostPanel.hidden){updateBoostEstimate();}};boostCancel.onclick=()=>boostPanel.hidden=true;
        let boostEstimateRun=0;let boostPreferredCurrency='NGN';let boostGlobalCurrency='NGN';
        const loadBoostPreferredCurrency=async()=>{try{const c=await getClient();const setting=await c.from('joint_global_settings').select('default_currency').eq('id','global').maybeSingle();const v=String(setting.data?.default_currency||'').toUpperCase();if(['NGN','USD'].includes(v))boostGlobalCurrency=v}catch(_){}let saved='';try{const c=await getClient();const pref=await c.from('joint_user_preferences').select('currency_preference').eq('user_id',currentUser.id).maybeSingle();saved=String(pref.data?.currency_preference||'').toUpperCase()}catch(_){}if(!['NGN','USD'].includes(saved)){try{const local=JSON.parse(localStorage.getItem('joint_user_preferences_v2')||'{}');saved=String(local.currency||'').toUpperCase()}catch(_){}}boostPreferredCurrency=['NGN','USD'].includes(saved)?saved:'NGN';const label=v=>v==='USD'?'USD — US Dollar':'NGN — Nigerian Naira';boostCurrency.textContent='JOINT pricing: '+label(boostGlobalCurrency)+' · Your Settings: '+label(boostPreferredCurrency);boostBudget.setAttribute('aria-label','Campaign budget in '+boostGlobalCurrency+' (JOINT admin pricing currency)');return boostPreferredCurrency};
        const updateBoostEstimate=async()=>{const run=++boostEstimateRun,b=Math.max(0,Number(boostBudget.value)||0);const targetCurrency=await loadBoostPreferredCurrency();const cur=boostGlobalCurrency;if(run!==boostEstimateRun)return;let rate=null;try{const c=await getClient();const country=boostCountries.value,state=boostStates.value;const q=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country',country).eq('currency',cur);if(!q.error){rate=(q.data||[]).find(x=>String(x.state_region||'*')===String(state||'*'))||(q.data||[]).find(x=>String(x.state_region||'*')==='*')||null}if(!rate){const d=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country','*').eq('currency',cur).eq('state_region','*').maybeSingle();if(d.data)rate=d.data}}catch(_){}if(!(b>0)){boostEst.textContent='Enter a campaign budget in '+cur+' to see estimated results.';return}if(!boostCountries.value){boostEst.textContent='Select one country to load the JOINT Admin rate card.';return}if(!rate){boostEst.textContent='No active JOINT Admin rate card for '+boostCountries.value+' in '+cur+'. Boosting is unavailable until JOINT Admin configures this country.';return}const impressionCost=Number(rate.cpm)/1000,clickCost=Number(rate.cpc),viewCost=Number(rate.cpv);const validCosts=[impressionCost,clickCost,viewCost].filter(x=>Number.isFinite(x)&&x>0);const estimatedTotalResults=validCosts.length?Math.floor(b/Math.max(...validCosts)):0;if(targetCurrency===cur){boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Estimated total results: '+estimatedTotalResults.toLocaleString()+' (impressions, clicks and views combined; not three separate allowances). Display currency follows your JOINT Settings. Estimate only.';return}boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Estimated total results: '+estimatedTotalResults.toLocaleString()+' (impressions, clicks and views combined; not three separate allowances). Converting to your preferred currency…';try{const c=await getClient();const q=await c.functions.invoke('joint-currency-convert',{body:{amount:b,sourceCurrency:cur,targetCurrency}});if(run!==boostEstimateRun)return;if(q.error||!q.data?.ok)throw new Error(q.data?.error||q.error?.message||'Conversion unavailable');const x=q.data,money=n=>new Intl.NumberFormat(undefined,{style:'currency',currency:targetCurrency}).format(n);boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Estimated total results: '+estimatedTotalResults.toLocaleString()+' (impressions, clicks and views combined; not three separate allowances). Your Settings currency estimate: '+money(x.convertedAmount)+' + JOINT 2% margin '+money(x.conversionMargin)+' = '+money(x.estimatedTotal)+'. Rate updated '+new Date(x.rateTimestamp).toLocaleString()+'. Display estimate only; actual checkout currency is validated separately.'}catch(e){if(run===boostEstimateRun)boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Preferred currency: '+targetCurrency+'. Currency conversion estimate unavailable: '+(e.message||'please retry')+'. No payment has been taken.'}};boostBudget.addEventListener('input',updateBoostEstimate);boostCountries.addEventListener('change',updateBoostEstimate);
        boostForm.onsubmit=async ev=>{ev.preventDefault();if(!boostCountries.value){alert('Choose one country for this post boost. You can create another boost for a different country.');return}if(!(Number(boostBudget.value)>0)){alert('Enter a budget greater than zero.');return}boostSubmit.disabled=true;try{const c=await getClient();const budget=Number(boostBudget.value),cur=boostGlobalCurrency,country=[boostCountries.value];let rate=null;const rr=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country',country[0]).eq('currency',cur);if(!rr.error)rate=(rr.data||[]).find(x=>String(x.state_region||'*')===String(boostStates.value||'*'))||(rr.data||[]).find(x=>String(x.state_region||'*')==='*')||null;if(!rate){const fallback=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country','*').eq('state_region','*').eq('currency',cur).maybeSingle();if(fallback.data)rate=fallback.data}if(!rate)throw new Error('JOINT Admin has not configured an active rate card for '+country[0]+'.');const payload={owner_id:currentUser.id,post_id:post.id,campaign_kind:'post',name:'Boosted post · '+(profile.display_name||'JOINT member'),targets:[{kind:'post',key:'post:'+post.id,label:(post.content||'Post').slice(0,120),post_id:post.id}],targeting:{countries:country,states:boostStates.value?[boostStates.value]:[],age_range:boostAge.value,gender:boostGender.value,interests:boostInterests.value.split(',').map(x=>x.trim()).filter(Boolean)},budget,currency:'NGN',estimated_impressions:Math.floor(budget/Number(rate.cpm||Infinity)*1000),estimated_clicks:Math.floor(budget/Number(rate.cpc||Infinity)),estimated_views:Math.floor(budget/Number(rate.cpv||Infinity)),status:'pending_review',updated_at:new Date().toISOString()};const pin=boostPin.value.trim();if(!/^[0-9]{6}$/.test(pin))throw new Error('Enter your six-digit Diamond Wallet PIN.');const idempotencyKey=crypto.randomUUID?crypto.randomUUID():('boost-'+Date.now()+'-'+Math.random().toString(36).slice(2,12));const paid=await c.rpc('joint_diamond_pay_post_boost',{p_post_id:post.id,p_payload:payload,p_pin:pin,p_idempotency_key:idempotencyKey});if(paid.error)throw paid.error;if(!paid.data?.ok)throw new Error(paid.data?.message||'Diamond payment could not be completed.');boostPin.value='';alert('Payment successful! Your post boost is now active. Paid '+Number(paid.data.diamonds||0).toLocaleString()+' Diamonds. Reference: '+paid.data.reference);boostPanel.hidden=true;await renderOwnPosts(target,profile);}catch(err){const message=String(err?.message||'Payment could not be completed.').replace(/\s*[—-]\s*make sure the JOINT promotion migration is applied\.?/i,'').trim();alert('Could not pay for post boost: '+message)}finally{boostSubmit.disabled=false}};
        interactionBox.append(boostButton,boostPanel);
        const postPromoBox=document.createElement('div');postPromoBox.hidden=true;postPromoBox.style.cssText='display:grid;grid-template-columns:minmax(0,1fr);gap:8px;overflow:visible;margin-top:10px;padding:10px;border:1px solid #e5deef;border-radius:12px;background:#fbf9ff';
        const loadPostPromos=async()=>{try{const c=await getClient();const r=await c.from('joint_promotions').select('id,name,status,budget,currency,estimated_impressions,estimated_clicks,estimated_views,impressions_count,clicks_count,views_count,spent_amount,targeting,created_at').eq('owner_id',currentUser.id).eq('post_id',post.id).order('created_at',{ascending:false}).limit(10);postPromoBox.replaceChildren();if(r.error)throw r.error;if(!r.data?.length){postPromoBox.hidden=true;return}postPromoBox.hidden=false;r.data.forEach(async promo=>{const tile=document.createElement('div');tile.style.cssText='box-sizing:border-box;width:100%;min-width:0;padding:10px;border-radius:9px;background:#fff;border:1px solid #eee5f8;display:grid;grid-template-columns:minmax(0,1fr);gap:4px';const totalEstimate=Math.max(0,Math.min(Number(promo.estimated_impressions||0),Number(promo.estimated_clicks||0),Number(promo.estimated_views||0)));tile.innerHTML='<strong>'+String(promo.status).replace(/[<>]/g,'')+'</strong><div style="font-size:12px;color:#6d6578">Budget '+String(promo.currency)+' '+Number(promo.budget||0).toLocaleString()+'</div><div style="font-size:12px;font-weight:700">Estimated total results (impressions, clicks and views combined): '+totalEstimate.toLocaleString()+'</div>';const country=Array.isArray(promo.targeting?.countries)?promo.targeting.countries[0]:'Country';const live=document.createElement('div');live.style.cssText='font-size:12px;font-weight:800;color:#5424b5;margin-top:5px;line-height:1.5;overflow-wrap:anywhere';live.textContent=country+' · Actual: '+Number(promo.impressions_count||0).toLocaleString()+' impressions · '+Number(promo.clicks_count||0).toLocaleString()+' clicks · '+Number(promo.views_count||0).toLocaleString()+' views';tile.appendChild(live);const spent=document.createElement('div');spent.style.cssText='font-size:12px;color:#6d6578;margin-top:4px';spent.textContent='Spent '+String(promo.currency)+' '+Number(promo.spent_amount||0).toLocaleString();tile.appendChild(spent);postPromoBox.appendChild(tile)})}catch(err){postPromoBox.hidden=true;console.warn('Boost metrics unavailable:',err.message)}};
        card.appendChild(postPromoBox);loadPostPromos();
        const commentPanel=document.createElement('div'); commentPanel.className='joint-comment-panel'; commentPanel.hidden=true; commentPanel.style.cssText='display:none;flex-direction:column;max-height:58vh;min-height:0;overflow:hidden;width:100%;box-sizing:border-box;margin-top:10px';
        const commentList=document.createElement('div'); commentList.className='joint-own-comment-list'; commentList.style.cssText='display:flex;flex-direction:column;align-items:stretch;flex:1 1 auto;min-height:0;gap:8px;margin-bottom:10px;max-height:42vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch;padding:14px 2px 8px;scroll-padding-top:14px;width:100%;box-sizing:border-box';
        const commentInput=document.createElement('textarea');commentInput.maxLength=500;commentInput.rows=2;commentInput.placeholder='Write a comment…';commentInput.setAttribute('aria-label','Write a comment');commentInput.style.cssText='display:block;flex:1 1 auto;min-width:0;width:100%;min-height:42px;max-height:120px;box-sizing:border-box;padding:5px 4px;border:0;outline:0;resize:vertical;background:transparent;font:inherit;color:inherit';
        const commentForm=document.createElement('form');commentForm.className='joint-comment-form';commentForm.hidden=false;commentForm.style.cssText='position:sticky;bottom:0;z-index:5;display:flex;gap:8px;flex-wrap:wrap;align-items:center;width:100%;max-width:100%;min-width:0;box-sizing:border-box;flex:0 0 auto;background:#fff;padding:10px 0 calc(10px + env(safe-area-inset-bottom));border-top:1px solid #eee7f5';
        const commentTools=document.createElement('div');commentTools.style.cssText='display:contents';
        const commentPlus=document.createElement('button');commentPlus.type='button';commentPlus.textContent='+';commentPlus.setAttribute('aria-label','Add sticker, upload or gift');commentPlus.style.cssText='border:0;border-radius:50%;width:34px;height:34px;background:#eee5ff;color:#5424b5;font-weight:900;font-size:20px;cursor:pointer';
        const commentToolsPanel=document.createElement('div');commentToolsPanel.hidden=true;commentToolsPanel.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;height:50vh;max-height:50vh;overflow:hidden;box-sizing:border-box;padding:14px 14px calc(14px + env(safe-area-inset-bottom));border:0;border-top:1px solid #e5daf5;border-radius:18px 18px 0 0;background:#fff;display:none;gap:9px;box-shadow:0 -10px 35px #20133130;grid-template-rows:auto auto 1fr auto';
        const pickerHeader=document.createElement('div');pickerHeader.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px';const pickerTitle=document.createElement('strong');pickerTitle.textContent='Stickers & Gifts';pickerTitle.style.cssText='font-size:16px;color:#241735';const pickerClose=document.createElement('button');pickerClose.type='button';pickerClose.textContent='×';pickerClose.setAttribute('aria-label','Close sticker and gift picker');pickerClose.style.cssText='width:32px;height:32px;border:0;border-radius:50%;background:#f3eef9;color:#4b3268;font-size:24px;line-height:1;cursor:pointer';pickerClose.onclick=()=>{commentToolsPanel.hidden=true;commentToolsPanel.style.display='none';giftPinPrompt.hidden=true;giftPinPrompt.style.display='none';selectedGift=null;giftPin.value=''};commentToolsPanel.appendChild(pickerHeader);pickerHeader.append(pickerTitle,pickerClose);
        const pickerTabs=document.createElement('div');pickerTabs.style.cssText='display:flex;gap:8px;overflow-x:auto;padding:2px 0;scrollbar-width:thin';
        const pickerBody=document.createElement('div');pickerBody.style.cssText='min-width:0;min-height:0;max-height:none;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y';
        const pickerPages=document.createElement('div');pickerPages.style.cssText='display:flex;width:300%;transform:translateX(0);transition:transform .22s ease';
        const pageNames=['Stickers','Gifts','Animated'];let activePage=0;
        pageNames.forEach((name,i)=>{const tab=document.createElement('button');tab.type='button';tab.textContent=name;tab.style.cssText='flex:0 0 auto;border:1px solid #e3d8f3;border-radius:999px;padding:8px 13px;background:'+(i===0?'#6938d1':'white')+';color:'+(i===0?'white':'#5424b5')+';font-weight:800';tab.onclick=()=>{activePage=i;[...pickerTabs.children].forEach((x,j)=>{x.style.background=j===i?'#6938d1':'white';x.style.color=j===i?'white':'#5424b5'});pickerPages.style.transform='translateX(-'+(i*33.333)+'%)';pickerBody.scrollTop=0};pickerTabs.appendChild(tab)});
        const stickerPage=document.createElement('div');stickerPage.style.cssText='width:33.333%;flex:0 0 33.333%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-content:start;gap:8px;padding:4px';
        const stickerBase=['❤️','😂','🥰','🎉','👏','🔥','🌟','🤗','💯','😊','😍','😘','🥳','🤩','💖','💝','💞','💫','✨','🌈','🫶','🙌','😎','🥹','😻','💌','🍀','🎈','🧡','💜','💙','💚','💛','🤍','🖤','💋','🌸','🌻','🌺','🌷','🍓','🍒','🍉','🍕','☕','🎂','🎁','🎊','🪄','🦄','🐼','🐸','🐶','🐱','🐻','🐰','🐵','🦊','🐧','🦋','🐢','🐙','🦕','🌼','🌹','🍎','🍇','🍑','🍟','🍩','🍦','🥑','⚽','🏀','🎯','🎸','🎧','🎨','💐','💌','💘','💓','💗','💜','💙','💚','💛','🩷','🩵','🤎','🩶','🫂','🤝','🙏','✌️','🤟','🤘','💪','👏','🙈','🙉','🙊','🥹','🤯','🤔','🤭','🤫','😴','🥱','🤤','😮','😲','😵','🥴','🤠','🥸','🤓','🧐','😇','🤡','👻','💀','☠️','👽','🤖','🎃','😈','👿','💩','🤮','🤧','🤒','😷','🫡','🫠','🫣','🫢','🫤','😶','🫥','🫨','🫶','👐','🤲','🖐️','🫰','🤙','👋','🤞','🫳','🫴','🫵','✍️','🦾','🦿','🦻','👀','👁️','🧠','🫀','🫁','🦷','🦴','🐣','🐥','🐤','🦆','🦉','🦅','🦜','🦚','🦢','🦩','🦈','🐳','🐋','🦭','🦦','🦥','🦔','🦝','🦨','🦡','🦫','🦬','🐘','🦒','🦓','🦛','🦘','🦙','🦣','🐿️','🦃','🐓','🦤','🪿','🪼','🪻','🌵','🌴','🍁','🍄','🌞','🌙','☀️','🌤️','⛈️','❄️','☃️','🌊','🌀','⚡','💧','💦','🧊','🪺','🪹','🪴','🌱','🌿','🍃','🪴','🍄‍🟫','🍋','🍍','🥝','🥭','🥥','🫐','🥨','🧇','🍿','🍪','🍮','🧋','🥤','🍹','🧃','🧉','🍜','🍣','🍔','🌮','🥐','🧀','🫒','🥗','🍯','🧂','🎀','🪅','🎐','🪭','🧿','🪬','🪄','🧸','🪁','🪀','🧩','🎲','🪙','🪄','🎼','🎹','🎺','🥁','🪇','🎭','🎪','🎡','🎢','🎠','🛝','🏅','🥇','🥈','🥉','🎖️','📸','💌','💟','❣️','💌','💟','💢','💬','🗯️','💭','💤'];const stickers=[...new Set(stickerBase)].slice(0,100);
        stickers.forEach(st=>{const b=document.createElement('button');b.type='button';b.textContent=st;b.title='Free sticker '+st;b.style.cssText='aspect-ratio:1/1;border:1px solid #e8e0f2;border-radius:10px;background:white;padding:5px;font-size:23px';b.onclick=()=>{setCommentStickerDraft({kind:'sticker',emoji:st,name:'Sticker'});commentToolsPanel.hidden=true;commentToolsPanel.style.display='none';commentInput.focus();};stickerPage.appendChild(b)});
        const giftPage=document.createElement('div');giftPage.style.cssText='width:33.333%;flex:0 0 33.333%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-content:start;gap:8px;padding:4px';
        const giftCatalog=[['❤️','Heart',1],['🔥','Fire',2],['🌹','Rose',3],['👏','Applause',4],['🎉','Celebration',5],['🌟','Star',6],['🍀','Lucky',7],['🎈','Balloon',8],['💐','Bouquet',9],['🎁','Gift Box',10],['🧸','Teddy',12],['🍰','Cake',15],['🎂','Birthday Cake',18],['💝','Love Box',20],['🦋','Butterfly',25],['🌈','Rainbow',30],['🎵','Music',35],['🎤','Mic',40],['🥂','Cheers',45],['🏵️','Medal',50],['💎','Diamond',60],['🪙','Gold Coin',70],['🛍️','Shopping Bag',80],['🎮','Game',90],['🏆','Trophy',100],['👑','Crown',120],['🚀','Rocket',150],['🛸','UFO',180],['🐬','Dolphin',200],['🦄','Unicorn',250],['🐉','Dragon',300],['🏰','Castle',350],['✈️','Private Jet',400],['💍','Ring',450],['🌠','Shooting Star',500],['🚘','Luxury Car',600],['🛥️','Yacht',700],['🏝️','Island',800],['🌌','Galaxy',900],['🪐','Planet',1000]];
        const giftNames=['Heart','Fire','Rose','Applause','Celebration','Star','Lucky','Balloon','Bouquet','Gift Box','Teddy','Cake','Birthday Cake','Love Box','Butterfly','Rainbow','Music','Mic','Cheers','Medal','Diamond','Gold Coin','Shopping Bag','Game','Trophy','Crown','Rocket','UFO','Dolphin','Unicorn','Dragon','Castle','Private Jet','Ring','Shooting Star','Luxury Car','Yacht','Island','Galaxy','Planet'];
        const giftEmojis=['❤️','🔥','🌹','👏','🎉','🌟','🍀','🎈','💐','🎁','🧸','🍰','🎂','💝','🦋','🌈','🎵','🎤','🥂','🏵️','💎','🪙','🛍️','🎮','🏆','👑','🚀','🛸','🐬','🦄','🐉','🏰','✈️','💍','🌠','🚘','🛥️','🏝️','🌌','🪐'];
        const fixedGifts=Array.from({length:100},(_,i)=>{const catalog=[['❤️','Heart'],['🔥','Fire'],['🌹','Rose'],['👏','Applause'],['🎉','Celebration'],['🌟','Star'],['🍀','Lucky Charm'],['🎈','Balloon'],['💐','Bouquet'],['🎁','Mystery Box'],['🧸','Teddy'],['🍰','Cake'],['🎂','Birthday Cake'],['💝','Love Box'],['🦋','Butterfly'],['🌈','Rainbow'],['🎵','Music'],['🎤','Mic'],['🥂','Cheers'],['🏵️','Medal'],['💎','Diamond'],['🪙','Gold Coin'],['🛍️','Shopping Bag'],['🎮','Game'],['🏆','Trophy'],['👑','Crown'],['🚀','Rocket'],['🛸','UFO'],['🐬','Dolphin'],['🦄','Unicorn'],['🐉','Dragon'],['🏰','Castle'],['✈️','Private Jet'],['💍','Ring'],['🌠','Shooting Star'],['🚘','Luxury Car'],['🛥️','Yacht'],['🏝️','Private Island'],['🌌','Galaxy'],['🪐','Planet']];const extra=['🧚','🪽','🦚','🐳','🦁','🐯','🐻‍❄️','🦖','🧿','🪷','🪄','🎆','🎇','🧨','🪩','🎻','🎹','🎷','🛼','🏎️','🚁','🛩️','⛵','🌋','🏔️','🏯','🗽','🧜','🧞','🐲','🦜','🦩','🪸','🦪','🍭','🍫','🍾','🧁','🪄'];const names=['Phoenix','Fairy','Peacock','Whale','Lion','Tiger','Polar Bear','Dino','Mystic Eye','Lotus','Magic Wand','Fireworks','Sparkler','Confetti','Disco','Violin','Piano','Saxophone','Skates','Racing Car','Helicopter','Jet','Sailboat','Volcano','Mountain','Palace','Liberty','Mermaid','Genie','Dragon Spirit','Parrot','Flamingo','Coral','Pearl','Candy','Chocolate','Champagne','Cupcake','Enchanted Wand'];return i<40?[giftCatalog[i][0],giftCatalog[i][1],i+1]:[extra[(i-40)%extra.length],names[(i-40)%names.length]+' '+(i+1),i+1]});
        let selectedGift=null;
        const giftPinPrompt=document.createElement('div');giftPinPrompt.hidden=true;giftPinPrompt.style.cssText='position:sticky;bottom:0;background:#fff;border:1px solid #e5daf5;border-radius:12px;padding:10px;display:none;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:8px;box-shadow:0 4px 18px #2b17451a';
        const selectedGiftLabel=document.createElement('strong');selectedGiftLabel.style.cssText='grid-column:1/-1;min-width:0';const giftPin=document.createElement('input');giftPin.type='password';giftPin.inputMode='numeric';giftPin.maxLength=6;giftPin.autocomplete='off';giftPin.placeholder='Six-digit wallet PIN';giftPin.style.cssText='grid-column:1/-1;min-width:0;padding:10px;border:1px solid #e7e0f1;border-radius:9px;width:100%;box-sizing:border-box';
        const giftSend=document.createElement('button');giftSend.type='button';giftSend.textContent='Confirm and send gift';giftSend.style.cssText='min-width:0;width:100%;border:0;border-radius:9px;padding:10px;background:#6938d1;color:white;font-weight:800';const giftCancel=document.createElement('button');giftCancel.type='button';giftCancel.textContent='Cancel';giftCancel.style.cssText='min-width:0;width:100%;border:1px solid #e5deef;border-radius:9px;padding:9px;background:white;color:#5424b5;font-weight:700';
        const chooseGift=(gift)=>{selectedGift=gift;selectedGiftLabel.textContent=gift[0]+' '+gift[1]+' · '+gift[2]+' Diamonds';giftPin.value='';giftPinPrompt.hidden=false;giftPinPrompt.style.display='grid';giftPin.focus()};
        fixedGifts.forEach((g,i)=>{const tile=document.createElement('button');tile.type='button';tile.style.cssText='min-width:0;aspect-ratio:1/1;border:1px solid #e8e0f2;border-radius:12px;background:linear-gradient(145deg,#fff,#f7f1ff);padding:6px 3px;display:grid;align-content:center;gap:3px;justify-items:center;cursor:pointer;overflow:hidden';const emoji=document.createElement('span');emoji.textContent=g[0];emoji.style.fontSize='25px';const name=document.createElement('span');name.textContent=g[1];name.style.cssText='font-size:11px;font-weight:800;text-align:center;overflow-wrap:anywhere';const price=document.createElement('span');price.textContent=g[2]+' 💎';price.style.cssText='font-size:11px;color:#6938d1;font-weight:900';tile.append(emoji,name,price);tile.onclick=()=>chooseGift(g);giftPage.appendChild(tile)});
        const animationPage=document.createElement('div');animationPage.style.cssText='width:33.333%;flex:0 0 33.333%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-content:start;gap:8px;padding:4px';const animationStyle=document.createElement('style');animationStyle.textContent='@keyframes jointStickerFloat{0%,100%{transform:translateY(0) rotate(-4deg) scale(1)}50%{transform:translateY(-5px) rotate(4deg) scale(1.12)}}.joint-animated-sticker{animation:jointStickerFloat 1.15s ease-in-out infinite;display:inline-block}';if(!document.querySelector('#joint-sticker-animation-style')){animationStyle.id='joint-sticker-animation-style';document.head.appendChild(animationStyle)}[...new Set(['✨','💫','🎆','🎇','🌠','🦋','💖','🌈','🔥','🎊','🎉','🪄','⭐','💥','🫧','🌟','💐','💎','🎵','🎈','💗','💓','💞','💕','💘','💝','🩷','🩵','🪷','🪽','🧚','🧜','🧞','🐉','🦄','🐬','🐳','🦚','🪩','🎇','🎆','🎇','🎁','🎀','🪄','🧨','🎯','🚀','🛸','🌌','🪐','🌙','☀️','🌈','⚡','🌊','❄️','🍀','🌸','🌺','🌻','🌷','🌹','🌼','🍁','🍄','🫧','💧','💦','🌀','🎶','🎼','🎹','🎸','🎻','🎷','🎺','🥁','🎤','🎧','🎭','🎪','🎡','🎢','🎠','🏆','🥇','🥈','🥉','👑','💎','🪙','🦁','🐯','🐻','🐼','🐨','🐸','🐵','🐧','🦊','🐰','🐱','🐶','🦖','🦕','🦜','🦩','🦈','🪼','🪸','🍓','🍒','🍉','🍍','🥝','🍭','🍫','🍰','🧁','🍹','🧋','🎂','🎈','🎀','🪅','🪁','🪀','🧩','🎲','🛼','🏎️','✈️','🚁','🛥️','🏝️','🏰','🌋','🏔️','🗽'])].forEach((a,i)=>{const b=document.createElement('button');b.type='button';b.title='Animated sticker';b.style.cssText='aspect-ratio:1/1;border:1px solid #e8e0f2;border-radius:10px;background:white;padding:5px;font-size:22px;display:grid;place-items:center';const animSpan=document.createElement('span');animSpan.textContent=a;animSpan.className='joint-animated-sticker';b.appendChild(animSpan);b.onclick=()=>{setCommentStickerDraft({kind:'animated',emoji:a,name:'Animated sticker'});commentToolsPanel.hidden=true;commentToolsPanel.style.display='none';commentInput.focus();};animationPage.appendChild(b)});
        const uploadAnimation=document.createElement('button');uploadAnimation.type='button';uploadAnimation.textContent='＋ Upload';uploadAnimation.style.cssText='grid-column:1/-1;border:1px dashed #cbb8e8;border-radius:10px;padding:10px;text-align:center;background:#fff;color:#5424b5;font-weight:800;cursor:pointer';const uploadOptions=document.createElement('div');uploadOptions.style.cssText='display:none;grid-column:1/-1;grid-template-columns:1fr;gap:8px;padding:4px';const makeUploadOption=(label)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='width:100%;border:1px solid #e3d8f3;border-radius:10px;padding:11px;background:#fff;color:#5424b5;font-weight:800;text-align:left;cursor:pointer';uploadOptions.appendChild(b);return b};const editDeviceOption=makeUploadOption('Edit stickers from device');const editContentOption=makeUploadOption('Edit content');const savedStickersOption=makeUploadOption('Saved stickers');const animationInput=document.createElement('input');animationInput.type='file';animationInput.accept='image/*,video/mp4';animationInput.hidden=true;animationInput.style.display='none';editDeviceOption.onclick=()=>{uploadOptions.style.display='none';animationInput.click();};editContentOption.onclick=async()=>{uploadOptions.style.display='none';try{const sourcePost=post||{};const mediaItems=Array.isArray(sourcePost.media_urls)?sourcePost.media_urls:[];const videoItem=mediaItems.find(item=>{if(!item||typeof item!=='object')return false;const url=String(item.url||item.src||item.path||'');const type=String(item.type||item.mime_type||item.content_type||item.media_type||'').toLowerCase();return type.startsWith('video/')||type==='video'||/\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url);});const directItems=[sourcePost.video_url,sourcePost.videoUrl,sourcePost.video?.url,sourcePost.media?.video_url,sourcePost.attachments?.find?.(item=>String(item?.type||item?.mime_type||'').toLowerCase().startsWith('video'))?.url].filter(x=>typeof x==='string'&&/^https?:\/\//i.test(x));const mediaUrl=videoItem&&(videoItem.url||videoItem.src||videoItem.path);const sourceUrl=(typeof mediaUrl==='string'&&/^https?:\/\//i.test(mediaUrl)?mediaUrl:null)||directItems.find(x=>/\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(x))||directItems[0];if(!sourceUrl)throw new Error(mediaItems.some(item=>item&&typeof item==='object'&&item.url)?'This post contains images, but no video.':'Could not find video media in this post.');editContentOption.disabled=true;editContentOption.textContent='Loading post video…';const response=await fetch(sourceUrl);if(!response.ok)throw new Error('Could not download the post video.');const blob=await response.blob();if(!blob.type.startsWith('video/'))throw new Error('The post media is not a video.');const ext=blob.type.includes('webm')?'webm':blob.type.includes('quicktime')?'mov':'mp4';const file=new File([blob],'joint-post-video.'+ext,{type:blob.type||'video/mp4'});const transfer=new DataTransfer();transfer.items.add(file);animationInput.files=transfer.files;animationInput.dispatchEvent(new Event('change',{bubbles:true}));mediaDraft.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(err){alert(err.message||'Could not open post video editor.')}finally{editContentOption.disabled=false;editContentOption.textContent='Edit content';}};const openSavedStickers=async(selectPath='')=>{uploadOptions.style.display='none';try{const {data:authData,error:authError}=await client.auth.getUser();if(authError)throw authError;const authUid=authData?.user?.id;const pageUid=(typeof currentUser!=='undefined'&&currentUser?.id)||null;const stickerUserIds=[...new Set([authUid,pageUid].filter(Boolean))];if(!stickerUserIds.length)throw new Error('Please sign in to view saved stickers.');const bucket=client.storage.from('joint-saved-stickers');const files=[];const listErrors=[];for(const ownerId of stickerUserIds){const folder=ownerId+'/saved-stickers';const result=await bucket.list(folder,{limit:1000,sortBy:{column:'name',order:'desc'}});if(result.error){listErrors.push(result.error.message||String(result.error));continue;}for(const item of result.data||[])if(item?.name&&item.name!=='.emptyFolderPlaceholder'&&!item.name.startsWith('.'))files.push({...item,_jointPath:folder+'/'+item.name});}files.sort((a,b)=>b.name.localeCompare(a.name));savedStickerGallery.replaceChildren();for(const item of files){const path=item._jointPath;const {data:pub}=bucket.getPublicUrl(path);const url=pub?.publicUrl;if(!url)continue;const ext=(item.name.split('.').pop()||'').toLowerCase();const type=String(item.metadata?.mimetype||({gif:'image/gif',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',ogv:'video/ogg',m4v:'video/mp4',mpeg:'video/mpeg',mpg:'video/mpeg'}[ext]||'application/octet-stream'));const b=document.createElement('button');b.type='button';b.style.cssText='width:70px;height:70px;min-width:70px;min-height:70px;max-width:70px;max-height:70px;box-sizing:border-box;border:0;border-radius:0;padding:0;background:transparent;overflow:hidden;box-shadow:none;outline:none';const v=document.createElement(type.startsWith('video/')?'video':'img');v.src=url;if(v.tagName==='VIDEO'){v.muted=true;v.defaultMuted=true;v.loop=true;v.autoplay=true;v.playsInline=true;v.controls=false;v.disablePictureInPicture=true;v.disableRemotePlayback=true;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');v.addEventListener('loadedmetadata',()=>{v.play().catch(()=>{})},{once:true})}else v.alt='Saved sticker';v.style.cssText='display:block;width:70px;height:70px;min-width:70px;min-height:70px;aspect-ratio:1/1;object-fit:contain;border:0;border-radius:0;padding:0;margin:0;pointer-events:none';b.append(v);b.onclick=()=>{selectedSavedStickerForComment={kind:'animated',name:item.name||'Saved sticker',media_url:url,media_type:type};mediaSavedUrl=url;mediaSavedType=type;selectedMediaFile=null;mediaCaption.value='';mediaPreview.replaceChildren();const selected=document.createElement(type.startsWith('video/')?'video':'img');selected.src=url;if(selected.tagName==='VIDEO'){selected.loop=true;selected.muted=true;selected.defaultMuted=true;selected.autoplay=true;selected.playsInline=true;selected.controls=false;selected.disablePictureInPicture=true;selected.disableRemotePlayback=true;selected.setAttribute('playsinline','');selected.setAttribute('webkit-playsinline','');selected.addEventListener('loadedmetadata',()=>{selected.play().catch(()=>{})},{once:true})}else selected.alt='Saved sticker';selected.style.cssText='display:block;width:70px;height:70px;min-width:70px;min-height:70px;max-width:70px;max-height:70px;aspect-ratio:1/1;object-fit:contain;border-radius:0;margin:0;transform:none;transform-origin:center;clip-path:polygon(0 0,100% 0,100% 100%,0 100%);-webkit-clip-path:polygon(0 0,100% 0,100% 100%,0 100%);mask:none;-webkit-mask:none';commentStickerInline.replaceChildren(selected);commentStickerInline.style.display='flex';addCommentStickerRemoveButton();mediaDraft.style.display='none';trimPanel.style.display='none';mediaCaption.style.display='none';mediaPostButton.style.display='none';saveStickerButton.style.display='none';uploadOptions.style.display='none';commentToolsPanel.hidden=true;commentToolsPanel.style.display='none';commentInput.focus();};savedStickerGallery.append(b);if(path===selectPath){b.style.order='-1';}}if(!files.length){console.warn('JOINT saved stickers: no files found in joint-saved-stickers for user folders',stickerUserIds,listErrors);if(listErrors.length)throw new Error('Could not list joint-saved-stickers. Check Storage SELECT/list permission: '+listErrors.join('; '));alert('No saved stickers found in joint-saved-stickers/'+stickerUserIds[0]+'/saved-stickers.')};}catch(e){alert('Could not open saved stickers: '+(e.message||e));}};savedStickersOption.onclick=()=>openSavedStickers();;uploadAnimation.onclick=()=>{uploadOptions.style.display=uploadOptions.style.display==='grid'?'none':'grid';};const savedStickerGallery=document.createElement('div');savedStickerGallery.style.cssText='grid-column:1/-1;display:grid;grid-template-columns:repeat(4,70px);grid-auto-rows:70px;gap:8px;padding:8px;justify-content:start;align-content:start';animationPage.appendChild(savedStickerGallery);const mediaDraft=document.createElement('div');mediaDraft.style.cssText='grid-column:1/-1;display:none;border:1px solid #e8e0f2;border-radius:14px;padding:10px;background:#fff';const mediaCaption=document.createElement('input');mediaCaption.type='text';mediaCaption.maxLength=500;mediaCaption.style.display='none';mediaCaption.placeholder='Write text to post with this sticker…';mediaCaption.style.cssText='width:100%;box-sizing:border-box;padding:11px;border:1px solid #e3d8f3;border-radius:10px;margin:7px 0';mediaCaption.style.display='none';let mediaSavedUrl='',mediaSavedType='video/webm',newlySavedStickerName='';const mediaPreview=document.createElement('div');mediaPreview.style.cssText='width:320px;height:320px;max-width:100%;aspect-ratio:1/1;box-sizing:border-box;overflow:hidden;border-radius:12px;background:#f8f5fc;display:grid;place-items:center;margin:8px auto;border:1px solid #e3d8f3';const trimPanel=document.createElement('div');trimPanel.style.cssText='display:none;width:100%;max-width:320px;box-sizing:border-box;border:1px solid #e3d8f3;border-radius:10px;padding:8px;margin:8px auto;background:#faf7ff;overflow:hidden';const trimTitle=document.createElement('strong');trimTitle.textContent='Trim video sticker';const trimHint=document.createElement('small');trimHint.textContent='Choose a clip up to 10 seconds.';trimHint.style.cssText='display:block;font-size:11px;color:#6b5b80;margin:4px 0';const trimStartLabel=document.createElement('label');trimStartLabel.textContent='Start: 0.0s';const trimStart=document.createElement('input');trimStart.type='range';trimStart.min='0';trimStart.max='0';trimStart.step='0.1';trimStart.value='0';trimStart.className='joint-trim-range joint-trim-start';trimStart.style.cssText='position:absolute;inset:0;width:100%;height:30px;margin:0;background:transparent;pointer-events:auto;appearance:none;accent-color:#6034c8;z-index:3';const trimEndLabel=document.createElement('label');trimEndLabel.textContent='End: 0.0s';const trimEnd=document.createElement('input');trimEnd.type='range';trimEnd.min='0';trimEnd.max='0';trimEnd.step='0.1';trimEnd.value='0';trimEnd.className='joint-trim-range joint-trim-end';trimEnd.style.cssText='position:absolute;inset:0;width:100%;height:30px;margin:0;background:transparent;pointer-events:auto;appearance:none;accent-color:#6034c8;z-index:4';const trimApply=document.createElement('button');trimApply.type='button';trimApply.textContent='Save sticker';trimApply.style.cssText='width:100%;border:0;border-radius:9px;padding:10px;background:#6034c8;color:white;font-weight:800;margin-top:8px';const trimTrack=document.createElement('div');trimTrack.style.cssText='position:relative;height:30px;margin:8px 0 14px;border-radius:999px;background:#e8e3ef;border:1px solid #d8cce9;overflow:visible;touch-action:pan-y';trimStart.style.pointerEvents='auto';trimEnd.style.pointerEvents='auto';trimStart.style.background='transparent';trimEnd.style.background='transparent';trimTrack.append(trimStart,trimEnd);const trimCss=document.createElement('style');trimCss.textContent='.joint-trim-range{appearance:none;-webkit-appearance:none;background:transparent!important;outline:none}.joint-trim-range::-webkit-slider-runnable-track{height:30px;background:transparent;border:0}.joint-trim-range::-moz-range-track{height:30px;background:transparent;border:0}.joint-trim-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;background:#6034c8;border:3px solid #fff;box-shadow:0 1px 4px #39215c55;margin-top:5px}.joint-trim-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#6034c8;border:3px solid #fff;box-shadow:0 1px 4px #39215c55}';if(!document.querySelector('#joint-trim-range-css')){trimCss.id='joint-trim-range-css';document.head.appendChild(trimCss)};const trimCancel=document.createElement('button');trimCancel.type='button';trimCancel.textContent='×';trimCancel.setAttribute('aria-label','Cancel media editing');trimCancel.title='Cancel editing';trimCancel.style.cssText='position:absolute;top:6px;right:7px;width:30px;height:30px;border:0;border-radius:50%;background:#f1eafb;color:#5424b5;font-size:23px;line-height:1;cursor:pointer;z-index:5';trimPanel.style.position='relative';trimCancel.onclick=()=>{selectedMediaFile=null;animationInput.value='';if(mediaPreviewUrl){URL.revokeObjectURL(mediaPreviewUrl);mediaPreviewUrl=null}preview=null;mediaPreview.replaceChildren();mediaDraft.style.display='none';trimPanel.style.display='none';mediaPostButton.style.display='none';trimStart.value='0';trimEnd.value='0';};trimPanel.append(trimCancel,trimTitle,trimHint,trimStartLabel,trimTrack,trimEndLabel,trimApply);const paintTrimTrack=()=>{const d=Number(trimStart.max)||0,a=d?Math.max(0,Math.min(100,Number(trimStart.value)/d*100)):0,b=d?Math.max(a,Math.min(100,Number(trimEnd.value)/d*100)):100;trimTrack.style.background='linear-gradient(to right,#e8e3ef 0%,#e8e3ef '+a+'%,#6034c8 '+a+'%,#6034c8 '+b+'%,#e8e3ef '+b+'%,#e8e3ef 100%)'};const installTrimHandleDrag=()=>{trimStart.style.pointerEvents='none';trimEnd.style.pointerEvents='none';let activeHandle=null;const valueAt=(event)=>{const rect=trimTrack.getBoundingClientRect(),duration=Number(trimStart.max)||0;return Math.max(0,Math.min(duration,((event.clientX-rect.left)/Math.max(1,rect.width))*duration))};const chooseHandle=(event)=>{const duration=Number(trimStart.max)||0,a=Number(trimStart.value)||0,b=Number(trimEnd.value)||duration,rect=trimTrack.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)))*duration;return Math.abs(x-a)<=Math.abs(x-b)?trimStart:trimEnd};const update=(event)=>{if(!activeHandle)return;const duration=Number(trimStart.max)||0,v=valueAt(event);if(activeHandle===trimStart)trimStart.value=String(Math.min(v,Math.max(0,Number(trimEnd.value)-0.1)));else trimEnd.value=String(Math.max(v,Math.min(duration,Number(trimStart.value)+0.1)));activeHandle.dispatchEvent(new Event('input',{bubbles:true}));};trimTrack.addEventListener('pointerdown',event=>{if(!preview||preview.tagName!=='VIDEO'||!Number(trimStart.max))return;event.preventDefault();activeHandle=chooseHandle(event);trimTrack.setPointerCapture?.(event.pointerId);update(event)});trimTrack.addEventListener('pointermove',event=>{if(activeHandle)update(event)});const stop=()=>{activeHandle=null};trimTrack.addEventListener('pointerup',stop);trimTrack.addEventListener('pointercancel',stop);};installTrimHandleDrag();const mediaPostButton=document.createElement('button');mediaPostButton.type='button';mediaPostButton.textContent='Post comment';mediaPostButton.style.cssText='width:100%;border:0;border-radius:10px;padding:12px;background:#6034c8;color:#fff;font-weight:800';mediaPostButton.style.display='none';const savedCommentArea=document.createElement('div');savedCommentArea.style.cssText='grid-column:1/-1;display:none;gap:8px;padding:8px;border:1px solid #e3d8f3;border-radius:12px';animationPage.appendChild(savedCommentArea);mediaDraft.append(mediaPreview,trimPanel);mediaCaption.style.display='none';animationPage.append(uploadOptions,mediaDraft);let selectedMediaFile=null,mediaPreviewUrl=null,preview=null;
animationInput.onchange=()=>{
 const f=animationInput.files?.[0];if(!f)return;
 if(f.size>50*1024*1024){alert('Choose a file under 50 MB.');animationInput.value='';return}
 selectedMediaFile=f;
 if(mediaPreviewUrl)URL.revokeObjectURL(mediaPreviewUrl);
 mediaPreviewUrl=URL.createObjectURL(f);
 mediaPreview.replaceChildren();
 if(f.type.startsWith('video/')){
  preview=document.createElement('video');preview.muted=true;preview.controls=false;preview.autoplay=true;preview.loop=true;preview.playsInline=true;preview.setAttribute('webkit-playsinline','');
 }else{preview=document.createElement('img');preview.alt=f.name}
 preview.src=mediaPreviewUrl;
 preview.style.cssText='display:block;width:320px;height:320px;max-width:100%;max-height:100%;aspect-ratio:1/1;object-fit:contain;object-position:center;background:transparent;border:0';
 mediaPreview.appendChild(preview);mediaDraft.style.display='block';if(preview.tagName==='VIDEO'){preview.addEventListener('loadeddata',()=>{preview.currentTime=0;preview.play().catch(()=>{})},{once:true});preview.addEventListener('timeupdate',()=>{if(preview.currentTime>=Number(trimEnd.value)&&!preview.paused){preview.pause();preview.currentTime=Number(trimStart.value)}})};
 if(f.type.startsWith('video/')){
  trimPanel.style.display='block';
  preview.addEventListener('loadedmetadata',()=>{
   const d=Math.max(0,preview.duration||0);
   trimStart.max=trimEnd.max=String(d);trimStart.value='0';trimEnd.value=String(Math.min(d,10));
   trimStart.max=trimEnd.max=String(d);trimEnd.min='0';preview.currentTime=0;
   trimStartLabel.textContent='Start: 0.0s';trimEndLabel.textContent='End: '+Math.min(d,10).toFixed(1)+'s';paintTrimTrack();preview.currentTime=0;preview.play().catch(()=>{});
  },{once:true});
 }else{trimPanel.style.display='none';saveStickerButton.style.display='block'}

};
trimStart.oninput=()=>{
 if(!preview||preview.tagName!=='VIDEO')return;
 let a=Number(trimStart.value),b=Number(trimEnd.value);
 if(a>=b){b=Math.min(Number(trimEnd.max),a+0.1);trimEnd.value=String(b)}
 trimStartLabel.textContent='Start: '+a.toFixed(1)+'s';trimEndLabel.textContent='End: '+Number(trimEnd.value).toFixed(1)+'s';
 paintTrimTrack();preview.currentTime=a;preview.play().catch(()=>{});
};
trimEnd.oninput=()=>{
 if(!preview||preview.tagName!=='VIDEO')return;
 let b=Number(trimEnd.value),a=Number(trimStart.value);
 if(b<=a){a=Math.max(0,b-0.1);trimStart.value=String(a)}
 trimStartLabel.textContent='Start: '+Number(trimStart.value).toFixed(1)+'s';trimEndLabel.textContent='End: '+b.toFixed(1)+'s';
 paintTrimTrack();preview.currentTime=Math.min(Math.max(preview.currentTime,a),Math.max(a,b-0.05));preview.play().catch(()=>{});
};
trimApply.onclick=async()=>{const original=selectedMediaFile;if(!original)return;if(!original.type.startsWith('video/')){await saveStickerButton.onclick();return}const start=Number(trimStart.value),end=Number(trimEnd.value);if(end<=start||end-start>10){alert('Choose a clip up to 10 seconds long.');return}try{trimApply.disabled=true;trimApply.textContent='Preparing sticker…';const v=document.createElement('video');v.src=mediaPreviewUrl;v.muted=true;v.playsInline=true;await new Promise((resolve,reject)=>{v.onloadedmetadata=resolve;v.onerror=reject});const canvas=document.createElement('canvas');canvas.width=v.videoWidth||720;canvas.height=v.videoHeight||1280;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(25);const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t))||'';if(!window.MediaRecorder||!stream)throw new Error('Video trimming is not supported by this browser.');const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{}),chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const done=new Promise((resolve,reject)=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType||'video/webm'}));recorder.onerror=()=>reject(new Error('Could not create trimmed video.'))});await new Promise((resolve,reject)=>{v.currentTime=start;v.onseeked=resolve;v.onerror=reject});recorder.start();const draw=()=>{if(recorder.state!=='recording')return;ctx.drawImage(v,0,0,canvas.width,canvas.height);if(v.currentTime>=end){v.pause();recorder.stop();return}requestAnimationFrame(draw)};await v.play();draw();const blob=await done;if(!blob.size)throw new Error('Trim produced an empty video.');selectedMediaFile=new File([blob],'joint-sticker-trim.webm',{type:blob.type});if(mediaPreviewUrl)URL.revokeObjectURL(mediaPreviewUrl);mediaPreviewUrl=URL.createObjectURL(blob);preview.src=mediaPreviewUrl;trimApply.textContent='Saving sticker…';await saveEditedSticker();}catch(err){alert(err.message||String(err));trimApply.textContent='Save sticker'}finally{trimApply.disabled=false}};const saveStickerButton=document.createElement('button');saveStickerButton.type='button';saveStickerButton.textContent='Save sticker';saveStickerButton.style.cssText='width:100%;border:1px solid #6034c8;border-radius:10px;padding:11px;background:#fff;color:#6034c8;font-weight:800;margin-top:7px';saveStickerButton.style.display='none';const saveEditedSticker=async()=>{const f=selectedMediaFile;if(!f)return;const button=f.type.startsWith('video/')?trimApply:saveStickerButton;try{const {data:saveAuthData,error:saveAuthError}=await client.auth.getUser();if(saveAuthError)throw saveAuthError;const saveUserId=saveAuthData?.user?.id||currentUser?.id;if(!saveUserId)throw new Error('Please sign in to save stickers.');button.disabled=true;button.textContent='Saving…';const ext=(f.name.split('.').pop()||'webm').toLowerCase().replace(/[^a-z0-9]/g,'')||'webm';const path=saveUserId+'/saved-stickers/'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.'+ext;const {data:uploaded,error}=await client.storage.from('joint-saved-stickers').upload(path,f,{cacheControl:'3600',upsert:false,contentType:f.type||'application/octet-stream'});if(error)throw error;mediaSavedType=f.type||'video/webm';const savedPath=uploaded?.path||path;const {data:publicData}=client.storage.from('joint-saved-stickers').getPublicUrl(savedPath);mediaSavedUrl=publicData?.publicUrl||'';if(!mediaSavedUrl)throw new Error('Could not create a saved sticker URL.');mediaDraft.style.display='none';selectedMediaFile=null;animationInput.value='';trimPanel.style.display='none';saveStickerButton.style.display='none';await openSavedStickers();}catch(e){alert('Could not save sticker: '+(e.message||e));}finally{button.disabled=false;button.textContent='Save and post sticker';}};saveStickerButton.onclick=saveEditedSticker;mediaPostButton.onclick=async()=>{if(!mediaSavedUrl||mediaPostButton.disabled)return;const commentText=mediaCaption.value.trim();mediaPostButton.disabled=true;mediaPostButton.textContent='Posting…';try{if(!post?.id)throw new Error('This post is not available for media comments.');if(!currentUser?.id)throw new Error('Please sign in before posting.');const payload={kind:'animated',name:selectedMediaFile?.name||'Saved sticker',media_url:mediaSavedUrl,media_type:mediaSavedType,caption:commentText};const content='JOINT_GIFT_CARD::'+JSON.stringify(payload);const {error}=await client.from('joint_comments').insert({post_id:post.id,user_id:currentUser.id,content,parent_comment_id:null});if(error)throw error;commentToolsPanel.hidden=true;commentToolsPanel.style.display='none';mediaDraft.style.display='none';savedCommentArea.style.display='none';mediaSavedUrl='';mediaSavedType='video/webm';selectedMediaFile=null;animationInput.value='';mediaCaption.value='';mediaCaption.style.display='none';saveStickerButton.textContent='Save sticker';await loadComments();}catch(err){alert('Could not post sticker comment: '+(err?.message||String(err)))}finally{mediaPostButton.disabled=false;mediaPostButton.textContent='Post comment'}};animationPage.appendChild(uploadAnimation);animationPage.insertBefore(uploadAnimation,animationPage.firstChild);animationPage.insertBefore(mediaDraft,uploadAnimation);animationPage.insertBefore(uploadOptions,uploadAnimation.nextSibling);
        pickerPages.append(stickerPage,giftPage,animationPage);pickerBody.appendChild(pickerPages);let swipeX=0;pickerBody.addEventListener('touchstart',e=>{swipeX=e.changedTouches[0].clientX},{passive:true});pickerBody.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-swipeX;if(Math.abs(dx)>55){const next=Math.max(0,Math.min(2,activePage+(dx<0?1:-1)));pickerTabs.children[next]?.click()}},{passive:true});commentToolsPanel.append(pickerTabs,pickerBody,giftPinPrompt);
        giftCancel.onclick=()=>{giftPinPrompt.hidden=true;giftPinPrompt.style.display='none';selectedGift=null};giftSend.onclick=async()=>{const pin=giftPin.value.trim();if(!selectedGift)return;if(!/^[0-9]{6}$/.test(pin)){alert('Enter your six-digit wallet PIN.');return}if(!post.author_id||post.author_id===currentUser.id){alert('You cannot send a gift to yourself.');return}giftSend.disabled=true;try{const c=await getClient();const key=crypto.randomUUID?crypto.randomUUID():('commentgift-'+Date.now());const r=await c.rpc('joint_diamond_send_comment_gift',{p_post_id:post.id,p_recipient_user_id:post.author_id,p_diamond_amount:selectedGift[2],p_pin:pin,p_idempotency_key:key});if(r.error)throw r.error;if(!r.data?.ok)throw new Error(r.data?.message||'Gift could not be sent.');const sentGift=selectedGift;setCommentStickerDraft({kind:'gift',name:sentGift[1],emoji:sentGift[0],diamonds:sentGift[2]});giftPin.value='';giftPinPrompt.hidden=true;giftPinPrompt.style.display='none';commentToolsPanel.hidden=true;commentToolsPanel.style.display='none';selectedGift=null;commentInput.focus();}catch(e){alert('Could not send gift: '+(e.message||'Unknown error'))}finally{giftSend.disabled=false}};
        giftPinPrompt.append(selectedGiftLabel,giftPin,giftSend,giftCancel);commentPlus.onclick=()=>{commentToolsPanel.hidden=!commentToolsPanel.hidden;commentToolsPanel.style.display=commentToolsPanel.hidden?'none':'grid';if(!commentToolsPanel.hidden){giftPinPrompt.hidden=true;pickerBody.scrollTop=0}};
        const sendComment=document.createElement('button');sendComment.type='submit';sendComment.textContent='Post comment';sendComment.style.cssText='border:0;border-radius:10px;padding:10px 14px;background:#6938d1;color:white;font-weight:700';
        let selectedSavedStickerForComment=null;const addCommentStickerRemoveButton=()=>{commentStickerInline.style.position='relative';const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove selected sticker');remove.style.cssText='position:absolute;top:1px;right:1px;z-index:5;width:20px;height:20px;min-width:20px;padding:0;border:0;border-radius:50%;background:rgba(35,24,48,.82);color:#fff;font-size:18px;font-weight:800;line-height:18px;text-align:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25)';remove.onclick=(event)=>{event.preventDefault();event.stopPropagation();const media=commentStickerInline.querySelector('video');if(media)media.pause();selectedSavedStickerForComment=null;commentStickerInline.replaceChildren();commentStickerInline.style.display='none';mediaSavedUrl='';mediaSavedType='video/webm';selectedMediaFile=null;};commentStickerInline.appendChild(remove);};const setCommentStickerDraft=(payload)=>{selectedSavedStickerForComment=payload;commentStickerInline.replaceChildren();if(payload?.emoji){const preview=document.createElement('span');preview.textContent=payload.emoji;preview.style.cssText='display:flex;align-items:center;justify-content:center;width:70px;height:70px;min-width:70px;max-width:70px;box-sizing:border-box;font-size:48px;line-height:1;overflow:hidden';commentStickerInline.appendChild(preview);if(Number(payload.diamonds)>0){const price=document.createElement('small');price.textContent=payload.diamonds+' 💎';price.style.cssText='font-size:11px;font-weight:800;color:#6938d1';commentStickerInline.appendChild(price)}}else if(payload?.media_url){const media=document.createElement(String(payload.media_type||'').startsWith('video/')?'video':'img');media.src=payload.media_url;if(media.tagName==='VIDEO'){media.muted=true;media.defaultMuted=true;media.loop=true;media.autoplay=true;media.playsInline=true;media.controls=false;media.setAttribute('playsinline','');media.addEventListener('loadedmetadata',()=>media.play().catch(()=>{}),{once:true})}else media.alt=payload.name||'Selected sticker';media.style.cssText='display:block;width:70px;height:70px;min-width:70px;max-width:70px;aspect-ratio:1/1;object-fit:contain;border-radius:0';commentStickerInline.appendChild(media)}commentStickerInline.style.display='flex';addCommentStickerRemoveButton();};const commentStickerInline=document.createElement('span');commentStickerInline.className='joint-comment-sticker-draft';commentStickerInline.style.cssText='display:none;width:70px;height:70px;min-width:70px;max-width:70px;flex:0 0 70px;align-items:center;justify-content:center;overflow:hidden;border-radius:0;margin:2px 0;clip-path:inset(0)';const commentComposer=document.createElement('div');commentComposer.className='joint-comment-composer';commentComposer.style.cssText='display:flex;flex:1 1 100%;flex-direction:column;gap:6px;min-width:0;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d8d1e3;border-radius:12px;background:#fff';commentComposer.append(commentInput,commentStickerInline);commentForm.append(commentComposer,commentPlus,sendComment);document.body.appendChild(commentToolsPanel);
        commentPanel.append(commentList,commentForm);interactionBox.appendChild(commentPanel);card.appendChild(interactionBox);
        const loadComments = async () => {
          commentList.replaceChildren();
          try {
            const c=await getClient();
            const {data:rows,error}=await c.from('joint_comments').select('id,user_id,content,created_at,parent_comment_id').eq('post_id',post.id).order('created_at',{ascending:false});
            if(error)throw error;
            const ids=[...new Set((rows||[]).map(x=>x.user_id).filter(Boolean))];let profiles=[];
            if(ids.length){const pr=await c.from('joint_profiles').select('id,display_name,avatar_url').in('id',ids);if(!pr.error)profiles=pr.data||[];}
            const profileMap=new Map(profiles.map(x=>[x.id,x]));
            const byParent=new Map();(rows||[]).forEach(row=>{const key=row.parent_comment_id||null;if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(row)});
            const renderRow=(row,depth=0,container=commentList)=>{
              const prof=profileMap.get(row.user_id)||{},nameText=prof.display_name||'JOINT member';
              const item=document.createElement('div');item.style.cssText=`box-sizing:border-box;width:100%;max-width:100%;min-width:0;background:${depth===0?'#f7f4fc':depth===1?'#eee7fb':'#e5dcf7'};border:1px solid ${depth===0?'#eee7f5':'#d9c9f1'};border-radius:10px;padding:10px;overflow-wrap:anywhere;word-break:normal;overflow-x:hidden;flex:0 0 auto;align-self:stretch;height:auto;min-height:fit-content`;
              const head=document.createElement('div');head.style.cssText='display:flex;align-items:center;gap:9px;min-width:0;width:100%;flex-wrap:nowrap';
              const avatar=document.createElement('a');avatar.href='member-profile.html?id='+encodeURIComponent(row.user_id||'');avatar.style.cssText='width:34px;height:34px;flex:0 0 34px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:#eee5ff;color:#5424b5;font-size:12px;font-weight:800;text-decoration:none';
              const initials=nameText.trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'J';avatar.textContent=initials;
              if(prof.avatar_url){const img=document.createElement('img');img.src=prof.avatar_url;img.alt=nameText+' profile picture';img.style.cssText='width:100%;height:100%;object-fit:cover';img.onerror=()=>{img.remove();avatar.textContent=initials};avatar.textContent='';avatar.appendChild(img)}
              const name=document.createElement('a');name.textContent=nameText;name.href='member-profile.html?id='+encodeURIComponent(row.user_id||'');name.style.cssText='font-weight:800;color:inherit;text-decoration:none;min-width:0;white-space:normal;overflow-wrap:anywhere;flex:1 1 auto;line-height:1.35';head.append(avatar,name);item.append(head);
              const giftPrefix='JOINT_GIFT_CARD::';const rawComment=String(row.content||'');if(rawComment.startsWith(giftPrefix)){let gift=null;try{gift=JSON.parse(rawComment.slice(giftPrefix.length))}catch(e){}const giftWrap=document.createElement('div');giftWrap.className='joint-gift-comment-card';giftWrap.style.cssText='display:flex;flex-direction:column;align-items:flex-start;gap:5px;width:100%;max-width:100%;min-width:0;margin:7px 0;box-sizing:border-box;background:transparent;border:0;padding:0;overflow:visible';if(gift?.caption){const caption=document.createElement('p');caption.textContent=gift.caption;caption.style.cssText='margin:0;width:100%;white-space:pre-wrap;overflow-wrap:anywhere;color:#17111f;font-size:1.05rem;font-weight:800;line-height:1.5';giftWrap.append(caption)}if(gift?.emoji){const sticker=document.createElement('span');sticker.textContent=gift.emoji;if(gift.kind==='animated')sticker.className='joint-comment-animated-emoji joint-animated-sticker';sticker.style.cssText='display:block;width:70px;height:70px;line-height:70px;text-align:center;font-size:48px;flex:0 0 70px';giftWrap.append(sticker)}if(Number(gift?.diamonds)>0){const price=document.createElement('small');price.textContent=gift.diamonds+' 💎';price.style.cssText='font-size:12px;font-weight:800;color:#6938d1';giftWrap.append(price)}if(gift?.media_url){const stickerUrl=String(gift.media_url||'');
 const stickerMime=String(gift.media_type||'').toLowerCase();
 const stickerIsVideo=stickerMime.startsWith('video/')||/\.(mp4|webm|mov|m4v|ogv|mpeg|mpg)(?:[?#]|$)/i.test(stickerUrl);
 const media=document.createElement(stickerIsVideo?'video':'img');
 media.className='comment-sticker joint-comment-sticker-media';media.dataset.jointCommentSticker='1';
 if(stickerIsVideo){
   media.muted=true;media.defaultMuted=true;media.loop=true;media.autoplay=true;media.playsInline=true;media.controls=false;
   media.preload='auto';media.disablePictureInPicture=true;media.disableRemotePlayback=true;
   media.setAttribute('muted','');media.setAttribute('autoplay','');media.setAttribute('loop','');
   media.setAttribute('playsinline','');media.setAttribute('webkit-playsinline','');
   const startStickerPlayback=()=>{if(media.paused)media.play().catch(()=>{})};
   media.addEventListener('loadedmetadata',startStickerPlayback);
   media.addEventListener('loadeddata',startStickerPlayback);
   media.addEventListener('canplay',startStickerPlayback);
 }else{media.alt=gift.name||'Comment sticker';media.loading='lazy';}
 media.style.cssText="display:block!important;width:70px!important;height:70px!important;min-width:70px!important;min-height:70px!important;max-width:70px!important;max-height:70px!important;aspect-ratio:1/1!important;box-sizing:border-box!important;object-fit:cover!important;object-position:center center!important;border:0!important;border-radius:0!important;border-top-left-radius:0!important;border-top-right-radius:0!important;border-bottom-left-radius:0!important;border-bottom-right-radius:0!important;padding:0!important;margin:0!important;transform:none!important;clip-path:inset(0)!important;-webkit-clip-path:inset(0)!important;mask:none!important;-webkit-mask:none!important;box-shadow:none!important;vertical-align:top!important;flex:0 0 70px!important;";
 media.src=stickerUrl;
 if(stickerIsVideo){
   // Sticker-only: never expose native playback UI, and never pause on touch.
   media.controls=false;media.removeAttribute('controls');
   media.setAttribute('controlslist','nodownload noplaybackrate nofullscreen');
   media.style.setProperty('pointer-events','none','important');
   media.style.setProperty('width','76px','important');
   media.style.setProperty('height','76px','important');
   media.style.setProperty('min-width','76px','important');
   media.style.setProperty('min-height','76px','important');
   media.style.setProperty('max-width','76px','important');
   media.style.setProperty('max-height','76px','important');
   media.style.setProperty('flex','0 0 76px','important');
   media.style.setProperty('transform','translate(-3px,-3px)','important');
   media.style.setProperty('border-radius','0','important');
   media.addEventListener('pause',()=>{if(media.isConnected)media.play().catch(()=>{})});
 }

 if(stickerIsVideo){const stickerBox=document.createElement('span');stickerBox.className='joint-comment-sticker-wrap';stickerBox.style.cssText='display:block;position:relative;width:70px;height:70px;min-width:70px;min-height:70px;max-width:70px;max-height:70px;flex:0 0 70px;overflow:hidden;clip-path:inset(0);-webkit-clip-path:inset(0);margin:0;padding:0;border:0;border-radius:0!important;border-top-left-radius:0!important;border-top-right-radius:0!important;border-bottom-left-radius:0!important;border-bottom-right-radius:0!important;background:transparent;line-height:0';stickerBox.appendChild(media);giftWrap.appendChild(stickerBox);}else{giftWrap.appendChild(media);}
 if(stickerIsVideo){media.load();media.play().catch(()=>{})}}item.append(giftWrap)}else{const text=document.createElement('p');text.style.cssText='margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere;color:#17111f;font-size:1.08rem;font-weight:900;line-height:1.6;text-shadow:0 0 .01px currentColor';text.textContent=rawComment;item.append(text)}
              const reply=document.createElement('button');reply.type='button';reply.textContent='reply';reply.style.cssText='border:0;background:transparent;color:#5424b5;font-weight:700;font-size:.78rem;padding:2px 0;cursor:pointer';
              const replyForm=document.createElement('form');replyForm.hidden=true;replyForm.className='joint-reply-form';replyForm.style.cssText='display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;width:100%;max-width:100%;min-width:0;box-sizing:border-box';const replyInput=document.createElement('input');replyInput.type='text';replyInput.maxLength=500;replyInput.required=true;replyInput.placeholder='Reply to '+nameText+'…';replyInput.style.cssText='flex:1 1 150px;min-width:0;max-width:100%;box-sizing:border-box;padding:9px;border:1px solid #e7e0f1;border-radius:9px';const replySend=document.createElement('button');replySend.type='submit';replySend.textContent='Send';replySend.style.cssText='border:0;border-radius:9px;padding:8px 12px;background:#6938d1;color:white;font-weight:700';replyForm.append(replyInput,replySend);
              reply.onclick=()=>{replyForm.hidden=!replyForm.hidden;if(!replyForm.hidden)replyInput.focus()};replyForm.onsubmit=async ev=>{ev.preventDefault();const content=replyInput.value.trim();if(!content)return;const pageScrollX=window.scrollX,pageScrollY=window.scrollY;const scrollNodes=[];let scrollNode=commentList;while(scrollNode){if(scrollNode.scrollHeight>scrollNode.clientHeight+2)scrollNodes.push([scrollNode,scrollNode.scrollTop]);scrollNode=scrollNode.parentElement;}const oldAnchor=commentList.style.overflowAnchor;commentList.style.overflowAnchor='none';const restoreCommentScroll=()=>{window.scrollTo(pageScrollX,pageScrollY);scrollNodes.forEach(([node,top])=>{if(node.isConnected)node.scrollTop=top;});};replySend.disabled=true;try{const {error}=await c.from('joint_comments').insert({post_id:post.id,user_id:currentUser.id,content,parent_comment_id:row.id});if(error)throw error;replyInput.value='';replyInput.blur();replyForm.hidden=true;await loadComments();requestAnimationFrame(()=>{restoreCommentScroll();requestAnimationFrame(()=>{restoreCommentScroll();commentList.style.overflowAnchor=oldAnchor;});});}catch(err){commentList.style.overflowAnchor=oldAnchor;restoreCommentScroll();alert('Could not post reply: '+err.message)}finally{replySend.disabled=false}};
              const reactionWrap=document.createElement('div');reactionWrap.style.cssText='display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:7px 0';
              const addReact=document.createElement('button');addReact.type='button';addReact.textContent='+';addReact.setAttribute('aria-label','React to comment');addReact.style.cssText='border:0;background:#f0e8ff;color:#5424b5;border-radius:50%;width:38px;height:38px;font-weight:900;font-size:1.25rem;cursor:pointer';
              const picker=document.createElement('div');picker.hidden=true;picker.style.cssText='display:none;flex-wrap:wrap;gap:8px;padding:7px 0';
              const emojis=['👍','👎','❤️','😂','😢','😡','😊','🤗'];
              const drawReactions=async()=>{try{const {data,error}=await c.from('joint_comment_reactions').select('emoji,user_id').eq('context_type','post').eq('context_id',String(post.id)).eq('comment_id',String(row.id));if(error)throw error;reactionWrap.querySelectorAll('.social-comment-reaction-count').forEach(n=>n.remove());const counts=new Map();(data||[]).forEach(r=>counts.set(r.emoji,(counts.get(r.emoji)||0)+1));for(const [emoji,count] of counts){const b=document.createElement('span');b.className='social-comment-reaction-count';b.textContent=emoji+' '+count;b.style.cssText='font-size:1.1rem;font-weight:700';reactionWrap.appendChild(b)}}catch(e){console.warn('Profile comment reactions unavailable:',e.message)}};
              emojis.forEach(emoji=>{const b=document.createElement('button');b.type='button';b.textContent=emoji;b.setAttribute('aria-label','React '+emoji);b.style.cssText='border:0;background:transparent;padding:3px;font-size:1.5rem;cursor:pointer';b.onclick=async()=>{try{const {data:{user},error:authError}=await c.auth.getUser();if(authError)throw authError;if(!user)throw new Error('Please sign in to react.');const {error}=await c.from('joint_comment_reactions').insert({context_type:'post',context_id:String(post.id),comment_id:String(row.id),user_id:user.id,emoji});picker.hidden=true;picker.style.display='none';if(error&&error.code==='23505'){await drawReactions();return}if(error)throw error;await drawReactions()}catch(e){alert('Could not save reaction: '+e.message)}};picker.appendChild(b)});
              addReact.onclick=()=>{const open=picker.hidden||picker.style.display==='none';picker.hidden=!open;picker.style.display=open?'flex':'none'};reactionWrap.append(addReact,picker);item.append(reactionWrap);void drawReactions();
              item.append(reply,replyForm);container.appendChild(item);
              const children=byParent.get(row.id)||[];if(!children.length)return;const replyArea=document.createElement('div');replyArea.className='joint-reply-area';replyArea.style.cssText=`display:flex;flex-direction:column;align-items:stretch;flex:0 0 auto;gap:7px;margin:7px 0 0;padding:0 0 0 9px;border-left:3px solid ${depth===0?'#d7c4fb':'#bda5e9'};width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow:visible`;item.appendChild(replyArea);let visible=0;const more=document.createElement('button');more.type='button';more.textContent='View replies ('+children.length+')';more.style.cssText='justify-self:start;border:0;border-radius:999px;background:#eee5ff;color:#5424b5;padding:5px 10px;font-size:.82rem;font-weight:800;cursor:pointer';const showNext=()=>{if(visible>0&&visible>=children.length){replyArea.replaceChildren();visible=0;more.textContent='View replies ('+children.length+')';return;}children.slice(visible,visible+5).forEach(child=>renderRow(child,depth+1,replyArea));visible=Math.min(visible+5,children.length);more.textContent=visible<children.length?'View more replies ('+(children.length-visible)+' remaining)':'^';};more.addEventListener('click',showNext);item.appendChild(more);
            };
            (byParent.get(null)||[]).forEach(row=>renderRow(row,0,commentList));
            if(!rows?.length){const empty=document.createElement('p');empty.textContent='No comments yet. Start the conversation.';empty.style.color='#777486';commentList.appendChild(empty);}
          } catch(err){const msg=document.createElement('p');msg.textContent='Could not load comments: '+err.message;commentList.appendChild(msg);}
        };
        commentForm.onsubmit=async ev=>{ev.preventDefault();const text=commentInput.value.trim();if(!text&&!selectedSavedStickerForComment)return;sendComment.disabled=true;try{const c=await getClient();const content=selectedSavedStickerForComment?'JOINT_GIFT_CARD::'+JSON.stringify({...selectedSavedStickerForComment,caption:text}):text;const {error}=await c.from('joint_comments').insert({post_id:post.id,user_id:currentUser.id,content,parent_comment_id:null});if(error)throw error;commentInput.value='';selectedSavedStickerForComment=null;commentStickerInline.replaceChildren();commentStickerInline.style.display='none';mediaSavedUrl='';await loadComments();}catch(err){alert('Could not post comment: '+err.message);}finally{sendComment.disabled=false;}};
        // Load comment threads on demand; replies are stored against their parent comment.
        const originalCommentClick=actionRow.children[1].onclick;
        actionRow.children[1].onclick=async()=>{commentPanel.hidden=!commentPanel.hidden;commentPanel.style.display=commentPanel.hidden?'none':'flex';if(!commentPanel.hidden){await loadComments();commentInput.focus();}};

        const menuWrap=document.createElement('div');menuWrap.className='joint-post-menu-wrap';
        const menuButton=document.createElement('button');menuButton.type='button';menuButton.className='joint-post-menu';menuButton.textContent='⋯';menuButton.setAttribute('aria-label','Post options');menuButton.setAttribute('aria-expanded','false');
        const menuPanel=document.createElement('div');menuPanel.className='joint-post-menu-popover';menuPanel.hidden=true;
        const edit=document.createElement('button');edit.type='button';edit.dataset.edit=post.id;edit.textContent='Edit post';
        const remove=document.createElement('button');remove.type='button';remove.dataset.delete=post.id;remove.textContent='Delete post';
        menuPanel.append(edit,remove);menuButton.addEventListener('click',()=>{const open=menuPanel.hidden;menuPanel.hidden=!open;menuButton.setAttribute('aria-expanded',String(open));});
        document.addEventListener('click',event=>{if(!menuWrap.contains(event.target)){menuPanel.hidden=true;menuButton.setAttribute('aria-expanded','false');}});
        menuWrap.append(menuButton,menuPanel);head.append(menuWrap);
        target.appendChild(card);
      });
      // Shared JOINT video controller handles autoplay, sound, and tap-to-show controls.
      target.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('Delete this post from JOINT for everyone?')) return;
        button.disabled = true;
        try {
          const client = await getClient();
          const { error } = await client.from('joint_posts').delete()
            .eq('id', button.dataset.delete).eq('author_id', currentUser.id);
          if (error) throw error;
          await renderOwnPosts(target, profile);
          document.dispatchEvent(new Event('joint-posts-updated'));
        } catch (error) {
          alert('Could not delete post: ' + error.message);
          button.disabled = false;
        }
      }));
      target.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', async () => {
        const selectedPost = (items || []).find(item => String(item.id) === String(button.dataset.edit));
        if (!selectedPost) { alert('Could not find this post. Refresh and try again.'); return; }
        const text = prompt('Edit your shared post text:', selectedPost.content || '');
        if (text === null) return;
        if (!text.trim()) { alert('Post text cannot be empty.'); return; }
        button.disabled = true;
        try {
          const client = await getClient();
          const { error } = await client.from('joint_posts').update({
            content: text.trim(), updated_at: new Date().toISOString()
          }).eq('id', button.dataset.edit).eq('author_id', currentUser.id);
          if (error) throw error;
          await renderOwnPosts(target, profile);
          document.dispatchEvent(new Event('joint-posts-updated'));
        } catch (error) {
          alert('Could not update post: ' + error.message);
          button.disabled = false;
        }
      }));
      requestAnimationFrame(() => window.scrollTo({ top: previousY, behavior: 'instant' }));
    } catch (error) {
      console.error('JOINT shared posts load failed:', error);
      target.innerHTML = '<div class="card muted">Could not load your posts: ' + safe(error.message) + '</div>';
    }
  }

  async function uploadAvatar(client, file) {
    if (!file) return remoteProfile?.avatar_url || null;
    if (!/^image\//.test(file.type) || file.size > 3 * 1024 * 1024) {
      throw new Error('Choose an image smaller than 3 MB.');
    }
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${currentUser.id}/${Date.now()}.${extension}`;
    const { error } = await client.storage.from('joint-avatars').upload(path, file, {
      upsert: true, contentType: file.type, cacheControl: '3600'
    });
    if (error) throw error;
    const { data } = client.storage.from('joint-avatars').getPublicUrl(path);
    return data.publicUrl;
  }

  async function uploadPostMedia(client, file) {
    if (!file) return [];
    const isImage = /^image\//.test(file.type);
    const isVideo = /^video\//.test(file.type);
    if (!isImage && !isVideo) throw new Error('Choose an image or video file.');
    const maxBytes = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) throw new Error(isVideo ? 'Choose a video smaller than 50 MB.' : 'Choose an image smaller than 10 MB.');
    const extension = (file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '') || (isVideo ? 'mp4' : 'jpg');
    const path = `${currentUser.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error } = await client.storage.from('joint-post-media').upload(path, file, {
      upsert: false, contentType: file.type, cacheControl: '3600'
    });
    if (error) throw error;
    const { data } = client.storage.from('joint-post-media').getPublicUrl(path);
    return [{ url: data.publicUrl, type: isVideo ? 'video' : 'image', name: file.name }];
  }

  async function initProfilePage() {
    const form = document.getElementById('profile-form');
    const postForm = document.getElementById('joint-post-form');
    const postsTarget = document.getElementById('joint-own-posts');
    let profile;
    try {
      const client = await getClient();
      profile = await loadProfile();
      profileCard(profile);
      renderOwnPosts(postsTarget, profile);
    } catch (error) {
      console.error('JOINT profile load failed:', error);
      const status = document.getElementById('profile-success');
      if (status) {
        status.className = 'settings-status error';
        status.textContent = `Could not load your profile from Supabase: ${error.message}. Check the joint_profiles table columns and RLS policies.`;
        status.style.display = 'block';
      }
      return;
    }

    const editPanel=document.getElementById('profile-edit-panel');
    const editToggle=document.getElementById('toggle-profile-edit');
    const createPanel=document.getElementById('create-post-panel');
    const createToggle=document.getElementById('toggle-create-post');
    if(editPanel && editToggle){
      editPanel.hidden=true;
      editToggle.setAttribute('aria-expanded','false');
      editToggle.addEventListener('click',()=>{
        const opening=editPanel.hidden;
        editPanel.hidden=!opening;
        editToggle.setAttribute('aria-expanded',String(opening));
        editToggle.textContent=opening?'✕ Close profile editor':'✎ Edit profile';
        if(opening){if(createPanel)createPanel.hidden=true;if(createToggle){createToggle.setAttribute('aria-expanded','false');createToggle.textContent='＋ Create a post';}editPanel.scrollIntoView({behavior:'smooth',block:'start'});}
      });
    }
    if(createPanel && createToggle){
      createPanel.hidden=true;
      createToggle.setAttribute('aria-expanded','false');
      createToggle.addEventListener('click',()=>{
        const opening=createPanel.hidden;
        createPanel.hidden=!opening;
        createToggle.setAttribute('aria-expanded',String(opening));
        createToggle.textContent=opening?'✕ Close post editor':'＋ Create a post';
        if(opening){if(editPanel)editPanel.hidden=true;if(editToggle){editToggle.setAttribute('aria-expanded','false');editToggle.textContent='✎ Edit profile';}createPanel.scrollIntoView({behavior:'smooth',block:'start'});}
      });
    }
    if (form) {
      ['profile-name', 'profile-bio'].forEach((id, index) => {
        const input = document.getElementById(id);
        if (input) input.value = [profile.display_name, profile.bio][index] || '';
      });
      const dobInput = document.getElementById('profile-dob');
      if (dobInput) dobInput.value = profile.date_of_birth || '';
      const countryInput = document.getElementById('profile-country');
      const regionInput = document.getElementById('profile-region');
      const genderInput = document.getElementById('profile-gender');
      const interestInput = document.getElementById('profile-interests');
      const interestChips = document.getElementById('profile-interest-chips');
      const interestPicker = document.getElementById('profile-interest-picker');
      const interestAdd = document.getElementById('profile-interest-add');
      const geo = window.JOINT_GEO_DATA || {countries:[],states:{},interests:[]};
      const interestOptions = geo.interests || [];
      const interestLabel = value => {
        const found = interestOptions.find(x => x.value === String(value).toLowerCase() || x.label.toLowerCase() === String(value).toLowerCase());
        return found ? found.value : String(value).toLowerCase();
      };
      const parseInterests = value => {
        if (Array.isArray(value)) return value.map(interestLabel).filter(Boolean);
        let text = String(value || '').trim();
        try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed.map(interestLabel).filter(Boolean); } catch (_) {}
        return text.split(/[,;|]/).map(v => interestLabel(v.trim())).filter(Boolean);
      };
      let chosenInterests = [...new Set(parseInterests(profile.interests))];
      const prefKeys = ['joint_user_preferences_v2'];
      let settings = {};
      try { settings = JSON.parse(localStorage.getItem(prefKeys[0]) || '{}') || {}; } catch (_) {}
      const savedCountry = settings.country || settings.selectedCountry || settings.country_name || '';
      const profileCountry = profile.country || '';
      const countryCode = geo.countries.find(row => row[0] === savedCountry || row[1].toLowerCase() === String(savedCountry).toLowerCase() || row[1].toLowerCase() === String(profileCountry).toLowerCase())?.[0] || '';
      const settingsRegion = settings.state_region || settings.state || settings.region || settings.selectedState || profile.state_region || '';
      const fillProfileCountries = selected => {
        if (!countryInput) return;
        countryInput.replaceChildren(new Option('Select country',''));
        geo.countries.forEach(row => countryInput.add(new Option(row[1],row[0])));
        countryInput.value = selected || '';
      };
      const fillProfileStates = (code, selected) => {
        if (!regionInput) return;
        const rows = geo.states[code] || [];
        regionInput.replaceChildren(new Option(rows.length ? 'Select state / region' : 'State list unavailable for this country',''));
        rows.forEach(name => regionInput.add(new Option(name,name)));
        if (selected && !rows.includes(selected)) regionInput.add(new Option(selected + ' (saved)',selected));
        regionInput.value = selected || '';
      };
      fillProfileCountries(countryCode);
      fillProfileStates(countryCode, settingsRegion);
      const syncLocationToLocal = () => {
        const current = (() => { try { return JSON.parse(localStorage.getItem(prefKeys[0]) || '{}'); } catch (_) { return {}; } })();
        current.country = countryInput.value;
        current.state_region = regionInput.value;
        current.updatedAt = new Date().toISOString();
        try { localStorage.setItem(prefKeys[0], JSON.stringify(current)); } catch (_) {}
      };
      if (countryInput) countryInput.addEventListener('change', () => { fillProfileStates(countryInput.value, ''); syncLocationToLocal(); });
      if (regionInput) regionInput.addEventListener('change', syncLocationToLocal);
      if (genderInput) genderInput.value = profile.gender || '';
      const renderInterests = () => {
        if (interestInput) interestInput.value = JSON.stringify(chosenInterests);
        if (interestChips) interestChips.innerHTML = chosenInterests.map(v => { const item = interestOptions.find(x => x.value === v); return '<span class="choice">' + safe(item ? item.label : v) + '</span>'; }).join('') || '<span class="muted">No interests selected</span>';
        if (interestPicker) interestPicker.innerHTML = interestOptions.map(item => '<label class="choice"><input type="checkbox" value="' + safe(item.value) + '" ' + (chosenInterests.includes(item.value) ? 'checked' : '') + '> ' + safe(item.label) + '</label>').join('');
      };
      renderInterests();
      if (interestAdd && interestPicker) interestAdd.addEventListener('click', () => { interestPicker.hidden = !interestPicker.hidden; });
      if (interestPicker) interestPicker.addEventListener('change', event => {
        if (!event.target.matches('input[type="checkbox"]')) return;
        chosenInterests = Array.from(interestPicker.querySelectorAll('input:checked')).map(input => input.value);
        renderInterests();
      });
      const preview = document.getElementById('profile-picture-preview');
      if (preview && profile.avatar_url) {
        preview.src = profile.avatar_url;
        preview.style.display = 'block';
        const placeholder = document.getElementById('profile-avatar-placeholder');
        if (placeholder) placeholder.style.display = 'none';
      }
      const picture = document.getElementById('profile-picture');
      if (picture) picture.addEventListener('change', () => {
        selectedAvatarFile = picture.files?.[0] || null;
        if (!selectedAvatarFile) return;
        if (!/^image\//.test(selectedAvatarFile.type) || selectedAvatarFile.size > 3 * 1024 * 1024) {
          alert('Choose an image smaller than 3 MB.');
          picture.value = '';
          selectedAvatarFile = null;
          return;
        }
        if (preview) {
          if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
          preview.dataset.objectUrl = URL.createObjectURL(selectedAvatarFile);
          preview.src = preview.dataset.objectUrl;
          preview.style.display = 'block';
          const placeholder = document.getElementById('profile-avatar-placeholder');
          if (placeholder) placeholder.style.display = 'none';
        }
      });

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const status = document.getElementById('profile-success');
        if (button) { button.disabled = true; button.textContent = 'Saving…'; }
        if (status) { status.className = 'success'; status.textContent = ''; status.style.display = ''; }
        try {
          const client = await getClient();
          const avatarUrl = await uploadAvatar(client, selectedAvatarFile);
          const updates = {
            display_name: document.getElementById('profile-name').value.trim(),
            bio: document.getElementById('profile-bio').value.trim(),
            interests: chosenInterests,
            date_of_birth: document.getElementById('profile-dob')?.value || null,
            age: document.getElementById('profile-dob')?.value ? Math.floor((Date.now() - new Date(document.getElementById('profile-dob').value + 'T00:00:00').getTime()) / 31557600000) : null,
            country: geo.countries.find(row => row[0] === countryInput?.value)?.[1] || null,
            state_region: regionInput?.value.trim() || null,
            gender: document.getElementById('profile-gender')?.value || null,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString()
          };
          if (!updates.display_name) throw new Error('Please enter a display name.');
          if (!updates.date_of_birth) throw new Error('Please select your date of birth.');
          if (Number.isNaN(new Date(updates.date_of_birth).getTime()) || new Date(updates.date_of_birth) >= new Date()) throw new Error('Please select a valid date of birth.');
          if (!updates.age || updates.age < 13 || updates.age > 120) throw new Error('You must be between 13 and 120 years old.');
          if (!['male','female'].includes(updates.gender)) throw new Error('Please select Male or Female.');
          if (!Array.isArray(updates.interests) || updates.interests.length < 1) throw new Error('Please select at least one interest.');
          const { data, error } = await client.from('joint_profiles')
            .update(updates).eq('id', currentUser.id).select('*').single();
          if (error) throw error;
          remoteProfile = data;
          syncLocationToLocal();
          profile = fallbackProfile();
          writeLocal(STORAGE.profile, {
            name: profile.display_name, bio: profile.bio,
            interests: profile.interests, age: profile.age, date_of_birth: profile.date_of_birth, avatar: profile.avatar_url
          });
          selectedAvatarFile = null;
          if (picture) picture.value = '';
          profileCard(profile);
          if (preview) {
            if (profile.avatar_url) { preview.src = profile.avatar_url; preview.style.display = 'block'; }
            else { preview.removeAttribute('src'); preview.style.display = 'none'; }
          }
          if (status) {
            status.className = 'success';
            status.textContent = 'Profile saved to your JOINT account. It will load when you sign in on another device.';
            status.style.display = 'block';
          }
          document.dispatchEvent(new CustomEvent('joint-profile-updated', { detail: profile }));
          if(editPanel && editToggle){editPanel.hidden=true;editToggle.setAttribute('aria-expanded','false');editToggle.textContent='✎ Edit profile';}
        } catch (error) {
          console.error('JOINT profile save failed:', error);
          if (status) {
            status.className = 'settings-status error';
            status.textContent = `Could not save your profile: ${error.message}`;
            status.style.display = 'block';
          } else alert(`Could not save your profile: ${error.message}`);
        } finally {
          if (button) { button.disabled = false; button.textContent = 'Save profile'; }
        }
      });
    }

    if (postForm) {
      const postFileInput = document.getElementById('joint-post-file');
      const previewPanel = document.getElementById('joint-post-preview');
      const previewContent = document.getElementById('joint-post-preview-content');
      const previewMeta = document.getElementById('joint-post-preview-meta');
      const removePreviewButton = document.getElementById('joint-post-preview-remove');
      let postPreviewObjectUrl = '';
      const clearPostPreview = (clearInput = false) => {
        if (postPreviewObjectUrl) { URL.revokeObjectURL(postPreviewObjectUrl); postPreviewObjectUrl = ''; }
        if (previewContent) previewContent.replaceChildren();
        if (previewMeta) previewMeta.textContent = '';
        if (previewPanel) previewPanel.hidden = true;
        if (clearInput && postFileInput) postFileInput.value = '';
      };
      if (postFileInput) postFileInput.addEventListener('change', () => {
        clearPostPreview(false);
        const file = postFileInput.files && postFileInput.files[0];
        const message = document.getElementById('joint-post-message');
        if (!file) return;
        const isImage = /^image\//i.test(file.type);
        const isVideo = /^video\//i.test(file.type);
        if (!isImage && !isVideo) {
          if (message) { message.className = 'settings-status error'; message.textContent = 'Choose an image or video file.'; }
          clearPostPreview(true); return;
        }
        const maxBytes = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (file.size > maxBytes) {
          if (message) { message.className = 'settings-status error'; message.textContent = isVideo ? 'Choose a video smaller than 50 MB.' : 'Choose an image smaller than 10 MB.'; }
          clearPostPreview(true); return;
        }
        postPreviewObjectUrl = URL.createObjectURL(file);
        if (previewPanel) previewPanel.hidden = false;
        if (previewMeta) previewMeta.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
        if (previewContent) {
          if (isVideo) {
            const video = document.createElement('video');
            video.className = 'joint-autoplay-video'; video.src = postPreviewObjectUrl; video.preload = 'metadata';
            video.controls = false; video.muted = false; video.loop = false; video.playsInline = true;
            video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', 'true');
            video.setAttribute('aria-label', 'Preview of video before publishing');
            previewContent.appendChild(video);
            video.addEventListener('loadedmetadata', () => {
              if (previewMeta && postPreviewObjectUrl === video.src) {
                const duration = Number.isFinite(video.duration) ? ` · ${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}` : '';
                previewMeta.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB${duration}`;
              }
            }, { once: true });
          } else {
            const image = document.createElement('img'); image.src = postPreviewObjectUrl;
            image.alt = 'Preview of image before publishing'; previewContent.appendChild(image);
          }
        }
        if (message) { message.className = 'muted'; message.textContent = 'Preview your media below before publishing.'; }
      });
      if (removePreviewButton) removePreviewButton.addEventListener('click', () => clearPostPreview(true));
      postForm.addEventListener('submit', async event => {
        event.preventDefault();
        const textInput = document.getElementById('joint-post-text');
        const text = textInput?.value.trim() || '';
        const file = document.getElementById('joint-post-file')?.files?.[0];
        const message = document.getElementById('joint-post-message');
        const button = postForm.querySelector('button[type="submit"]');
        if (!text && !file) {
          if (message) message.textContent = 'Write an update or choose a picture/video before publishing.';
          return;
        }
        if (button) { button.disabled = true; button.textContent = 'Publishing…'; }
        if (message) { message.textContent = ''; message.className = 'muted'; }
        try {
          const client = await getClient();
          if (message) message.textContent = file ? 'Uploading your media…' : 'Publishing your post…';
          const mediaUrls = await uploadPostMedia(client, file);
          const { error } = await client.from('joint_posts').insert({
            author_id: currentUser.id,
            content: text,
            media_urls: mediaUrls,
            visibility: 'public'
          });
          if (error) throw error;
          postForm.reset();
          clearPostPreview(false);
          await renderOwnPosts(postsTarget, profile);
          if (message) {
            message.className = 'success';
            message.textContent = 'Your post was published to JOINT and can be seen by other users allowed by the feed policies.';
          }
          document.dispatchEvent(new Event('joint-posts-updated'));
        } catch (error) {
          console.error('JOINT post publish failed:', error);
          if (message) {
            message.className = 'settings-status error';
            message.textContent = 'Could not publish your post: ' + error.message + '. Check the joint_posts columns and INSERT policy.';
          }
        } finally {
          if (button) { button.disabled = false; button.textContent = 'Publish post'; }
        }
      });
    }
  }

  function initOtherSocialControls() {
    document.querySelectorAll('[data-joint-follow]').forEach(element => {
      const id = element.dataset.jointFollow;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'joint-star';
      button.textContent = follows().includes(id) ? '⭐ Following' : '⭐ Follow';
      button.addEventListener('click', () => {
        const list = follows();
        const index = list.indexOf(id);
        if (index < 0) list.push(id); else list.splice(index, 1);
        writeLocal(STORAGE.follows, list);
        button.textContent = list.includes(id) ? '⭐ Following' : '⭐ Follow';
        document.dispatchEvent(new Event('joint-social-change'));
      });
      element.replaceWith(button);
    });
  }

  async function init() {
    initOtherSocialControls();
    if (document.getElementById('profile-form') || document.getElementById('joint-profile-summary')) {
      await initProfilePage();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.JOINTSocial = {
    posts, follows, keys: STORAGE,
    getCurrentProfile: () => remoteProfile,
    reloadProfile: loadProfile
  };
})();
