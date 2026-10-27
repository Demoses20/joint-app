/* JOINT branded video export. Records a watermarked copy in-browser; original post media is unchanged. */
(() => {
  'use strict';
  if (window.__jointVideoBrandingInstalled) return;
  window.__jointVideoBrandingInstalled = true;
  const safeName = s => String(s || 'JOINT').normalize('NFKD').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'JOINT';
  const style = document.createElement('style');
  style.textContent = '.joint-branded-download{display:inline-flex;align-items:center;justify-content:center;gap:8px;margin:8px 0;padding:10px 14px;border:0;border-radius:12px;background:#6938d1;color:#fff;font:700 14px/1.2 inherit;cursor:pointer}.joint-branded-download:disabled{opacity:.65;cursor:wait}.joint-branded-download-status{font-size:12px;color:#675c78;margin:4px 0 8px}';
  document.head.appendChild(style);
  function creatorFor(video) {
    const card = video.closest('.mp-post,.joint-user-post,article,.card') || video.parentElement;
    const author = card && (card.querySelector('.mp-post-author') || card.querySelector('.joint-post-head strong') || card.querySelector('strong') || card.querySelector('[data-author-name]'));
    return author ? author.textContent.trim() : 'JOINT Creator';
  }
  function addButton(video) {
    if (video.dataset.jointBrandDownload === '1' || !video.parentNode) return;
    video.dataset.jointBrandDownload = '1';
    // Hide the browser's unbranded native download action; retain normal playback controls.
    const oldList = (video.getAttribute('controlsList') || '').split(/\s+/).filter(Boolean);
    if (!oldList.includes('nodownload')) oldList.push('nodownload');
    video.setAttribute('controlsList', oldList.join(' '));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'joint-branded-download'; button.textContent = '⬇ Download with JOINT Branding';
    const status = document.createElement('p'); status.className = 'joint-branded-download-status'; status.setAttribute('role','status'); status.hidden = true;
    video.insertAdjacentElement('afterend', button); button.insertAdjacentElement('afterend', status);
    button.addEventListener('click', async () => {
      if (!('MediaRecorder' in window) || !HTMLCanvasElement.prototype.captureStream) {
        status.hidden = false; status.textContent = 'Branded download is not supported by this browser. Try the latest Chrome.'; return;
      }
      if (!video.currentSrc && !video.src) { status.hidden = false; status.textContent = 'Video source is not available.'; return; }
      const wasPaused = video.paused, oldTime = video.currentTime, oldMuted = video.muted;
      let canvasStream, sourceStream, recorder, chunks = [], raf = 0;
      button.disabled = true; status.hidden = false; status.textContent = 'Preparing branded video… Keep this page open until the download finishes.';
      try {
        // A video element is used as the recording source so its audio can be included where browser permissions allow.
        const canvas = document.createElement('canvas');
        const width = Math.max(640, Math.min(1280, video.videoWidth || 720));
        const height = Math.max(360, Math.min(1280, Math.round(width * ((video.videoHeight || 405) / (video.videoWidth || 720)))));
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        const fps = 25;
        canvasStream = canvas.captureStream(fps);
        if (typeof video.captureStream === 'function') sourceStream = video.captureStream();
        else if (typeof video.mozCaptureStream === 'function') sourceStream = video.mozCaptureStream();
        if (sourceStream) sourceStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
        const mime = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
        recorder = new MediaRecorder(canvasStream, mime ? { mimeType: mime } : undefined);
        recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        let addingEndCard = false;
        const drawEndCard = () => {
          ctx.fillStyle='#20113f'; ctx.fillRect(0,0,width,height);
          const logoSize=Math.min(width*.22,height*.3);
          ctx.fillStyle='#6938d1';
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect((width-logoSize)/2,height*.16,logoSize,logoSize,logoSize*.2); ctx.fill(); }
          else ctx.fillRect((width-logoSize)/2,height*.16,logoSize,logoSize);
          ctx.fillStyle='#fff'; ctx.font=`900 ${Math.round(logoSize*.68)}px Arial`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('J',width/2,height*.16+logoSize/2);
          ctx.font=`900 ${Math.round(height*.09)}px Arial`; ctx.fillText('JOINT',width/2,height*.16+logoSize+height*.12);
          ctx.font=`${Math.round(height*.038)}px Arial`; ctx.fillText('Learn, connect, and grow together',width/2,height*.16+logoSize+height*.2);
          ctx.font=`700 ${Math.round(height*.045)}px Arial`; ctx.fillStyle='#d8c6ff'; ctx.fillText('myjointapp.com',width/2,height*.16+logoSize+height*.28);
          ctx.font=`700 ${Math.round(height*.032)}px Arial`; ctx.fillStyle='#fff'; ctx.fillText('Watch more on JOINT',width/2,height*.16+logoSize+height*.36);
        };
        const draw = () => {
          if (addingEndCard) { drawEndCard(); raf=requestAnimationFrame(draw); return; }
          ctx.fillStyle = '#171421'; ctx.fillRect(0,0,width,height);
          const vw=video.videoWidth||width, vh=video.videoHeight||height, scale=Math.min(width/vw,height/vh), dw=vw*scale, dh=vh*scale;
          try { ctx.drawImage(video,(width-dw)/2,(height-dh)/2,dw,dh); } catch (_) {}
          const pad=Math.max(14,width*.025), boxH=Math.max(42,height*.09);
          ctx.fillStyle='rgba(28,18,48,.72)'; ctx.fillRect(pad,pad,Math.min(width*.52,300),boxH);
          ctx.fillStyle='#8a55f0'; ctx.fillRect(pad,pad,boxH,boxH);
          ctx.fillStyle='#fff'; ctx.font=`900 ${Math.round(boxH*.62)}px Arial`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('J',pad+boxH/2,pad+boxH/2);
          ctx.textAlign='left'; ctx.font=`800 ${Math.round(boxH*.35)}px Arial`; ctx.fillText('JOINT',pad+boxH+10,pad+boxH*.42);
          ctx.font=`${Math.round(boxH*.22)}px Arial`; ctx.fillText('myjointapp.com',pad+boxH+10,pad+boxH*.74);
          if (!video.paused && !video.ended) raf=requestAnimationFrame(draw);
        };
        const stopDraw = () => { if (raf) cancelAnimationFrame(raf); };
        recorder.onstop = () => {
          stopDraw();
          try {
            const blob = new Blob(chunks, {type: recorder.mimeType || 'video/webm'});
            if (!blob.size) throw new Error('The browser did not produce a video file.');
            const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`JOINT-${safeName(creatorFor(video))}-branded.webm`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
            status.textContent='Your JOINT-branded video has downloaded, including the watermark and full-screen end card.';
          } catch (err) { status.textContent='Could not finish the branded download: '+(err.message||'unsupported video format'); }
          finally { button.disabled=false; if(sourceStream) sourceStream.getTracks().forEach(t=>t.stop()); if(canvasStream) canvasStream.getTracks().forEach(t=>t.stop()); video.muted=oldMuted; video.loop=true; if(wasPaused) video.pause(); }
        };
        video.muted = false;
        if (video.ended || (duration && oldTime >= duration - .25)) video.currentTime = 0;
        video.loop = false;
        await video.play();
        draw(); recorder.start(500);
        status.textContent='Recording the watermarked copy in real time…';
        video.addEventListener('ended', () => { addingEndCard=true; drawEndCard(); setTimeout(() => { if (recorder && recorder.state !== 'inactive') recorder.stop(); }, 3000); }, {once:true});
        if (duration && oldTime > 0) video.currentTime = 0;
      } catch (err) {
        if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
        if (raf) cancelAnimationFrame(raf);
        button.disabled=false; status.textContent='Could not create a branded copy. This video may block browser recording; a server-side video processor is required for that file.';
      }
    });
  }
  function scan(root=document) { root.querySelectorAll('video').forEach(addButton); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>scan()); else scan();
  new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1){if(n.matches('video'))addButton(n);scan(n);}}))).observe(document.documentElement,{childList:true,subtree:true});
})();
