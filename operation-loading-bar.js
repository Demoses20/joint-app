/* JOINT: button-scoped, text-free operation progress indicator. */
(function () {
  'use strict';
  if (window.__jointOperationBarInstalled) return;
  window.__jointOperationBarInstalled = true;
  var active = null, requestCount = 0, startTimer = 0, finishTimer = 0, stallTimer = 0;
  var actionPattern = /save|publish|upload|send|post|submit|create|update|record|share|reply|message|finish|complete|unpublish/i;

  function isAction(el) {
    if (!el || !el.matches) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.matches('input[type="file"]')) return false;
    var text = ((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.value || '')).replace(/\s+/g, ' ').trim();
    if (!actionPattern.test(text)) return false;
    if (/cancel|clear|preview|download|sign\s*out|log\s*out|search|filter|open|edit\s+this/i.test(text)) return false;
    return el.matches('button, input[type="submit"], input[type="button"], [role="button"]');
  }
  function clearTimers() { clearTimeout(startTimer); clearTimeout(finishTimer); clearTimeout(stallTimer); }
  function removeBar() {
    clearTimers();
    if (active && active.bar && active.bar.parentNode) active.bar.parentNode.removeChild(active.bar);
    if (active && active.button) active.button.removeAttribute('data-joint-operation-active');
    active = null; requestCount = 0;
  }
  function markActivity() {
    if (!active) return;
    active.bar.classList.remove('joint-operation-stalled');
    clearTimeout(stallTimer);
    stallTimer = setTimeout(function () { if (active) active.bar.classList.add('joint-operation-stalled'); }, 15000);
  }
  function begin(button) {
    if (active) removeBar();
    var bar = document.createElement('div');
    bar.className = 'joint-operation-progress';
    bar.setAttribute('aria-hidden', 'true');
    var track = document.createElement('span'); track.className = 'joint-operation-progress-track'; bar.appendChild(track);
    button.insertAdjacentElement('afterend', bar);
    active = { button: button, bar: bar, requestsStarted: false };
    button.setAttribute('data-joint-operation-active', 'true');
    requestCount = 0;
    startTimer = setTimeout(function () { if (active && !active.requestsStarted) removeBar(); }, 2500);
    markActivity();
  }
  function requestStart() {
    if (!active) return;
    clearTimeout(startTimer); clearTimeout(finishTimer);
    active.requestsStarted = true; requestCount++; markActivity();
  }
  function requestEnd() {
    if (!active || !active.requestsStarted) return;
    requestCount = Math.max(0, requestCount - 1); markActivity();
    if (requestCount === 0) finishTimer = setTimeout(removeBar, 350);
  }
  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button, input[type="submit"], input[type="button"], [role="button"]') : null;
    if (!isAction(button)) return;
    begin(button);
  }, true);
  document.addEventListener('submit', function (event) {
    var submitter = event.submitter;
    if (!isAction(submitter)) {
      submitter = event.target.querySelector('button[type="submit"], input[type="submit"]');
    }
    if (isAction(submitter)) begin(submitter);
  }, true);

  if (window.fetch) {
    var originalFetch = window.fetch;
    window.fetch = function () {
      var tracked = !!active; if (tracked) requestStart();
      var result;
      try { result = originalFetch.apply(this, arguments); }
      catch (err) { if (tracked) requestEnd(); throw err; }
      return Promise.resolve(result).then(function (response) { if (tracked) requestEnd(); return response; }, function (err) { if (tracked) requestEnd(); throw err; });
    };
  }
  if (window.XMLHttpRequest) {
    var OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      var xhr = new OriginalXHR(), tracked = false;
      var originalSend = xhr.send;
      xhr.send = function () { tracked = !!active; if (tracked) requestStart(); return originalSend.apply(xhr, arguments); };
      xhr.addEventListener('loadend', function () { if (tracked) { tracked = false; requestEnd(); } });
      return xhr;
    };
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;
    Object.keys(OriginalXHR).forEach(function (key) { try { window.XMLHttpRequest[key] = OriginalXHR[key]; } catch (_) {} });
  }
  var style = document.createElement('style');
  style.textContent = '.joint-operation-progress{display:block;position:relative;width:100%;height:3px;margin:5px 0 8px;overflow:hidden;border-radius:999px;background:#eadfff;z-index:1}.joint-operation-progress-track{position:absolute;inset:0 auto 0 0;width:38%;border-radius:999px;background:#6938d1;animation:joint-operation-progress-move 1.15s ease-in-out infinite alternate;transform-origin:left center}.joint-operation-progress.joint-operation-stalled .joint-operation-progress-track{animation-play-state:paused;opacity:.75}@keyframes joint-operation-progress-move{from{transform:translateX(0) scaleX(.65)}to{transform:translateX(165%) scaleX(1)}}@media(prefers-reduced-motion:reduce){.joint-operation-progress-track{animation-duration:2.5s}}';
  (document.head || document.documentElement).appendChild(style);
})();
