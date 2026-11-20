/* JOINT home-page install + notification onboarding. Additive only. */
(() => {
  'use strict';

  const currentPage = location.pathname.split('/').pop().toLowerCase();
  if (
    !['index.html', 'auth.html'].includes(currentPage) &&
    location.pathname !== '/' &&
    location.pathname !== ''
  ) return;

  try {
    localStorage.length;
  } catch (_) {
    return;
  }

  const INSTALL_SKIPPED = 'joint_install_prompt_skipped_v1';
  const NOTIFY_SKIPPED = 'joint_push_prompt_skipped_v1';
  const NOTIFY_COMPLETED = 'joint_push_prompt_completed_v2';
  const NATIVE_NOTIFY_SKIPPED = 'joint_native_push_prompt_skipped_v1';
  const NATIVE_NOTIFY_COMPLETED = 'joint_native_push_prompt_completed_v1';

  // Public VAPID key. The matching private key must remain in Supabase Edge Function secrets.
  const JOINT_VAPID_PUBLIC_KEY =
    'BMBQcjiEEBb4Te2xyoZYXewv6gNewkGc0DjzoPor_JdElNeqqjHReevVISfR4-uVB4u8KU1V7FRhV9FhYVhOMtw';

  let deferredInstallPrompt = null;
  let modal = null;
  let installPromptReady = false;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream;

  const isWebView = () =>
    /; wv\)|\bwv\b/i.test(navigator.userAgent) ||
    (
      /Android/i.test(navigator.userAgent) &&
      /Version\/\d/.test(navigator.userAgent) &&
      !/Chrome\/\d/i.test(navigator.userAgent)
    );

  // The Android bridge is injected by MainActivity only for trusted JOINT pages.
  // Detect the installed Android app even if WebView's message bridge is not
  // available at the exact instant this script starts.
  const isNativeAndroid = () =>
    /JOINTNativeAndroid/i.test(navigator.userAgent) ||
    !!(
      window.jointNativePush &&
      typeof window.jointNativePush.postMessage === 'function'
    );

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

    modal.innerHTML = `
      <section id="joint-onboard-card" role="dialog"
        aria-modal="true" aria-labelledby="joint-onboard-title">
        <button type="button" class="joint-onboard-close"
          aria-label="Close">×</button>
        <div class="joint-onboard-mark" aria-hidden="true">J</div>
        <div class="joint-onboard-content">
          <h2 id="joint-onboard-title"></h2>
          <p id="joint-onboard-copy"></p>
          <div id="joint-onboard-help"
            class="joint-onboard-help" hidden></div>
        </div>
        <div class="joint-onboard-actions">
          <button type="button" id="joint-onboard-primary"
            class="joint-onboard-primary"></button>
          <button type="button" id="joint-onboard-secondary"
            class="joint-onboard-secondary"></button>
        </div>
      </section>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.joint-onboard-close')
      .addEventListener('click', closeModal);

    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal();
    });

    return modal;
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  function showModal({
    title,
    copy,
    help = '',
    primary,
    secondary,
    onPrimary,
    onSecondary
  }) {
    const el = makeModal();

    el.querySelector('#joint-onboard-title').textContent = title;
    el.querySelector('#joint-onboard-copy').textContent = copy;

    const helpElement = el.querySelector('#joint-onboard-help');
    helpElement.textContent = help;
    helpElement.hidden = !help;

    const primaryButton =
      el.querySelector('#joint-onboard-primary');

    primaryButton.textContent = primary;
    primaryButton.onclick = onPrimary || closeModal;

    const secondaryButton =
      el.querySelector('#joint-onboard-secondary');

    secondaryButton.textContent = secondary || '';
    secondaryButton.hidden = !secondary;
    secondaryButton.onclick = onSecondary || closeModal;

    el.hidden = false;
  }

  function base64UrlToBytes(base64Url) {
    const padding = '='.repeat((4 - base64Url.length % 4) % 4);
    const base64 = (base64Url + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const raw = atob(base64);

    return Uint8Array.from(
      raw,
      character => character.charCodeAt(0)
    );
  }

  // Native Android permission bridge.
  // This requests permission only after the user taps the popup button.
  function requestNativeNotificationPermission() {
    return new Promise(resolve => {
      const bridge = window.jointNativePush;

      if (!bridge || typeof bridge.postMessage !== 'function') {
        resolve(false);
        return;
      }

      let completed = false;

      const finish = granted => {
        if (completed) return;
        completed = true;

        bridge.onmessage = previousHandler || null;
        resolve(granted);
      };

      const previousHandler = bridge.onmessage;

      bridge.onmessage = event => {
        let response;

        try {
          response = JSON.parse(event.data || '{}');
        } catch (_) {
          return;
        }

        if (response.action === 'notificationPermissionResult') {
          finish(response.granted === true);
          return;
        }

        if (typeof previousHandler === 'function') {
          previousHandler.call(bridge, event);
        }
      };

      try {
        bridge.postMessage(
          JSON.stringify({
            action: 'requestPermission'
          })
        );
      } catch (error) {
        console.warn(
          'JOINT native notification request failed:',
          error
        );
        finish(false);
        return;
      }

      setTimeout(() => {
        if (!completed) {
          console.warn('JOINT notification permission request timed out.');
          finish(false);
        }
      }, 30000);
    });
  }


  // Native FCM registration is separate from browser Web Push/VAPID.
  let nativeTokenRegistrationRunning = false;
  let nativeAuthListenerAttached = false;
  function requestNativeFcmToken() {
    return new Promise(resolve => {
      const bridge = window.jointNativePush;
      if (!bridge || typeof bridge.postMessage !== 'function') return resolve(null);
      let done = false;
      const previous = bridge.onmessage;
      const finish = value => {
        if (done) return;
        done = true;
        bridge.onmessage = previous || null;
        resolve(value);
      };
      bridge.onmessage = event => {
        let response;
        try { response = JSON.parse(event.data || '{}'); } catch (_) { return; }
        if (response.action === 'fcmTokenResult') finish(response.granted && response.token ? response.token : null);
        else if (typeof previous === 'function') previous.call(bridge, event);
      };
      try { bridge.postMessage(JSON.stringify({ action: 'getToken' })); }
      catch (_) { finish(null); return; }
      setTimeout(() => finish(null), 12000);
    });
  }

  async function registerNativeFcmToken(attempt = 0) {
    if (nativeTokenRegistrationRunning || !isNativeAndroid()) return;
    nativeTokenRegistrationRunning = true;
    try {
      const token = await requestNativeFcmToken();
      if (!token) return;
      const db = await window.jointSupabaseConnection;
      if (!db) throw new Error('Supabase client is not ready.');
      if (!nativeAuthListenerAttached && db.auth?.onAuthStateChange) {
        nativeAuthListenerAttached = true;
        db.auth.onAuthStateChange((_event, session) => {
          if (session?.user) setTimeout(() => registerNativeFcmToken(), 0);
        });
      }
      const { data: { user }, error: authError } = await db.auth.getUser();
      if (authError) throw authError;
      if (!user) {
        if (attempt < 8) setTimeout(() => registerNativeFcmToken(attempt + 1), 1800);
        return;
      }
      const { error } = await db.rpc('joint_register_fcm_token', {
        p_token: token,
        p_user_agent: navigator.userAgent
      });
      if (error) throw error;
      localStorage.setItem('joint_native_fcm_registered_v1', 'yes');
      console.info('JOINT native FCM token registered.');
    } catch (error) {
      console.warn('JOINT native FCM registration failed:', error?.message || error);
      if (attempt < 5) setTimeout(() => registerNativeFcmToken(attempt + 1), 2500);
    } finally {
      nativeTokenRegistrationRunning = false;
    }
  }

  window.addEventListener('jointNativePushToken', () => registerNativeFcmToken());

  let pushRegistrationInProgress = false;

  async function ensurePushSubscription(attempt = 0) {
    if (pushRegistrationInProgress) return;

    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) return;

    if (
      location.protocol !== 'https:' &&
      location.hostname !== 'localhost'
    ) return;

    pushRegistrationInProgress = true;

    try {
      // Supabase may still be initializing or restoring the user's login.
      const db = await window.jointSupabaseConnection;

      if (!db) {
        throw new Error('Supabase client is not ready yet.');
      }

      const {
        data: { user },
        error: authError
      } = await db.auth.getUser();

      if (authError) throw authError;

      if (!user) {
        if (attempt < 5) {
          setTimeout(
            () => ensurePushSubscription(attempt + 1),
            1800
          );
        }
        return;
      }

      const registration =
        await navigator.serviceWorker.register('/joint-sw.js');

      await navigator.serviceWorker.ready;

      const expectedApplicationServerKey =
        base64UrlToBytes(JOINT_VAPID_PUBLIC_KEY);

      let subscription =
        await registration.pushManager.getSubscription();

      if (subscription) {
        // Replace only this browser's subscription if its VAPID key differs.
        const existingKeyBuffer =
          subscription.options &&
          subscription.options.applicationServerKey;

        const existingKey = existingKeyBuffer
          ? new Uint8Array(existingKeyBuffer)
          : null;

        const keyMatches =
          !!existingKey &&
          existingKey.length === expectedApplicationServerKey.length &&
          existingKey.every(
            (value, index) =>
              value === expectedApplicationServerKey[index]
          );

        if (!keyMatches) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }

      if (!subscription) {
        subscription =
          await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedApplicationServerKey
          });
      }

      const payload = subscription.toJSON();

      const { error } = await db
        .from('joint_push_subscriptions')
        .upsert({
          user_id: user.id,
          endpoint: payload.endpoint,
          subscription: payload,
          user_agent: navigator.userAgent,
          updated_at: new Date().toISOString()
        }, { onConflict: 'endpoint' });

      if (error) throw error;

      localStorage.setItem(
        'joint_push_subscription_saved_v1',
        'yes'
      );

      console.info('JOINT push subscription saved.');

    } catch (error) {
      console.warn(
        'JOINT push subscription setup failed:',
        error?.message || error
      );

      if (attempt < 5) {
        setTimeout(
          () => ensurePushSubscription(attempt + 1),
          2200
        );
      }

    } finally {
      pushRegistrationInProgress = false;
    }
  }

  function nextNotificationPrompt() {
    const nativeAndroid = isNativeAndroid();

    const skippedKey = nativeAndroid ? NATIVE_NOTIFY_SKIPPED : NOTIFY_SKIPPED;
    const completedKey = nativeAndroid ? NATIVE_NOTIFY_COMPLETED : NOTIFY_COMPLETED;

    if (
      (!nativeAndroid && !browserEligible()) ||
      (!nativeAndroid && !('Notification' in window)) ||
      localStorage.getItem(skippedKey) === 'yes' ||
      localStorage.getItem(completedKey) === 'yes'
    ) return;

    const browserDenied =
      !nativeAndroid &&
      Notification.permission === 'denied';

    showModal({
      title: 'Enable JOINT alerts',

      copy:
        'Get useful alerts for messages, followers, mentions and learning updates.',

      help: browserDenied
        ? 'Notifications are blocked. Change JOINT site permissions in your browser settings.'
        : nativeAndroid
          ? 'Choose Allow when Android asks for notification permission.'
          : 'Choose Allow when your browser asks for permission.',

      primary: browserDenied
        ? 'View instructions'
        : 'Allow notifications',

      secondary: 'Not now',

      onPrimary: async () => {
        // Android app: request permission through the native bridge.
        if (nativeAndroid) {
          try {
            const granted =
              await requestNativeNotificationPermission();

            if (granted) {
              await registerNativeFcmToken();
              localStorage.setItem(completedKey, 'yes');
              localStorage.removeItem(skippedKey);
              closeModal();
            } else {
              closeModal();

              showModal({
                title: 'Notifications not enabled',
                copy: 'You can enable JOINT notifications later in your Android app settings.',
                primary: 'Close',
                onPrimary: closeModal
              });
            }
          } catch (error) {
            console.warn(
              'JOINT native notification permission failed:',
              error
            );
            closeModal();
          }

          return;
        }

        // Existing browser notification flow.
        if (Notification.permission === 'denied') {
          showModal({
            title: 'Allow notifications in settings',
            copy: 'Open your browser site settings for JOINT, set Notifications to Allow, then return here.',
            primary: 'Close',
            onPrimary: closeModal
          });
          return;
        }

        try {
          const permission =
            await Notification.requestPermission();

          if (permission === 'granted') {
            localStorage.setItem(completedKey, 'yes');
            localStorage.removeItem(skippedKey);

            await ensurePushSubscription();

            if (
              'serviceWorker' in navigator &&
              location.protocol === 'https:'
            ) {
              try {
                await navigator.serviceWorker.register('/joint-sw.js');
              } catch (error) {
                console.warn(
                  'JOINT service worker registration failed:',
                  error
                );
              }
            }

            closeModal();

          } else {
            closeModal();

            if (permission === 'denied') {
              showModal({
                title: 'Notifications are blocked',
                copy: 'You can enable them later in your browser site settings for JOINT.',
                primary: 'Close',
                onPrimary: closeModal
              });
            } else {
              localStorage.setItem(skippedKey, 'yes');
            }
          }

        } catch (error) {
          console.warn(
            'JOINT notification permission setup failed:',
            error
          );
          closeModal();
        }
      },

      onSecondary: () => {
        localStorage.setItem(skippedKey, 'yes');
        closeModal();
      }
    });
  }

  async function showInstallPrompt() {
    // Native Android app: skip browser installation and show alerts directly.
    if (isNativeAndroid()) {
      nextNotificationPrompt();
      return;
    }

    if (
      !browserEligible() ||
      isStandalone() ||
      localStorage.getItem(INSTALL_SKIPPED) === 'yes'
    ) {
      nextNotificationPrompt();
      return;
    }

    showModal({
      title: 'Install JOINT',

      copy:
        'Add JOINT to your Home Screen for quick, app-like access.',

      help: isIOS()
        ? 'In Safari, tap Share → Add to Home Screen.'
        : 'If no install prompt opens, use Chrome ⋮ → Install app or Add to Home screen.',

      primary: 'Install',
      secondary: 'Skip',

      onPrimary: async () => {
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

            closeModal();
            return;

          } catch (error) {
            console.warn('JOINT install prompt failed:', error);
          }
        }

        showModal({
          title: 'Install from your browser menu',

          copy:
            'Your browser has not provided an automatic install prompt for this visit.',

          help: isIOS()
            ? 'Safari: Share → Add to Home Screen.'
            : 'Chrome: tap ⋮ and choose Install app or Add to Home screen. If the option is missing, update the browser and try again.',

          primary: 'Continue to alerts',
          secondary: 'Close',

          onPrimary: () => {
            localStorage.setItem(INSTALL_SKIPPED, 'yes');
            closeModal();
            setTimeout(nextNotificationPrompt, 150);
          },

          onSecondary: closeModal
        });
      },

      onSecondary: () => {
        localStorage.setItem(INSTALL_SKIPPED, 'yes');
        closeModal();
        setTimeout(nextNotificationPrompt, 150);
      }
    });
  }

  window.addEventListener('appinstalled', () => {
    localStorage.setItem(INSTALL_SKIPPED, 'yes');
    closeModal();
    setTimeout(nextNotificationPrompt, 250);
  });

  window.addEventListener('focus', () => {
    if (
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      ensurePushSubscription();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (
      !document.hidden &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      ensurePushSubscription();
    }
  });

  window.addEventListener('load', () => {
    // Android native app: do not run browser installation or VAPID setup here.
    if (isNativeAndroid()) {
      setTimeout(() => {
        registerNativeFcmToken();
        nextNotificationPrompt();
      }, 1400);
      return;
    }

    if (!browserEligible()) return;

    if (
      'serviceWorker' in navigator &&
      location.protocol === 'https:'
    ) {
      navigator.serviceWorker.register('/joint-sw.js')
        .catch(error =>
          console.warn(
            'JOINT service worker registration failed:',
            error
          )
        );
    }

    // Existing browser push registration remains unchanged.
    if (
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      ensurePushSubscription();
    }

    setTimeout(showInstallPrompt, 1400);
  });
})();
