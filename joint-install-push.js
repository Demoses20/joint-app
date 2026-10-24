/* JOINT home-page install + notification onboarding. Additive only. */
(() => {
  'use strict';
  if (location.pathname.split('/').pop() !== 'index.html' && location.pathname !== '/' && location.pathname !== '') return;
  try { localStorage.length; } catch (_) { return; }

  const INSTALL_SKIPPED = 'joint_install_prompt_skipped_v1';
  const NOTIFY_SKIPPED = 'joint_push_prompt_skipped_v1';
  const NOTIFY_COMPLETED = 'joint_push_prompt_completed_v2';
  // Public VAPID key. The matching private key must remain in Supabase Edge Function secrets.
  const JOINT_VAPID_PUBLIC_KEY = 'BMBQcjiEEBb4Te2xyoZYXewv6gNewkGc0DjzoPor_JdElNeqqjHReevVISfR4-uVB4u8KU1V7FRhV9FhYVhOMtw';
  let deferredInstallPrompt = null;
  let modal = null;
  let installPromptReady = false;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isWebView = () => /; wv\)|\bwv\b/i.test(navigator.userAgent) || (/Android/i.test(navigator.userAgent) && /Version\/\d/.test(navigator.userAgent) && !/Chrome\/\d/i.test(navigator.userAgent));
  const browserEligible = () => !isWebView();

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installPromptReady = true;
  });

  function makeModal() {
    if (modal) return modal;
    const style = document.createElement('style');
    style.textContent = `
      #joint-onboard-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(23,15,38,.52);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;font-family:inherit}
      #joint-onboard-backdrop[hidden]{display:none!important}
      #joint-onboard-card{position:relative;display:grid;grid-template-columns:54px minmax(0,1fr);column-gap:14px;align-items:start;width:min(100%,520px);box-sizing:border-box;background:#fff;color:#242033;border:1px solid rgba(105,56,209,.12);border-radius:18px;padding:19px 18px 16px;box-shadow:0 18px 55px rgba(25,12,48,.24);max-height:82vh;overflow:auto}
      #joint-onboard-card .joint-onboard-mark{grid-column:1;grid-row:1 / span 3;width:50px;height:50px;display:grid;place-items:center;border-radius:15px;background:linear-gradient(145deg,#7b45e8,#5424b5);color:#fff;font-weight:900;font-size:26px;box-shadow:0 5px 12px rgba(105,56,209,.2)}
      #joint-onboard-card .joint-onboard-content{grid-column:2;min-width:0;padding-right:24px}
      #joint-onboard-card h2{margin:2px 0 6px;font-size:1.08rem;line-height:1.3;color:#242033;letter-spacing:-.02em}
      #joint-onboard-card p{margin:0 0 8px;line-height:1.45;font-size:.92rem;color:#625b70}
      #joint-onboard-card .joint-onboard-help{font-size:.82rem;background:#f7f3ff;border:1px solid #eee5ff;border-radius:10px;padding:9px 10px;margin:8px 0 0;color:#5c4a78}
      #joint-onboard-card .joint-onboard-actions{grid-column:2;display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      #joint-onboard-card .joint-onboard-primary,#joint-onboard-card .joint-onboard-secondary{flex:1 1 120px;min-height:40px;border:0;border-radius:10px;padding:10px 12px;font-weight:750;font-size:.9rem;cursor:pointer}
      #joint-onboard-card .joint-onboard-primary{background:#6938d1;color:white;box-shadow:0 3px 8px rgba(105,56,209,.16)}
      #joint-onboard-card .joint-onboard-secondary{background:#f0e8ff;color:#5424b5}
      #joint-onboard-card .joint-onboard-close{position:absolute;top:9px;right:10px;border:0;background:#f5f2fa;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;color:#6e667b;font-size:1.2rem;cursor:pointer}
      @media(max-width:380px){#joint-onboard-card{grid-template-columns:42px minmax(0,1fr);gap:10px;padding:15px 13px 13px;border-radius:16px}#joint-onboard-card .joint-onboard-mark{width:40px;height:40px;border-radius:12px;font-size:22px}#joint-onboard-card .joint-onboard-content{padding-right:18px}#joint-onboard-card h2{font-size:1rem}#joint-onboard-card p{font-size:.86rem}#joint-onboard-card .joint-onboard-actions{grid-column:1 / -1}#joint-onboard-card .joint-onboard-primary,#joint-onboard-card .joint-onboard-secondary{font-size:.84rem;padding:9px 8px}}
    `;
    document.head.appendChild(style);
    modal = document.createElement('div');
    modal.id = 'joint-onboard-backdrop';
    modal.hidden = true;
    modal.innerHTML = `<section id="joint-onboard-card" role="dialog" aria-modal="true" aria-labelledby="joint-onboard-title"><button type="button" class="joint-onboard-close" aria-label="Close">×</button><div class="joint-onboard-mark" aria-hidden="true">J</div><div class="joint-onboard-content"><h2 id="joint-onboard-title"></h2><p id="joint-onboard-copy"></p><div id="joint-onboard-help" class="joint-onboard-help" hidden></div></div><div class="joint-onboard-actions"><button type="button" id="joint-onboard-primary" class="joint-onboard-primary"></button><button type="button" id="joint-onboard-secondary" class="joint-onboard-secondary"></button></div></section>`;
    document.body.appendChild(modal);
    modal.querySelector('.joint-onboard-close').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    return modal;
  }
  function closeModal() { if (modal) modal.hidden = true; }
  function showModal({title, copy, help = '', primary, secondary, onPrimary, onSecondary}) {
    const el = makeModal();
    el.querySelector('#joint-onboard-title').textContent = title;
    el.querySelector('#joint-onboard-copy').textContent = copy;
    const h = el.querySelector('#joint-onboard-help'); h.textContent = help; h.hidden = !help;
    const p = el.querySelector('#joint-onboard-primary'); p.textContent = primary; p.onclick = onPrimary || closeModal;
    const s = el.querySelector('#joint-onboard-secondary'); s.textContent = secondary || ''; s.hidden = !secondary; s.onclick = onSecondary || closeModal;
    el.hidden = false;
  }
  function base64UrlToBytes(base64Url) {
    const padding = '='.repeat((4 - base64Url.length % 4) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  let pushRegistrationInProgress = false;
  async function ensurePushSubscription(attempt = 0) {
    if (pushRegistrationInProgress) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    pushRegistrationInProgress = true;
    try {
      // Supabase may still be initializing or restoring the user's login at page load.
      const db = await window.jointSupabaseConnection;
      if (!db) throw new Error('Supabase client is not ready yet.');
      const { data: { user }, error: authError } = await db.auth.getUser();
      if (authError) throw authError;
      if (!user) {
        if (attempt < 5) setTimeout(() => ensurePushSubscription(attempt + 1), 1800);
        return;
      }
      const registration = await navigator.serviceWorker.register('/joint-sw.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(JOINT_VAPID_PUBLIC_KEY)
        });
      }
      const payload = subscription.toJSON();
      const { error } = await db.from('joint_push_subscriptions').upsert({
        user_id: user.id,
        endpoint: payload.endpoint,
        subscription: payload,
        user_agent: navigator.userAgent,
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' });
      if (error) throw error;
      localStorage.setItem('joint_push_subscription_saved_v1', 'yes');
      console.info('JOINT push subscription saved.');
    } catch (error) {
      console.warn('JOINT push subscription setup failed:', error?.message || error);
      // Retry transient startup/session timing issues; do not loop indefinitely.
      if (attempt < 5) setTimeout(() => ensurePushSubscription(attempt + 1), 2200);
    } finally {
      pushRegistrationInProgress = false;
    }
  }

  function nextNotificationPrompt() {
    if (!browserEligible() || !('Notification' in window) || Notification.permission === 'granted' ||
        localStorage.getItem(NOTIFY_SKIPPED) === 'yes' || localStorage.getItem(NOTIFY_COMPLETED) === 'yes') return;
    showModal({
      title: 'Enable JOINT alerts',
      copy: 'Get useful alerts for messages, followers, mentions and learning updates.',
      help: Notification.permission === 'denied' ? 'Notifications are blocked. Change JOINT site permissions in your browser settings.' : 'Choose Allow when your browser asks for permission.',
      primary: Notification.permission === 'denied' ? 'View instructions' : 'Allow notifications',
      secondary: 'Not now',
      onPrimary: async () => {
        if (Notification.permission === 'denied') {
          showModal({title:'Allow notifications in settings',copy:'Open your browser site settings for JOINT, set Notifications to Allow, then return here.',primary:'Close',onPrimary:closeModal});
          return;
        }
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            localStorage.setItem(NOTIFY_COMPLETED, 'yes');
            localStorage.removeItem(NOTIFY_SKIPPED);
            await ensurePushSubscription();
            if ('serviceWorker' in navigator && location.protocol === 'https:') {
              try { await navigator.serviceWorker.register('/joint-sw.js'); } catch (err) { console.warn('JOINT service worker registration failed:', err); }
            }
            closeModal(); // Do not leave a success card on screen.
          } else {
            closeModal();
            if (permission === 'denied') {
              showModal({title:'Notifications are blocked',copy:'You can enable them later in your browser site settings for JOINT.',primary:'Close',onPrimary:closeModal});
            } else {
              localStorage.setItem(NOTIFY_SKIPPED, 'yes');
            }
          }
        } catch (error) {
          console.warn('JOINT notification permission setup failed:', error);
          closeModal();
        }
      },
      onSecondary: () => { localStorage.setItem(NOTIFY_SKIPPED, 'yes'); closeModal(); }
    });
  }
  async function showInstallPrompt() {
    if (!browserEligible() || isStandalone() || localStorage.getItem(INSTALL_SKIPPED) === 'yes') { nextNotificationPrompt(); return; }
    showModal({
      title: 'Install JOINT',
      copy: 'Add JOINT to your Home Screen for quick, app-like access.',
      help: isIOS() ? 'In Safari, tap Share → Add to Home Screen.' : 'If no install prompt opens, use Chrome ⋮ → Install app or Add to Home screen.',
      primary: 'Install',
      secondary: 'Skip',
      onPrimary: async () => {
        // beforeinstallprompt is only available when the browser considers the site installable.
        if (deferredInstallPrompt) {
          const installEvent = deferredInstallPrompt;
          deferredInstallPrompt = null;
          try {
            await installEvent.prompt();
            const choice = await installEvent.userChoice;
            if (choice && choice.outcome === 'accepted') {
              localStorage.setItem(INSTALL_SKIPPED, 'yes');
              closeModal();
              setTimeout(nextNotificationPrompt, 250);
              return;
            }
            // User dismissed the native prompt: keep the page usable and let them try later.
            closeModal();
            return;
          } catch (err) {
            console.warn('JOINT install prompt failed:', err);
          }
        }
        // No native prompt available: explain the browser's manual install path.
        showModal({
          title:'Install from your browser menu',
          copy:'Your browser has not provided an automatic install prompt for this visit.',
          help:isIOS() ? 'Safari: Share → Add to Home Screen.' : 'Chrome: tap ⋮ and choose Install app or Add to Home screen. If the option is missing, update the browser and try again.',
          primary:'Continue to alerts',
          secondary:'Close',
          onPrimary:()=>{localStorage.setItem(INSTALL_SKIPPED,'yes');closeModal();setTimeout(nextNotificationPrompt,150)},
          onSecondary:closeModal
        });
      },
      onSecondary: () => { localStorage.setItem(INSTALL_SKIPPED, 'yes'); closeModal(); setTimeout(nextNotificationPrompt, 150); }
    });
  }
  window.addEventListener('appinstalled', () => {
    localStorage.setItem(INSTALL_SKIPPED, 'yes');
    closeModal();
    setTimeout(nextNotificationPrompt, 250);
  });
  window.addEventListener('focus', () => { if ('Notification' in window && Notification.permission === 'granted') ensurePushSubscription(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && 'Notification' in window && Notification.permission === 'granted') ensurePushSubscription(); });

  window.addEventListener('load', () => {
    if (!browserEligible()) return;
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/joint-sw.js').catch(err => console.warn('JOINT service worker registration failed:', err));
    }
    // If permission was granted in an earlier visit, register the device without showing another prompt.
    if ('Notification' in window && Notification.permission === 'granted') ensurePushSubscription();
    // Give Chrome time to dispatch beforeinstallprompt before presenting the install card.
    setTimeout(showInstallPrompt, 1400);
  });
})();
