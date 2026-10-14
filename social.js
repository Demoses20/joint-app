/* JOINT profile integration.
   Profile details are stored in Supabase; profile pictures use the joint-avatars bucket.
   Posts and follows remain browser-local demo features until their database integration is added.
*/
(() => {
  'use strict';

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
    name: 'JOINT Learner', bio: '', interests: '', avatar: ''
  });
  const posts = () => readLocal(STORAGE.posts, []);
  const follows = () => readLocal(STORAGE.follows, []);
  const safe = value => String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

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
    const title = document.createElement('h2');
    title.textContent = profile.display_name || 'JOINT Learner';
    const bio = document.createElement('p');
    bio.textContent = profile.bio || 'Add a short introduction to your profile.';
    const username = document.createElement('p');
    username.className = 'muted';
    username.textContent = profile.username ? '@' + profile.username : '';
    const stats = document.createElement('p');
    stats.className = 'muted';
    stats.textContent = 'Followers: loading… · Following: loading…';
    stats.id = 'joint-follow-stats';
    details.append(title, bio, username, stats);
    if (profile.interests) {
      const interests = document.createElement('p');
      interests.textContent = 'Interests: ' + profile.interests;
      details.appendChild(interests);
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
      stats.textContent = `Followers: ${followers.count ?? 0} · Following: ${following.count ?? 0}`;
    } catch (error) {
      console.error('JOINT follow counts could not load:', error);
      stats.textContent = 'Followers: unavailable · Following: unavailable';
      stats.title = 'Could not read follow counts. Check the joint_follows SELECT policy.';
    }
  }

  async function renderOwnPosts(target, profile) {
    if (!target) return;
    target.innerHTML = '<div class="card muted">Loading your posts…</div>';
    try {
      const client = await getClient();
      const { data: items, error } = await client.from('joint_posts')
        .select('id, author_id, content, media_urls, created_at, updated_at')
        .eq('author_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
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
        const author = document.createElement('strong');
        author.textContent = profile.display_name || 'JOINT Learner';
        const date = document.createElement('small');
        date.textContent = post.created_at ? new Date(post.created_at).toLocaleString() : '';
        head.append(author, date);
        const body = document.createElement('p');
        body.textContent = post.content || '';
        card.append(head, body);
        (Array.isArray(post.media_urls) ? post.media_urls : []).forEach(media => {
          if (!media || !media.url) return;
          if (media.type === 'video') {
            const video = document.createElement('video');
            video.className = 'joint-post-media'; video.controls = true; video.playsInline = true;
            video.preload = 'metadata'; video.src = media.url; card.appendChild(video);
          } else {
            const image = document.createElement('img');
            image.className = 'joint-post-media'; image.loading = 'lazy'; image.alt = 'Image shared in this post';
            image.src = media.url; card.appendChild(image);
          }
        });
        const tools = document.createElement('div');
        tools.className = 'joint-post-tools';
        const edit = document.createElement('button');
        edit.type = 'button'; edit.dataset.edit = post.id; edit.textContent = '✏️ Edit';
        const remove = document.createElement('button');
        remove.type = 'button'; remove.dataset.delete = post.id; remove.textContent = '🗑️ Delete';
        tools.append(edit, remove);
        card.append(tools);
        target.appendChild(card);
      });
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
        const text = prompt('Edit your shared post text:', post.content || '');
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

    if (form) {
      ['profile-name', 'profile-bio', 'profile-interests'].forEach((id, index) => {
        const input = document.getElementById(id);
        if (input) input.value = [profile.display_name, profile.bio, profile.interests][index] || '';
      });
      const preview = document.getElementById('profile-picture-preview');
      if (preview && profile.avatar_url) {
        preview.src = profile.avatar_url;
        preview.style.display = 'block';
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
          preview.src = URL.createObjectURL(selectedAvatarFile);
          preview.style.display = 'block';
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
            interests: document.getElementById('profile-interests').value.trim(),
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString()
          };
          if (!updates.display_name) throw new Error('Please enter a display name.');
          const { data, error } = await client.from('joint_profiles')
            .update(updates).eq('id', currentUser.id).select('*').single();
          if (error) throw error;
          remoteProfile = data;
          profile = fallbackProfile();
          writeLocal(STORAGE.profile, {
            name: profile.display_name, bio: profile.bio,
            interests: profile.interests, avatar: profile.avatar_url
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
