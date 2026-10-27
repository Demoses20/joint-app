/* JOINT media actions: compact post menu, branded image export, video download fallback. */
(() => {
  'use strict';
  if (window.__jointMediaMenuActions) return;
  window.__jointMediaMenuActions = true;
  const css = document.createElement('style');
  css.textContent = `
    .joint-media-actions { position:absolute;right:0;top:calc(100% + 5px);z-index:1000;min-width:190px;padding:7px;background:#fff;border:1px solid #e7e0f0;border-radius:12px;box-shadow:0 10px 28px #20133424;color:#292238 }
    .joint-media-actions button { display:block;width:100%;padding:10px 12px;text-align:left;border:0;border-radius:8px;background:#fff;color:#292238;font:inherit;cursor:pointer }
    .joint-media-actions button:hover { background:#f3edff }
    .joint-media-actions .joint-report-reasons { border-top:1px solid #eee7f5;margin-top:5px;padding-top:5px }
    .joint-media-actions .joint-report-reasons[hidden] { display:none!important }
    .joint-branded-download,.joint-branded-download-status { display:none!important }
  `;
  document.head.appendChild(css);
  const safe = s => String(s || 'JOINT').normalize('NFKD').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,45) || 'JOINT';
  function cardFor(el) { return el.closest('article,.post-card,.joint-post-card,.mp-post,.card,[class*="post"]') || el.parentElement; }
  function mediaFor(card) { return card && card.querySelector('video, img:not([src*="avatar"]):not([class*="avatar"]):not([class*="profile"])'); }
  function creatorFor(card) { return card?.querySelector('[data-author-name],.mp-post-author,.joint-post-head strong,strong,h3')?.textContent?.trim() || 'JOINT Creator'; }
  function brandedImage(img, card) {
    return new Promise((resolve,reject) => {
      const canvas=document.createElement('canvas'), w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
      if(!w||!h) return reject(new Error('Image is not ready.'));
      canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d');
      try { ctx.drawImage(img,0,0,w,h); } catch(e) { return reject(new Error('This image does not allow branded export.')); }
      const scale=Math.max(1,w/900), boxH=Math.max(38,Math.round(h*.075)), pad=Math.round(w*.025);
      ctx.fillStyle='rgba(28,18,48,.78)';ctx.fillRect(pad,pad,Math.min(w*.65,360*scale),boxH);
      ctx.fillStyle='#6938d1';ctx.fillRect(pad,pad,boxH,boxH);
      ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`900 ${Math.round(boxH*.64)}px Arial`;ctx.fillText('J',pad+boxH/2,pad+boxH/2);
      ctx.textAlign='left';ctx.font=`800 ${Math.round(boxH*.33)}px Arial`;ctx.fillText('JOINT',pad+boxH+10*scale,pad+boxH*.42);
      ctx.font=`${Math.round(boxH*.21)}px Arial`;ctx.fillText('myjointapp.com',pad+boxH+10*scale,pad+boxH*.75);
      const barH=Math.max(42,Math.round(h*.11));ctx.fillStyle='#20113f';ctx.fillRect(0,h-barH,w,barH);
      ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font=`800 ${Math.round(barH*.28)}px Arial`;ctx.fillText('JOINT · Learn, connect, and grow together',w/2,h-barH*.62);
      ctx.fillStyle='#d8c6ff';ctx.font=`700 ${Math.round(barH*.24)}px Arial`;ctx.fillText('myjointapp.com',w/2,h-barH*.25);
      canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create image file.')),'image/png');
    });
  }
  function downloadBlob(blob,name) { const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000); }
  async function downloadMedia(card, button) {
    const media=mediaFor(card); if(!media) { alert('No downloadable photo or video was found in this post.'); return; }
    button.disabled=true; const old=button.textContent;button.textContent='Preparing download…';
    try {
      const filename=`JOINT-${safe(creatorFor(card))}-branded`;
      if(media.tagName==='IMG') {
        const blob=await brandedImage(media,card);downloadBlob(blob,filename+'.png');
      } else {
        // Prefer a playable file download if this browser blocks canvas recording of cross-origin media.
        // A true burned-in watermark on video requires a server-side transcoder when capture is blocked.
        const src=media.currentSrc||media.src;
        if(!src) throw new Error('Video source is unavailable.');
        const a=document.createElement('a');a.href=src;a.download=filename+( /\.mp4(?:$|[?#])/i.test(src)?'.mp4': /\.mov(?:$|[?#])/i.test(src)?'.mov':'.webm');a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
        alert('The video download was requested. This browser blocks reliable watermarking for some hosted videos, so this fallback may be the original video. Permanent JOINT watermark and end-card export for those files requires server-side video processing.');
      }
    } catch(e) { alert('Download could not be prepared: '+(e.message||'Please try again.')); }
    finally { button.disabled=false;button.textContent=old; }
  }
  function enhance(menu, card) {
    if(menu.dataset.jointEnhanced==='1') return;
    const panel = menu.matches('.report-menu') ? menu : menu.querySelector('.report-menu');
    if(!panel) return;
    menu.dataset.jointEnhanced='1';
    // Keep the existing report reasons and report RPC handlers untouched.
    const reasons=document.createElement('div'); reasons.className='joint-report-reasons';reasons.hidden=true;
    while(panel.firstChild) reasons.appendChild(panel.firstChild);
    const download=document.createElement('button');download.type='button';download.textContent='Download';
    download.addEventListener('click',async ev=>{ev.stopPropagation();panel.hidden=true;reasons.hidden=true;await downloadMedia(card,download);});
    const report=document.createElement('button');report.type='button';report.textContent='Report';report.setAttribute('aria-expanded','false');
    report.addEventListener('click',ev=>{ev.stopPropagation();reasons.hidden=!reasons.hidden;report.setAttribute('aria-expanded',String(!reasons.hidden));});
    panel.append(download,report,reasons);
  }
  function scan(root=document) {
    root.querySelectorAll('.post-menu-wrap,.mp-profile-report-wrap').forEach(w=>{
      const panel=w.querySelector('.report-menu') || [...w.children].find(el=>el.tagName==='DIV' && el.querySelector('button'));
      const card=cardFor(w);
      if(panel && mediaFor(card)) {
        if(!panel.classList.contains('report-menu')) panel.classList.add('report-menu');
        enhance(panel,card);
      }
    });
    root.querySelectorAll('.joint-branded-download').forEach(b=>b.remove());
    root.querySelectorAll('.joint-branded-download-status').forEach(b=>b.remove());
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>scan()); else scan();
  new MutationObserver(rs=>rs.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.documentElement,{childList:true,subtree:true});
})();
