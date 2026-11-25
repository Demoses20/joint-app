(() => {
  'use strict';
  const selector = 'video.joint-video-preview';
  const style = document.createElement('style');
  style.textContent = `
    .joint-video-frame{position:relative;display:block;width:100%;max-width:100%;overflow:hidden;border-radius:12px;background:#171321}
    .joint-video-frame>video{display:block;width:100%;max-width:100%;background:#171321;object-fit:contain}
    .joint-video-play-overlay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;place-items:center;width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.25);border:1px solid rgba(255,255,255,.5);color:#fff;font-size:25px;text-shadow:0 1px 5px #0009;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);pointer-events:none;transition:opacity .18s ease}
    .joint-video-frame.is-playing .joint-video-play-overlay{opacity:0}
  `;
  document.head.appendChild(style);

  function makePoster(video) {
    if (video.dataset.jointPosterAttempted === '1' || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.dataset.jointPosterAttempted = '1';
    const originalTime = video.currentTime || 0;
    const samples = [0.10, 0.24, 0.40, 0.62]
      .map(ratio => Math.min(video.duration - 0.02, Math.max(0.05, video.duration * ratio)))
      .filter((time, index, all) => time > 0 && all.indexOf(time) === index);
    let sampleIndex = 0, bestScore = -1, bestPoster = '';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const finish = () => {
      if (bestPoster) video.poster = bestPoster;
      if (video.paused && Number.isFinite(originalTime) && Math.abs(video.currentTime - originalTime) > 0.02) {
        try { video.currentTime = originalTime; } catch (_) {}
      }
    };
    const capture = () => {
      try {
        const width = video.videoWidth, height = video.videoHeight;
        if (!width || !height) return;
        const scale = Math.min(1, 640 / width);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let total = 0, count = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          total += (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722);
          count++;
        }
        const score = count ? total / count : 0;
        if (score > bestScore) {
          bestScore = score;
          bestPoster = canvas.toDataURL('image/jpeg', .84);
        }
      } catch (error) {
        console.debug('JOINT video poster extraction unavailable:', error?.message || error);
        sampleIndex = samples.length;
      }
    };
    const next = () => {
      if (sampleIndex >= samples.length) return finish();
      const time = samples[sampleIndex++];
      const onSeeked = () => { capture(); next(); };
      video.addEventListener('seeked', onSeeked, { once: true });
      try { video.currentTime = time; }
      catch (_) { video.removeEventListener('seeked', onSeeked); next(); }
    };
    next();
  }

  function enhance(video) {
    if (!(video instanceof HTMLVideoElement) || video.dataset.jointVideoEnhanced === '1') return;
    video.dataset.jointVideoEnhanced = '1';
    video.preload = 'auto';
    const wrapper = document.createElement('div');
    wrapper.className = 'joint-video-frame';
    video.parentNode.insertBefore(wrapper, video);
    wrapper.appendChild(video);
    const overlay = document.createElement('span');
    overlay.className = 'joint-video-play-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.textContent = '▶';
    wrapper.appendChild(overlay);
    video.addEventListener('play', () => wrapper.classList.add('is-playing'));
    video.addEventListener('pause', () => wrapper.classList.remove('is-playing'));
    video.addEventListener('ended', () => wrapper.classList.remove('is-playing'));
    video.addEventListener('loadedmetadata', () => makePoster(video), { once: true });
    if (video.readyState >= 1) makePoster(video);
  }

  function scan(node) {
    if (node.nodeType !== 1 && node !== document) return;
    if (node.matches?.(selector)) enhance(node);
    node.querySelectorAll?.(selector).forEach(enhance);
  }
  scan(document);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan)))
    .observe(document.documentElement, { childList: true, subtree: true });
})();
