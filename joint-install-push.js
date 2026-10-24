/* JOINT install-first and push-permission prompts. Home page only. */
(() => {
  'use strict';
  if (location.pathname.split('/').pop() !== 'index.html' && location.pathname !== '/' && location.pathname !== '') return;
  if (!('localStorage' in window)) return;

  const INSTALL_SKIPPED = 'joint_install_prompt_skipped_v1';
  const NOTIFY_SKIPPED = 'joint_push_prompt_skipped_v1';
  let deferredInstallPrompt = null;
  let modal = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isWebView = () => /; wv\)|\bwv\b/i.test(navigator.userAgent) || (/Android/i.test(navigator.userAgent) && /Version\/\d/.test(navigator.userAgent) && !/Chrome\/\d/i.test(navigator.userAgent));
  const browserEligible = () => !isWebView();

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  function makeModal() {
    if (modal) return modal;
    const style = document.createElement('style');
    style.textContent = `
      #joint-onboard-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(20,12,35,.62);display:flex;align-items:flex-end;justify-content:center;padding:14px;font-family:inherit}
      #joint-onboard-card{width:min(100%,480px);background:#fff;color:#242033;border-radius:22px;padding:24px 20px 18px;box-shadow:0 20px 70px #0005;max-height:88vh;overflow:auto}
      #joint-onboard-card .joint-onboard-mark{width:52px;height:52px;display:grid;place-items:center;border-radius:16px;background:#6938d1;color:#fff;font-weight:900;font-size:28px;margin-bottom:14px}
      #joint-onboard-card h2{margin:0 0 9px;font-size:1.35rem;line-height:1.3;color:#242033}
      #joint-onboard-card p{margin:0 0 16px;line-height:1.65;color:#625b70}
      #joint-onboard-card .joint-onboard-primary,#joint-onboard-card .joint-onboard-secondary{width:100%;border:0;border-radius:12px;padding:13px 16px;font-weight:800;font-size:1rem;margin-top:9px}
      #joint-onboard-card .joint-onboard-primary{background:#6938d1;color:white}
      #joint-onboard-card .joint-onboard-secondary{background:#f0e8ff;color:#5424b5}
      #joint-onboard-card .joint-onboard-help{font-size:.88rem;background:#f8f5ff;border-radius:12px;padding:12px;margin:10px 0 4px}
      #joint-onboard-card .joint-onboard-close{float:right;border:0;background:transparent;color:#6e667b;font-size:1.5rem;padding:0 4px}
    `;
    document.head.appendChild(style);
    modal = document.createElement('div');
    modal.id = 'joint-onboard-backdrop';
    modal.hidden = true;
    modal.innerHTML = `<section id="joint-onboard-card" role="dialog" aria-modal="true" aria-labelledby="joint-onboard-title"><button type="button" class="joint-onboard-close" aria-label="Close">×</button><div class="joint-onboard-mark" aria-hidden="true">J</div><h2 id="joint-onboard-title"></h2><p id="joint-onboard-copy"></p><div id="joint-onboard-help" class="joint-onboard-help" hidden></div><button type="button" id="joint-onboard-primary" class="joint-onboard-primary"></button><button type="button" id="joint-onboard-secondary" class="joint-onboard-secondary"></button></section>`;
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
    const p = el.querySelector('#joint-onboard-primary'); p.textContent = primary; p.onclick = onPrimary;
    const s = el.querySelector('#joint-onboard-secondary'); s.textContent = secondary; s.hidden = !secondary; s.onclick = onSecondary || closeModal;
    el.hidden = false;
  }
  function nextNotificationPrompt() {
    if (!browserEligible() || Notification.permission === 'granted' || localStorage.getItem(NOTIFY_SKIPPED) === 'yes') return;
    showModal({
      title: 'Turn on JOINT notifications',
      copy: 'Get alerts for new followers, messages, mentions, course updates, and important JOINT activity.',
      help: Notification.permission === 'denied' ? 'Notifications are blocked in your browser settings. Open your browser site settings for JOINT and allow notifications, then return here.' : 'Tap Allow on the browser permission request to enable notifications.',
      primary: Notification.permission === 'denied' ? 'How to enable' : 'Allow notifications',
      secondary: 'Not now',
      onPrimary: async () => {
        if (Notification.permission === 'denied') {
          closeModal();
          showModal({title:'Enable notifications in browser settings',copy:'Open your browser settings for this JOINT website, change Notifications to Allow, then return to JOINT.',primary:'Done',secondary:'Close',onPrimary:closeModal,onSecondary:closeModal});
          return;
        }
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            if ('serviceWorker' in navigator && location.protocol === 'https:') await navigator.serviceWorker.register('/joint-sw.js');
            closeModal();
            showModal({title:'Notifications allowed',copy:'Your browser permission is enabled. JOINT push delivery still needs the push service to be configured on the server.',primary:'Continue',onPrimary:closeModal});
          } else {
            closeModal();
            if (permission === 'denied') showModal({title:'Notifications are blocked',copy:'You can enable them later from your browser site settings for JOINT.',primary:'OK',onPrimary:closeModal});
          }
        } catch (error) {
          console.warn('JOINT notification permission setup failed:', error);
          closeModal();
          showModal({title:'Could not enable notifications',copy:'Please make sure JOINT is open on HTTPS in a supported browser, then try again.',primary:'OK',onPrimary:closeModal});
        }
      },
      onSecondary: () => { localStorage.setItem(NOTIFY_SKIPPED, 'yes'); closeModal(); }
    });
  }
  async function showInstallPrompt() {
    if (!browserEligible() || isStandalone() || localStorage.getItem(INSTALL_SKIPPED) === 'yes') { nextNotificationPrompt(); return; }
    showModal({
      title: 'Install JOINT on your phone',
      copy: 'Add JOINT to your Home Screen for a quicker, app-like experience. You can install now or skip and continue using the website.',
      help: isIOS() ? 'In Safari, tap Share, then choose “Add to Home Screen”.' : 'If the browser install prompt is unavailable, open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.',
      primary: 'Install JOINT',
      secondary: 'Skip for now',
      onPrimary: async () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          try { await deferredInstallPrompt.userChoice; } catch (_) {}
          deferredInstallPrompt = null;
          localStorage.setItem(INSTALL_SKIPPED, 'yes');
          closeModal();
          setTimeout(nextNotificationPrompt, 350);
        } else {
          closeModal();
          showModal({title:'Install JOINT from your browser',copy:'Use your browser menu to choose “Install app” or “Add to Home screen”. If you do not want to install now, choose Continue to notifications.',help:isIOS()?'In Safari: Share → Add to Home Screen.':'In Chrome: tap ⋮ → Install app or Add to Home screen.',primary:'Continue to notifications',secondary:'Not now',onPrimary:()=>{localStorage.setItem(INSTALL_SKIPPED,'yes');closeModal();setTimeout(nextNotificationPrompt,100)},onSecondary:()=>{localStorage.setItem(INSTALL_SKIPPED,'yes');closeModal();setTimeout(nextNotificationPrompt,100)}});
        }
      },
      onSecondary: () => { localStorage.setItem(INSTALL_SKIPPED, 'yes'); closeModal(); setTimeout(nextNotificationPrompt, 100); }
    });
  }
  window.addEventListener('appinstalled', () => {
    localStorage.setItem(INSTALL_SKIPPED, 'yes');
    closeModal();
    setTimeout(nextNotificationPrompt, 500);
  });
  window.addEventListener('load', () => {
    if (!browserEligible()) return;
    // Register the worker on HTTPS only. The worker is intentionally additive and does not intercept requests.
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/joint-sw.js').catch(err => console.warn('JOINT service worker registration failed:', err));
    }
    setTimeout(showInstallPrompt, 900);
  });
})();
