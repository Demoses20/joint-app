(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const params = new URLSearchParams(location.search);
  const memberId = params.get('id');
  let client, me, profile;
  const compact = n => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n); };
  function status(text) { const el = $('mp-status'); if (el) el.textContent = text || ''; }
  function initials(name) { return String(name || 'J').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'J'; }
  function profileUrl(id) { return 'member-profile.html?id=' + encodeURIComponent(id); }
  function parseMedia(value) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = [value]; } }
    if (!Array.isArray(value)) value = value ? [value] : [];
    return value.map(item => {
      if (typeof item === 'string') return { url: item, type: '' };
      if (!item || typeof item !== 'object') return null;
      return { url: item.url || item.publicUrl || item.public_url || item.src || item.path || item.href || '', type: String(item.type || item.mime_type || item.contentType || item.mimetype || ''), name: String(item.name || item.filename || '') };
    }).filter(item => item && item.url);
  }
  function mediaUrl(item) {
    const url = String(item.url || '').trim();
    if (!url) return '';
    if (/^(https?:|data:image\/|blob:|\/\/)/i.test(url)) return url;
    try {
      let path = url.replace(/^\/+/, '').replace(/^joint-post-media\//, '');
      return client.storage.from('joint-post-media').getPublicUrl(path).data?.publicUrl || url;
    } catch (_) { return url; }
  }
  function isVideo(item, url) { return /video/i.test(item.type) || /\.(mp4|webm|ogg|mov|m4v)(?:[?#].*)?$/i.test(url) || /\.(mp4|webm|ogg|mov|m4v)$/i.test(item.name); }
  function renderProfile() {
    const p = profile;
    const avatar = p.avatar_url ? '<img class="mp-avatar" src="' + esc(p.avatar_url) + '" alt="' + esc(p.display_name || 'Member') + ' profile picture">' : '<div class="mp-avatar">' + esc(initials(p.display_name)) + '</div>';
    $('mp-hero').innerHTML = '<div class="mp-identity">' + avatar + '<div class="mp-details"><h1>' + esc(p.display_name || 'JOINT member') + '</h1><p class="mp-meta">' + esc(p.username ? '@' + p.username + ' · ' : '') + esc(p.account_type || 'Member') + '</p></div></div>';
    $('mp-bio').textContent = p.bio || 'No introduction has been added yet.';
    if (p.interests) $('mp-interests').textContent = 'Interests: ' + p.interests;
    $('mp-actions').innerHTML = p.id === me.id ? '<a class="mp-button mp-primary" href="profile.html">✎ Edit profile</a><a class="mp-button mp-secondary" href="profile.html#joint-post-form">＋ Create a post</a>' : '<a class="mp-button mp-primary" href="conversation.html?user=' + encodeURIComponent(p.id) + '">✉ Message ' + esc(p.display_name || 'member') + '</a>';
  }
  async function load() {
    if (!memberId) { status('This profile link is missing its member ID.'); return; }
    try {
      client = await window.jointSupabaseConnection;
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      me = auth?.user;
      if (!me) { location.replace('auth.html?next=' + encodeURIComponent('member-profile.html?id=' + memberId)); return; }
      const { data: p, error } = await client.from('joint_profiles').select('id,username,display_name,bio,interests,avatar_url,account_type').eq('id', memberId).maybeSingle();
      if (error) throw error;
      if (!p) throw new Error('This member profile could not be found or is not visible.');
      profile = p; renderProfile();
      const [followers, following, posts] = await Promise.all([
        client.from('joint_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_user_id', memberId),
        client.from('joint_follows').select('followed_user_id', { count: 'exact', head: true }).eq('follower_id', memberId),
        client.from('joint_posts').select('id,author_id,content,media_urls,created_at').eq('author_id', memberId).order('created_at', { ascending: false }).limit(200)
      ]);
      if (followers.error) throw followers.error; if (following.error) throw following.error; if (posts.error) throw posts.error;
      $('mp-stats').innerHTML = '<div class="mp-stat"><strong>' + Number(followers.count || 0).toLocaleString() + '</strong><span>Followers</span></div><div class="mp-stat"><strong>' + Number(following.count || 0).toLocaleString() + '</strong><span>Following</span></div><div class="mp-stat"><strong>' + (posts.data || []).length.toLocaleString() + '</strong><span>Posts</span></div>';
      $('mp-post-heading').textContent = 'Posts & community activity';
      await renderPosts(posts.data || []); status('');
    } catch (error) {
      console.error('Member profile load failed:', error);
      $('mp-hero').innerHTML = '<p class="mp-status">Could not load this profile. Please refresh and try again.</p>';
      status(error.message || 'Profile unavailable. Check Supabase profile, post and follow read policies.');
    }
  }
  async function renderPosts(posts) {
    const root = $('mp-posts'); root.replaceChildren();
    if (!posts.length) { root.innerHTML = '<div class="mp-empty"><strong>No posts yet</strong><p>When this member shares an update, it will appear here.</p></div>'; return; }
    for (const post of posts) {
      const card = document.createElement('article'); card.className = 'mp-post'; card.dataset.postId = post.id;
      const head = document.createElement('div'); head.className = 'mp-post-head';
      const authorLink = document.createElement('a'); authorLink.className = 'mp-post-author'; authorLink.href = profileUrl(profile.id); authorLink.textContent = profile.display_name || 'JOINT member';
      const avatar = document.createElement('a'); avatar.className = 'mp-post-avatar'; avatar.href = profileUrl(profile.id);
      if (profile.avatar_url) { const img = document.createElement('img'); img.src = profile.avatar_url; img.alt = ''; avatar.append(img); } else avatar.textContent = initials(profile.display_name);
      const identity = document.createElement('div'); identity.className = 'mp-post-identity'; identity.append(authorLink);
      const time = document.createElement('time'); time.textContent = post.created_at ? new Date(post.created_at).toLocaleString() : ''; identity.append(time); head.append(avatar, identity); card.append(head);
      if (post.content) { const body = document.createElement('p'); body.className = 'mp-post-text'; body.textContent = post.content; card.append(body); }
      parseMedia(post.media_urls).forEach(item => {
        const url = mediaUrl(item); if (!url) return;
        let media;
        if (isVideo(item, url)) { media = document.createElement('video'); media.controls = true; media.playsInline = true; media.preload = 'metadata'; }
        else { media = document.createElement('img'); media.loading = 'lazy'; media.alt = 'Photo shared in this post'; }
        media.className = 'mp-media'; media.src = url;
        media.onerror = () => { const err = document.createElement('p'); err.className = 'mp-media-error'; err.textContent = 'This media could not be displayed. It may be private or unavailable.'; media.replaceWith(err); };
        card.append(media);
      });
      const actions = document.createElement('div'); actions.className = 'actions mp-post-actions';
      const makeAction = (icon, label, count = '0') => { const button = document.createElement('button'); button.type = 'button'; button.className = 'action'; button.title = label; button.setAttribute('aria-label', label); const glyph = document.createElement('span'); glyph.className = 'action-icon'; glyph.setAttribute('aria-hidden', 'true'); const svgStart = '<svg xmlns="http://www.w3.org/2000/svg" width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;width:27px;height:27px;flex:0 0 27px;">'; if (icon === 'bookmark') { glyph.innerHTML = svgStart + '<path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21z"/></svg>'; } else if (icon === 'views') { glyph.innerHTML = svgStart + '<path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>'; } else if (icon === 'share') { glyph.innerHTML = svgStart + '<path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>'; } else { glyph.textContent = icon; } const badge = document.createElement('span'); badge.className = 'action-count'; badge.textContent = count; button.append(glyph, badge); actions.append(button); return button; };
      const likeBtn = makeAction('❤️', 'Like post', '…');
      const commentBtn = makeAction('💬', 'Show comments', '…');
      const shareBtn = makeAction('share', 'Share post', '0');
      const saveBtn = makeAction('bookmark', 'Save post', '0');
      const viewsBtn = makeAction('views', 'Unique views', '0'); viewsBtn.disabled = true;
      const followBtn = makeAction('✦', 'Follow creator', profile.id === me.id ? 'On' : 'Follow'); if (profile.id === me.id) followBtn.disabled = true;
      actions.append(); card.append(actions);
      const commentPanel = document.createElement('section'); commentPanel.className = 'mp-comment-panel'; commentPanel.hidden = true;
      const commentList = document.createElement('div'); commentList.className = 'mp-comment-list';
      const commentForm = document.createElement('form'); commentForm.className = 'mp-comment-form';
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 1000; input.placeholder = 'Write a comment…'; input.setAttribute('aria-label', 'Write a comment'); input.required = true;
      const send = document.createElement('button'); send.type = 'submit'; send.textContent = 'Send'; commentForm.append(input, send); commentPanel.append(commentList, commentForm); card.append(commentPanel); root.append(card);
      async function refreshCounts() {
        const [likes, comments, mine, saves, mySave, follows, myFollow] = await Promise.all([
          client.from('joint_likes').select('id', { count: 'exact', head: true }).eq('post_id', post.id),
          client.from('joint_comments').select('id', { count: 'exact', head: true }).eq('post_id', post.id),
          client.from('joint_likes').select('id').eq('post_id', post.id).eq('user_id', me.id).maybeSingle(),
          client.from('joint_saves').select('id', { count: 'exact', head: true }).eq('post_id', post.id),
          client.from('joint_saves').select('id').eq('post_id', post.id).eq('user_id', me.id).maybeSingle(),
          client.from('joint_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_user_id', profile.id),
          client.from('joint_follows').select('follower_id').eq('follower_id', me.id).eq('followed_user_id', profile.id).maybeSingle()
        ]);
        likeBtn.querySelector('.action-icon').textContent = '❤️'; likeBtn.querySelector('.action-count').textContent = compact(likes.count || 0); likeBtn.title = mine.data ? 'Unlike post' : 'Like post'; likeBtn.setAttribute('aria-label', likeBtn.title);
        likeBtn.classList.toggle('selected', !!mine.data); commentBtn.querySelector('.action-count').textContent = compact(comments.count || 0); commentBtn.title = 'Show comments';
        saveBtn.querySelector('.action-count').textContent = compact(saves.count || 0); saveBtn.classList.toggle('selected', !!mySave.data); saveBtn.title = mySave.data ? 'Remove saved post' : 'Save post';
        followBtn.querySelector('.action-count').textContent = profile.id === me.id ? 'On' : (myFollow.data ? 'On' : 'Follow'); followBtn.classList.toggle('selected', !!myFollow.data); followBtn.title = myFollow.data ? 'Unfollow creator' : 'Follow creator';
      }
      likeBtn.addEventListener('click', async () => {
        likeBtn.disabled = true;
        try { const { data: existing, error } = await client.from('joint_likes').select('id').eq('post_id', post.id).eq('user_id', me.id).maybeSingle(); if (error) throw error;
          const result = existing ? await client.from('joint_likes').delete().eq('id', existing.id) : await client.from('joint_likes').insert({ post_id: post.id, user_id: me.id }); if (result.error) throw result.error; await refreshCounts();
        } catch (e) { alert('Could not update your like: ' + e.message); } finally { likeBtn.disabled = false; }
      });
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try { const { data: existing, error } = await client.from('joint_saves').select('id').eq('post_id', post.id).eq('user_id', me.id).maybeSingle(); if (error) throw error; const result = existing ? await client.from('joint_saves').delete().eq('id', existing.id) : await client.from('joint_saves').insert({ post_id: post.id, user_id: me.id }); if (result.error) throw result.error; await refreshCounts(); }
        catch (e) { alert('Could not update saved post: ' + e.message); } finally { saveBtn.disabled = false; }
      });
      followBtn.addEventListener('click', async () => {
        if (profile.id === me.id) return;
        followBtn.disabled = true;
        try { const { data: existing, error } = await client.from('joint_follows').select('follower_id').eq('follower_id', me.id).eq('followed_user_id', profile.id).maybeSingle(); if (error) throw error; const result = existing ? await client.from('joint_follows').delete().eq('follower_id', me.id).eq('followed_user_id', profile.id) : await client.from('joint_follows').insert({ follower_id: me.id, followed_user_id: profile.id }); if (result.error) throw result.error; await refreshCounts(); }
        catch (e) { alert('Could not update follow: ' + e.message); } finally { followBtn.disabled = false; }
      });
      async function loadComments() {
        commentList.innerHTML = '<p class="mp-muted">Loading comments…</p>';
        try {
          const { data, error } = await client.from('joint_comments').select('id,user_id,content,created_at,parent_comment_id').eq('post_id', post.id).order('created_at', { ascending: true }); if (error) throw error;
          commentList.replaceChildren();
          if (!data?.length) { const empty = document.createElement('p'); empty.className = 'mp-muted'; empty.textContent = 'No comments yet. Start the conversation.'; commentList.append(empty); return; }
          const ids = [...new Set(data.map(c => c.user_id).filter(Boolean))]; let names = {};
          if (ids.length) { const res = await client.from('joint_profiles').select('id,display_name,avatar_url').in('id', ids); if (!res.error) (res.data || []).forEach(p => names[p.id] = p); }
          const byParent = new Map(); data.forEach(c => { const key = c.parent_comment_id || null; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(c); });
          const renderComment = (c, depth = 0, container = commentList) => { const person = names[c.user_id] || {}; const display = person.display_name || 'JOINT member'; const item = document.createElement('div'); item.className = 'mp-comment'; item.style.cssText = `margin:0;background:${depth===0?'#f7f4fc':depth===1?'#eee7fb':'#e5dcf7'};border:1px solid ${depth===0?'#eee7f5':'#d9c9f1'};border-radius:12px;padding:10px`; const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:9px'; const avatar = document.createElement('a'); avatar.href = profileUrl(c.user_id); avatar.style.cssText = 'width:34px;height:34px;flex:0 0 34px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#eee5ff;color:#5424b5;text-decoration:none;font-size:.78rem;font-weight:800'; avatar.textContent = initials(display); if (person.avatar_url) { const img = document.createElement('img'); img.src = person.avatar_url; img.alt = display + ' profile picture'; img.style.cssText = 'width:100%;height:100%;object-fit:cover'; img.onerror = () => { img.remove(); avatar.textContent = initials(display); }; avatar.textContent = ''; avatar.append(img); } const who = document.createElement('a'); who.href = profileUrl(c.user_id); who.textContent = display; who.style.cssText = 'font-weight:800;color:inherit;text-decoration:none'; head.append(avatar, who); const text = document.createElement('p'); text.textContent = c.content || ''; text.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0'; const date = document.createElement('small'); date.textContent = c.created_at ? new Date(c.created_at).toLocaleString() : ''; item.append(head, text, date); const reply = document.createElement('button'); reply.type = 'button'; reply.textContent = 'Reply'; reply.style.cssText = 'border:0;background:transparent;color:#5424b5;font-weight:800;padding:5px 0'; const replyForm = document.createElement('form'); replyForm.hidden = true; replyForm.className = 'mp-comment-form'; const replyInput = document.createElement('input'); replyInput.type = 'text'; replyInput.maxLength = 1000; replyInput.required = true; replyInput.placeholder = 'Reply to ' + display + '…'; const replySend = document.createElement('button'); replySend.type = 'submit'; replySend.textContent = 'Reply'; replyForm.append(replyInput, replySend); reply.onclick = () => { replyForm.hidden = !replyForm.hidden; if (!replyForm.hidden) replyInput.focus(); }; replyForm.addEventListener('submit', async event => { event.preventDefault(); const content = replyInput.value.trim(); if (!content) return; replySend.disabled = true; try { const { error } = await client.from('joint_comments').insert({ post_id: post.id, user_id: me.id, content, parent_comment_id: c.id }); if (error) throw error; await loadComments(); await refreshCounts(); } catch (e) { alert('Could not publish your reply: ' + e.message); } finally { replySend.disabled = false; } }); item.append(reply, replyForm); container.append(item); const children = byParent.get(c.id) || []; if (!children.length) return; const replyArea = document.createElement('div'); replyArea.style.cssText = `display:grid;gap:7px;margin:7px 0 0 ${Math.min(depth+1,4)*10}px;padding-left:9px;border-left:3px solid ${depth===0?'#d7c4fb':'#bda5e9'}`; item.append(replyArea); let visible = 0; const more = document.createElement('button'); more.type='button'; more.textContent='View replies ('+children.length+')'; more.style.cssText='justify-self:start;border:0;border-radius:999px;background:#eee5ff;color:#5424b5;padding:5px 10px;font-size:.82rem;font-weight:800;cursor:pointer'; const showNext=()=>{children.slice(visible,visible+5).forEach(child=>renderComment(child,depth+1,replyArea));visible=Math.min(visible+5,children.length);if(visible<children.length)more.textContent='View more replies ('+(children.length-visible)+' remaining)';else more.remove()};more.addEventListener('click',showNext);item.append(more); };
          (byParent.get(null) || []).forEach(c => renderComment(c, 0, commentList));
        } catch (e) { commentList.innerHTML = ''; const msg = document.createElement('p'); msg.className = 'mp-muted'; msg.textContent = 'Comments could not be loaded: ' + e.message; commentList.append(msg); }
      }
      commentBtn.addEventListener('click', async () => { commentPanel.hidden = !commentPanel.hidden; if (!commentPanel.hidden) { await loadComments(); input.focus(); } });
      commentForm.addEventListener('submit', async event => { event.preventDefault(); const content = input.value.trim(); if (!content) return; send.disabled = true;
        try { const { error } = await client.from('joint_comments').insert({ post_id: post.id, user_id: me.id, content, parent_comment_id: null }); if (error) throw error; input.value = ''; await loadComments(); await refreshCounts(); }
        catch (e) { alert('Could not publish your comment: ' + e.message); } finally { send.disabled = false; }
      });
      shareBtn.addEventListener('click', async () => { const url = new URL(profileUrl(profile.id), location.href); url.searchParams.set('post', post.id); try { if (navigator.share) await navigator.share({ title: 'JOINT post', text: (profile.display_name || 'JOINT member') + ' on JOINT', url: url.href }); else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url.href); alert('Post link copied.'); } else prompt('Copy this post link:', url.href); } catch (e) { if (e.name !== 'AbortError') alert('Could not share this post.'); } });
      await refreshCounts().catch(e => console.warn('Post interactions unavailable:', e));
    }
  }
  load();
})();
