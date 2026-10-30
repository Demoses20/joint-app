
document.addEventListener('DOMContentLoaded', async () => {
  // Standardize the account navigation on every authenticated page.
  // Keep page-specific links in the markup for compatibility, but ensure these
  // four account destinations always exist in the same order.
  const accountNavItems = [
    ['my-learning.html', 'My Learning'],
    ['profile.html', 'Profile'],
    ['settings.html', 'Settings'],
    ['notifications.html', 'Notifications']
  ];
  document.querySelectorAll('.main-nav').forEach((nav) => {
    accountNavItems.forEach(([href, label]) => {
      let link = Array.from(nav.querySelectorAll('a')).find((item) =>
        (item.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop() === href
      );
      if (!link) {
        link = document.createElement('a');
        link.href = href;
        link.textContent = label;
        nav.appendChild(link);
      }
      link.textContent = label;
      link.style.removeProperty('display');
      const currentPage = window.location.pathname.split('/').pop() || 'index.html';
      if (currentPage === href) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });
    // Put the four account links first and consistently ordered.
    accountNavItems.forEach(([href]) => {
      const link = Array.from(nav.querySelectorAll('a')).find((item) =>
        (item.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop() === href
      );
      if (link) nav.appendChild(link);
    });
  });

  // Keep bottom navigation intact; simplify only the top navigation across app pages.
  const topNavStyle = document.createElement('style');
  topNavStyle.textContent = '.main-nav a:not([href$="my-learning.html"]):not([href$="profile.html"]):not([href$="notifications.html"]):not([href$="settings.html"]) { display:none !important; } .main-nav { gap:8px; overflow-x:auto; scrollbar-width:thin; } .main-nav a[href$="my-learning.html"], .main-nav a[href$="profile.html"], .main-nav a[href$="notifications.html"], .main-nav a[href$="settings.html"] { display:inline-flex !important; white-space:nowrap; flex:0 0 auto; }';
  document.head.appendChild(topNavStyle);

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

  // JOINT Live: add a prominent entry point beside the account avatar on every authenticated page.
  document.querySelectorAll('.top-actions').forEach((actions) => {
    if (!actions.querySelector('.joint-live-launch')) {
      const liveLink = document.createElement('a');
      liveLink.className = 'joint-live-launch';
      liveLink.href = 'live.html';
      liveLink.setAttribute('aria-label', 'Open JOINT Live');
      liveLink.title = 'JOINT Live';
      liveLink.innerHTML = '<span class="joint-live-launch-dot" aria-hidden="true"></span><span class="joint-live-launch-label">LIVE</span>';
      actions.insertBefore(liveLink, actions.querySelector('.avatar') || actions.firstChild);
    }
  });
  if (!document.getElementById('joint-live-launch-styles')) {
    const liveStyle = document.createElement('style');
    liveStyle.id = 'joint-live-launch-styles';
    liveStyle.textContent = `
      .top-actions{display:flex;align-items:center;gap:12px}
      .joint-live-launch{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:0 12px;border-radius:999px;text-decoration:none!important;color:#fff!important;background:linear-gradient(135deg,#c91532,#f04452);box-shadow:0 3px 11px rgba(211,24,55,.25),inset 0 1px 0 #ffffff55;border:1px solid rgba(255,255,255,.75);font-weight:900;letter-spacing:.45px;transition:transform .18s ease,box-shadow .18s ease;white-space:nowrap}
      .joint-live-launch:hover{transform:translateY(-1px);box-shadow:0 5px 15px rgba(211,24,55,.32)}
      .joint-live-launch:focus-visible{outline:3px solid #ff9ba8;outline-offset:3px}
      .joint-live-launch-dot{display:inline-block;width:8px;height:8px;flex:0 0 8px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.2);animation:joint-live-pulse 1.5s ease-in-out infinite}
      .joint-live-launch-label{font-size:12px;line-height:1}
      @keyframes joint-live-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.78)}}
      @media(max-width:520px){.top-actions{gap:7px}.joint-live-launch{min-height:33px;padding:0 9px;gap:6px}.joint-live-launch-dot{width:7px;height:7px;flex-basis:7px}.joint-live-launch-label{font-size:11px}}
    `;
    document.head.appendChild(liveStyle);
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

/* Load the JOINT inbox badge and notification center on all authenticated pages. */
(function(){
  if (document.querySelector('script[data-joint-notifications-center]')) return;
  const s = document.createElement('script');
  s.src = './notifications-center.js'; s.defer = true; s.dataset.jointNotificationsCenter = 'true';
  document.head.appendChild(s);
})();
