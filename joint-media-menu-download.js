/* JOINT post media menu: one menu enhancement per post; no blocking browser alerts. */
(()=>{'use strict';
if(window.__jointMediaMenuActionsV5)return;window.__jointMediaMenuActionsV5=true;
const css=document.createElement('style');
css.textContent='.joint-media-options{position:absolute;right:0;top:calc(100% + 4px);z-index:9999;min-width:180px;max-width:min(88vw,280px);padding:7px;background:#fff;border:1px solid #e7e0f0;border-radius:12px;box-shadow:0 10px 28px #20133424;color:#292238}.joint-media-options button{display:block;width:100%;padding:10px 12px;text-align:left;border:0;border-radius:8px;background:#fff;color:#292238;font:inherit;cursor:pointer}.joint-media-options button:hover{background:#f3edff}.joint-report-reasons{border-top:1px solid #eee7f5;margin-top:5px;padding-top:5px}.joint-media-status{font-size:12px;line-height:1.35;color:#6b5a7c;padding:7px 10px;overflow-wrap:anywhere}.joint-media-options [hidden]{display:none!important}';
document.head.appendChild(css);
const safe=s=>String(s||'JOINT').normalize('NFKD').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,45)||'JOINT';
function cardFor(w){
 let n=w;
 for(let i=0;n&&i<8;i++,n=n.parentElement){
  if(n.matches?.('article,.mp-post,.post,.joint-post-card,.post-card,.joint-user-post,[data-post-id]'))return n;
 }
 n=w.parentElement;
 for(let i=0;n&&i<7;i++,n=n.parentElement){
  const media=n.querySelector?.('video, .post-media img, .mp-post-media img, .post-content img, .mp-post-content img');
  if(media)return n;
 }
 return w.parentElement;
}
function mediaFor(card){
 if(!card)return null;
 const excluded='header,.post-header,.mp-post-head,.post-author,.mp-post-author,.author,.profile,.avatar,[class*="avatar" i],[class*="profile" i],[data-author],[data-profile-picture],.joint-post-author-avatar';
 const bad=e=>!!e.closest(excluded);
 const videos=[...card.querySelectorAll('video')].filter(v=>!bad(v)&&(v.currentSrc||v.src||v.querySelector('source')?.src));
 if(videos.length)return videos.sort((a,b)=>(b.videoWidth*b.videoHeight)-(a.videoWidth*a.videoHeight))[0];
 const preferred=[...card.querySelectorAll('.post-media img,.mp-post-media img,.post-content img,.mp-post-content img,.joint-post-content img,img.mp-media,img.media')].filter(i=>!bad(i));
 const all=[...card.querySelectorAll('img')].filter(i=>!bad(i)&&!i.closest('button,a[aria-label*="profile" i]')&&((i.naturalWidth||i.width)>120||(i.naturalHeight||i.height)>120));
 const candidates=preferred.length?preferred:all;
 return candidates.sort((a,b)=>((b.naturalWidth||b.width)*(b.naturalHeight||b.height))-((a.naturalWidth||a.width)*(a.naturalHeight||a.height)))[0]||null;
}
function creatorFor(card){return card?.querySelector('.mp-post-author,.author-name,[data-author-name],.author strong,.post-header strong,.post-header a,.joint-post-head a,.joint-post-head strong,strong')?.textContent?.trim()||'JOINT-Creator'}
function status(panel,msg){let s=panel.querySelector('.joint-media-status');if(!s){s=document.createElement('div');s.className='joint-media-status';panel.appendChild(s)}s.textContent=msg;s.hidden=false}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}
function brandedImage(img){return new Promise((resolve,reject)=>{const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)return reject(Error('Image is not ready yet.'));const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');try{x.drawImage(img,0,0,w,h)}catch(e){return reject(e)}const scale=Math.max(1,w/900),pad=Math.round(w*.025),bh=Math.max(42,Math.round(h*.075));x.fillStyle='rgba(28,18,48,.88)';x.fillRect(pad,pad,Math.min(w*.7,390*scale),bh);x.fillStyle='#6938d1';x.fillRect(pad,pad,bh,bh);x.fillStyle='#fff';x.textBaseline='middle';x.textAlign='center';x.font=`900 ${Math.round(bh*.62)}px Arial`;x.fillText('J',pad+bh/2,pad+bh/2);x.textAlign='left';x.font=`900 ${Math.round(bh*.34)}px Arial`;x.fillText('JOINT',pad+bh+10*scale,pad+bh*.4);x.font=`${Math.round(bh*.22)}px Arial`;x.fillText('myjointapp.com',pad+bh+10*scale,pad+bh*.73);const footer=Math.max(44,Math.round(h*.1));x.fillStyle='#20113f';x.fillRect(0,h-footer,w,footer);x.fillStyle='#fff';x.textAlign='center';x.font=`800 ${Math.round(footer*.27)}px Arial`;x.fillText('JOINT · Learn, connect, and grow together',w/2,h-footer*.62);x.fillStyle='#d8c6ff';x.font=`700 ${Math.round(footer*.23)}px Arial`;x.fillText('myjointapp.com',w/2,h-footer*.25);c.toBlob(b=>b?resolve(b):reject(Error('Could not export this image.')),'image/png')})}
async function doDownload(card,panel,button){
 const m=mediaFor(card);if(!m){status(panel,'Could not find this post’s image or video.');return}
 const old='Download',name='JOINT-'+safe(creatorFor(card));button.disabled=true;button.textContent='Preparing…';
 try{
  if(m.tagName==='IMG'){
   const blob=await brandedImage(m);downloadBlob(blob,name+'-branded.png');status(panel,'Branded image download started.');return;
  }
  const src=m.currentSrc||m.src||m.querySelector('source')?.src;if(!src)throw Error('Video source is unavailable.');
  // Browser-only canvas recording is unreliable for cross-origin video. Never falsely claim a branded export.
  const r=await fetch(src,{mode:'cors',credentials:'omit'});
  if(!r.ok)throw Error('The video host did not allow access to the video file.');
  const blob=await r.blob();
  if(!blob.size)throw Error('The video file was empty.');
  const ext=/webm/i.test(blob.type+' '+src)?'webm':/quicktime|\.mov/i.test(blob.type+' '+src)?'mov':'mp4';
  downloadBlob(blob,name+'-original.'+ext);
  status(panel,'Video downloaded without a permanent watermark. JOINT-branded video export requires server-side video processing.');
 }catch(e){
  console.warn('JOINT branded media export unavailable:',e);
  status(panel, m.tagName==='IMG'
   ?'This image host blocks browser watermarking. No unbranded copy was downloaded; server-side media processing is needed.'
   :'This video host blocks browser download/branding. No unbranded fallback was downloaded; server-side video processing is needed.');
 }finally{button.disabled=false;button.textContent=old}
}
function enhance(w){
 const trigger=w.querySelector?.('button[aria-label="Post options"],button[aria-label="Profile options"],.joint-post-menu');
 if(!trigger)return;
 const card=cardFor(w);if(!mediaFor(card))return;
 // Select the actual open menu only; never mistake a toast/notification div for a menu.
 const panels=[...w.children].filter(x=>x!==trigger&&x.tagName==='DIV');
 let panel=panels.find(x=>x.querySelector('button')&&(/report|edit post|delete post|sexual content|violence|scam|misleading/i.test(x.textContent)));
 if(!panel)return;
 if(panel.dataset.jointMediaEnhanced==='1')return;
 panel.dataset.jointMediaEnhanced='1';panel.classList.add('joint-media-options');
 const existing=[...panel.querySelectorAll('button')];
 const reasonButtons=existing.filter(b=>/^(sexual content|violence|scam|misleading)$/i.test(b.textContent.trim()));
 const isOwn=existing.some(b=>b.matches('[data-edit],[data-delete]'))||existing.some(b=>/^(edit post|delete post)$/i.test(b.textContent.trim()));
 // Remove stale Download/Report entries from this same menu before inserting a single copy.
 existing.filter(b=>/^(download|report)$/i.test(b.textContent.trim())).forEach(b=>b.remove());
 const dl=document.createElement('button');dl.type='button';dl.textContent='Download';
 dl.addEventListener('click',e=>{e.stopPropagation();panel.hidden=false;doDownload(card,panel,dl)});
 if(isOwn){panel.insertBefore(dl,panel.firstChild);return}
 if(reasonButtons.length){
  const reasons=document.createElement('div');reasons.className='joint-report-reasons';reasons.hidden=true;
  reasonButtons.forEach(b=>reasons.appendChild(b));
  const report=document.createElement('button');report.type='button';report.textContent='Report';report.setAttribute('aria-expanded','false');
  report.addEventListener('click',e=>{e.stopPropagation();reasons.hidden=!reasons.hidden;report.setAttribute('aria-expanded',String(!reasons.hidden))});
  panel.insertBefore(reasons,panel.firstChild);panel.insertBefore(report,reasons);panel.insertBefore(dl,report);
 }else panel.insertBefore(dl,panel.firstChild);
}
function scan(root=document){
 const wrappers=new Set();
 root.querySelectorAll?.('.post-menu-wrap,.joint-post-menu-wrap,.mp-profile-report-wrap,.mp-post-report-wrap,.mp-post-head,.post-header').forEach(w=>wrappers.add(w));
 root.querySelectorAll?.('button[aria-label="Post options"],button[aria-label="Profile options"]').forEach(b=>{if(b.parentElement)wrappers.add(b.parentElement)});
 wrappers.forEach(enhance);
}
function start(){scan();new MutationObserver(rs=>rs.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.documentElement,{childList:true,subtree:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
