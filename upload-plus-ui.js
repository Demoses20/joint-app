/* JOINT professional + upload controls. Keeps the original file inputs and upload logic intact. */
(function () {
  'use strict';
  if (window.__jointUploadPlusUI) return;
  window.__jointUploadPlusUI = true;
  var style = document.createElement('style');
  style.textContent = `
    .joint-upload-plus-wrap{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:8px 0 4px;}
    .joint-upload-plus-button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:52px;min-width:56px;padding:10px 18px;border:1px solid #e1d4ff;border-radius:16px;background:#f1e8ff;color:#5b2bb8;font:800 16px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 2px 0 rgba(76,29,149,.05);touch-action:manipulation;}
    .joint-upload-plus-button:hover{background:#e9dcff;}
    .joint-upload-plus-button:focus-visible{outline:3px solid #8b5cf6;outline-offset:3px;}
    .joint-upload-plus-symbol{font-size:28px;line-height:1;font-weight:500;}
    .joint-upload-plus-filename{font-size:14px;color:#6b6477;overflow-wrap:anywhere;max-width:100%;}
    .joint-upload-plus-original{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;}
  `;
  (document.head || document.documentElement).appendChild(style);

  function labelFor(input) {
    var labels = input.labels ? Array.from(input.labels) : [];
    var label = labels.find(function (item) { return item.textContent.trim(); });
    return (label && label.textContent.trim()) || input.getAttribute('aria-label') || input.name || 'Choose a file';
  }
  function enhance(input) {
    if (!input || input.type !== 'file' || input.dataset.jointPlusUpload === '1') return;
    // Leave camera-only hidden inputs and inputs already inside a custom upload control alone.
    if (input.hasAttribute('capture') && input.getAttribute('aria-label') && /take a new photo/i.test(input.getAttribute('aria-label'))) return;
    if (input.closest('.joint-upload-plus-wrap')) return;
    input.dataset.jointPlusUpload = '1';
    var originalLabel = labelFor(input);
    var wrap = document.createElement('div');
    wrap.className = 'joint-upload-plus-wrap';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'joint-upload-plus-button';
    button.setAttribute('aria-label', originalLabel);
    button.innerHTML = '<span class="joint-upload-plus-symbol" aria-hidden="true">＋</span><span>Add file</span>';
    var filename = document.createElement('span');
    filename.className = 'joint-upload-plus-filename';
    filename.setAttribute('aria-live', 'polite');
    filename.textContent = 'No file selected';
    input.classList.add('joint-upload-plus-original');
    input.setAttribute('tabindex', '-1');
    input.setAttribute('aria-hidden', 'true');
    input.insertAdjacentElement('afterend', wrap);
    wrap.appendChild(button);
    wrap.appendChild(filename);
    // Keep the original input in the form so existing upload and validation handlers still work.
    wrap.appendChild(input);
    button.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var files = input.files;
      if (!files || !files.length) {
        filename.textContent = 'No file selected';
        button.querySelector('span:last-child').textContent = 'Add file';
        return;
      }
      filename.textContent = files.length === 1 ? files[0].name : files.length + ' files selected';
      button.querySelector('span:last-child').textContent = 'Change file';
    });
  }
  function scan(root) {
    if (!root) return;
    if (root.matches && root.matches('input[type="file"]')) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll('input[type="file"]').forEach(enhance);
  }
  function init() {
    scan(document);
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) { if (node.nodeType === 1) scan(node); });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
