
document.addEventListener('DOMContentLoaded', async () => {
  // Require a valid JOINT Supabase session before opening app pages.
  // This is a navigation guard, not a replacement for database RLS policies.
  async function loadJointSupabase() {
    if (window.jointSupabaseConnection) return window.jointSupabaseConnection;

    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './supabase.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load JOINT authentication.'));
      document.head.appendChild(script);
    });

    if (!window.jointSupabaseConnection) {
      throw new Error('JOINT Supabase client did not initialize.');
    }
    return window.jointSupabaseConnection;
  }

  let authClient;
  try {
    authClient = await loadJointSupabase();
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;

    if (!data.session) {
      const next = window.location.pathname.split('/').pop() +
        window.location.search + window.location.hash;
      window.location.replace('auth.html?next=' + encodeURIComponent(next || 'index.html'));
      return;
    }
  } catch (error) {
    console.error('JOINT session check failed:', error);
    document.body.innerHTML = '<main style="max-width:560px;margin:12vh auto;padding:24px;font:16px/1.6 Arial,sans-serif"><h1>JOINT could not verify your sign-in</h1><p>Check your internet connection and reload this page. If the problem continues, return to the sign-in page.</p><p><a href="auth.html">Go to JOINT sign in</a></p></main>';
    return;
  }

  // Make the account avatar a link and hydrate it from the signed-in user's Supabase profile.
  document.querySelectorAll('.top-actions .avatar').forEach((avatar) => {
    let profileLink = avatar;
    if (avatar.tagName.toLowerCase() !== 'a') {
      profileLink = document.createElement('a');
      profileLink.className = avatar.className;
      profileLink.innerHTML = avatar.innerHTML;
      for (const attr of avatar.attributes) {
        if (attr.name !== 'class') profileLink.setAttribute(attr.name, attr.value);
      }
      avatar.replaceWith(profileLink);
    }
    profileLink.href = 'profile.html';
    profileLink.title = 'Open your profile';
    profileLink.setAttribute('aria-label', 'Open your profile');
    profileLink.style.cursor = 'pointer';

    try {
      const saved = JSON.parse(localStorage.getItem('joint_profile_demo_v2') || '{}');
      const name = String(saved.name || '').trim();
      if (name) {
        const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
        if (initials) profileLink.textContent = initials;
      }
      if (saved.avatar) {
        profileLink.style.backgroundImage = 'url("' + String(saved.avatar).replace(/"/g, '') + '")';
        profileLink.style.backgroundSize = 'cover';
        profileLink.style.backgroundPosition = 'center';
        profileLink.style.color = 'transparent';
      }
    } catch (_) {
      // Keep the default avatar if browser storage is unavailable.
    }
  });

  // Prefer the authenticated profile stored in Supabase over the local cache.
  try {
    const { data: userResult, error: userError } = await authClient.auth.getUser();
    if (userError) throw userError;
    const user = userResult.user;
    if (user) {
      const { data: profile, error: profileError } = await authClient
        .from('joint_profiles')
        .select('display_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile) {
        const name = String(profile.display_name || '').trim();
        const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
        document.querySelectorAll('.top-actions .avatar').forEach((avatar) => {
          if (initials && !profile.avatar_url) avatar.textContent = initials;
          if (profile.avatar_url) {
            avatar.style.backgroundImage = 'url("' + String(profile.avatar_url).replace(/"/g, '') + '")';
            avatar.style.backgroundSize = 'cover';
            avatar.style.backgroundPosition = 'center';
            avatar.style.color = 'transparent';
          }
          if (name) avatar.title = name + ' — Open your profile';
        });
      }
    }
  } catch (error) {
    // The cached initials remain available if profile lookup is unavailable.
    console.warn('JOINT header profile could not be loaded:', error);
  }

  // Add a visible sign-out control to the existing app header.
  const topActions = document.querySelector('.top-actions');
  if (topActions && !document.getElementById('joint-signout-button')) {
    const signout = document.createElement('button');
    signout.id = 'joint-signout-button';
    signout.type = 'button';
    signout.textContent = 'Sign out';
    signout.style.cssText = 'margin-left:10px;border:1px solid #d8d2e5;border-radius:10px;padding:9px 12px;background:#fff;color:#40345a;font:600 14px Arial,sans-serif;cursor:pointer';
    signout.addEventListener('click', async () => {
      signout.disabled = true;
      signout.textContent = 'Signing out…';
      try {
        const { error } = await authClient.auth.signOut();
        if (error) throw error;
        window.location.replace('auth.html');
      } catch (error) {
        console.error('JOINT sign-out failed:', error);
        signout.disabled = false;
        signout.textContent = 'Sign out';
        alert('Could not sign out. Please try again.');
      }
    });
    topActions.appendChild(signout);
  }


});


/* Load the unread-message badge globally without changing existing navigation behavior. */
(function(){
  if (document.querySelector('script[data-joint-message-notifications]')) return;
  const s = document.createElement('script');
  s.src = './message-notifications.js';
  s.defer = true;
  s.dataset.jointMessageNotifications = 'true';
  document.head.appendChild(s);
})();


/* Show the count of active public meetings on Meetings navigation links. */
(function(){
  const s=document.createElement('script');
  s.src='./meeting-notifications.js';
  s.defer=true;
  document.head.appendChild(s);
})();
