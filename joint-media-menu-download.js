/* JOINT post media menu: one menu enhancement per post; no blocking browser alerts. */
(()=>{'use strict';
if(window.__jointMediaMenuActionsV6)return;window.__jointMediaMenuActionsV6=true;
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
function closePanel(panel){if(!panel)return;panel.hidden=true;panel.style.setProperty('display','none','important');panel.setAttribute('aria-hidden','true')}
function status(panel,msg){let s=document.getElementById('joint-media-download-toast');if(!s){s=document.createElement('div');s.id='joint-media-download-toast';s.setAttribute('role','status');s.style.cssText='position:fixed;left:12px;right:12px;bottom:84px;z-index:2147483647;max-width:520px;margin:0 auto;padding:12px 15px;border-radius:12px;background:#21143b;color:#fff;box-shadow:0 8px 28px #0003;font:14px/1.4 system-ui,sans-serif;overflow-wrap:anywhere;display:none';document.body.appendChild(s)}s.textContent=msg;s.style.display='block';clearTimeout(window.__jointMediaToastTimer);window.__jointMediaToastTimer=setTimeout(()=>{s.style.display='none'},6500);if(panel)closePanel(panel)}
function positionPanel(trigger,panel){if(!trigger||!panel)return;panel.style.setProperty('position','fixed','important');panel.style.setProperty('z-index','2147483000','important');panel.style.setProperty('width','min(280px, calc(100vw - 24px))','important');panel.style.setProperty('min-width','0','important');panel.style.setProperty('max-width','calc(100vw - 24px)','important');panel.style.setProperty('box-sizing','border-box','important');const r=trigger.getBoundingClientRect();const width=Math.min(280,window.innerWidth-24);let left=Math.max(12,Math.min(r.right-width,window.innerWidth-width-12));let top=r.bottom+6;const height=Math.min(panel.scrollHeight||180,window.innerHeight-24);if(top+height>window.innerHeight-12)top=Math.max(12,r.top-height-6);panel.style.setProperty('left',left+'px','important');panel.style.setProperty('right','auto','important');panel.style.setProperty('top',top+'px','important')}
function closeOtherPanels(keep){document.querySelectorAll('.joint-media-options').forEach(p=>{if(p!==keep)closePanel(p)})}

function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}
function brandedImage(img){return new Promise((resolve,reject)=>{const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)return reject(Error('Image is not ready yet.'));const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');try{x.drawImage(img,0,0,w,h)}catch(e){return reject(e)}const scale=Math.max(1,w/900),pad=Math.round(w*.025),bh=Math.max(42,Math.round(h*.075));x.fillStyle='rgba(28,18,48,.88)';x.fillRect(pad,pad,Math.min(w*.7,390*scale),bh);x.fillStyle='#6938d1';x.fillRect(pad,pad,bh,bh);x.fillStyle='#fff';x.textBaseline='middle';x.textAlign='center';x.font=`900 ${Math.round(bh*.62)}px Arial`;x.fillText('J',pad+bh/2,pad+bh/2);x.textAlign='left';x.font=`900 ${Math.round(bh*.34)}px Arial`;x.fillText('JOINT',pad+bh+10*scale,pad+bh*.4);x.font=`${Math.round(bh*.22)}px Arial`;x.fillText('myjointapp.com',pad+bh+10*scale,pad+bh*.73);const footer=Math.max(44,Math.round(h*.1));x.fillStyle='#20113f';x.fillRect(0,h-footer,w,footer);x.fillStyle='#fff';x.textAlign='center';x.font=`800 ${Math.round(footer*.27)}px Arial`;x.fillText('JOINT · Learn, connect, and grow together',w/2,h-footer*.62);x.fillStyle='#d8c6ff';x.font=`700 ${Math.round(footer*.23)}px Arial`;x.fillText('myjointapp.com',w/2,h-footer*.25);c.toBlob(b=>b?resolve(b):reject(Error('Could not export this image.')),'image/png')})}
async function doDownload(card,panel,button){
 const m=mediaFor(card);if(!m){status(panel,'Could not find this post’s image or video.');return}
 const old='Download',name='JOINT-'+safe(creatorFor(card));button.disabled=true;button.textContent='Preparing…';
 try{
  if(m.tagName==='IMG'){
   const blob=await brandedImage(m);downloadBlob(blob,name+'-JOINT-branded.png');status(panel,'JOINT-branded image download started.');return;
  }
  const src=m.currentSrc||m.src||m.querySelector('source')?.src;if(!src)throw Error('Video source is unavailable.');
  // Never silently download an unbranded video. Branded video needs a trusted server-side renderer.
  const exportUrl=window.JOINT_BRANDED_MEDIA_EXPORT_URL;
  if(!exportUrl)throw Error('JOINT-branded video downloads are not configured yet. A server-side video processing endpoint must be connected before a branded file can be downloaded.');
  const r=await fetch(exportUrl,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({media_url:src,media_type:'video',brand:'JOINT',post_url:location.href})});
  if(!r.ok)throw Error('The JOINT branded video service could not process this video. No unbranded copy was downloaded.');
  const blob=await r.blob();
  if(!blob.size)throw Error('The branded video file was empty.');
  const ext=/webm/i.test(blob.type)?'webm':/quicktime/i.test(blob.type)?'mov':'mp4';
  downloadBlob(blob,name+'-JOINT-branded.'+ext);
  status(panel,'JOINT-branded video download started.');
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
 const card=cardFor(w);if(!card)return;
 // Select the actual open menu only; never mistake a toast/notification div for a menu.
 const panels=[...w.children].filter(x=>x!==trigger&&x.tagName==='DIV');
 let panel=panels.find(x=>x.querySelector('button')&&(/report|edit post|delete post|sexual content|violence|scam|misleading/i.test(x.textContent)));
 if(!panel)return;
 if(panel.dataset.jointMediaEnhanced==='1')return;
 panel.dataset.jointMediaEnhanced='1';panel.classList.add('joint-media-options');positionPanel(trigger,panel);
 const existing=[...panel.querySelectorAll('button')];
 const reasonButtons=existing.filter(b=>/^(sexual content|violence|scam|misleading)$/i.test(b.textContent.trim()));
 const isOwn=existing.some(b=>b.matches('[data-edit],[data-delete]'))||existing.some(b=>/^(edit post|delete post)$/i.test(b.textContent.trim()));
 // Remove stale duplicate actions and stray ellipsis entries that appeared as menu rows.
 existing.filter(b=>/^(download|report|\.{2,}|…+)$/i.test(b.textContent.trim())).forEach(b=>b.remove());
 const dl=document.createElement('button');dl.type='button';dl.textContent='Download';
 dl.addEventListener('click',e=>{e.stopPropagation();panel.hidden=false;doDownload(card,panel,dl)});
 if(isOwn){panel.insertBefore(dl,panel.firstChild);closePanel(panel);return}
 if(reasonButtons.length){
  const reasons=document.createElement('div');reasons.className='joint-report-reasons';reasons.hidden=true;
  reasonButtons.forEach(b=>reasons.appendChild(b));
  const report=document.createElement('button');report.type='button';report.textContent='Report';report.setAttribute('aria-expanded','false');
  report.addEventListener('click',e=>{e.stopPropagation();reasons.hidden=!reasons.hidden;report.setAttribute('aria-expanded',String(!reasons.hidden))});
  panel.insertBefore(reasons,panel.firstChild);panel.insertBefore(report,reasons);panel.insertBefore(dl,report);
 }else panel.insertBefore(dl,panel.firstChild);
 closePanel(panel);
}
function scan(root=document){
 const wrappers=new Set();
 root.querySelectorAll?.('.post-menu-wrap,.joint-post-menu-wrap,.mp-profile-report-wrap,.mp-post-report-wrap,.mp-post-head,.post-header').forEach(w=>wrappers.add(w));
 root.querySelectorAll?.('button[aria-label="Post options"],button[aria-label="Profile options"]').forEach(b=>{if(b.parentElement)wrappers.add(b.parentElement)});
 wrappers.forEach(enhance);
}
function wireMenuDismissal(){
 document.addEventListener('click',e=>{
  const trigger=e.target.closest?.('button[aria-label="Post options"],button[aria-label="Profile options"],.joint-post-menu');
  if(trigger){
   const w=trigger.parentElement;
   const panel=[...(w?.querySelectorAll?.('.joint-media-options')||[])].find(p=>p.dataset.jointMediaEnhanced==='1');
   if(!panel)return;
   const wasOpen=!panel.hidden&&panel.getAttribute('aria-hidden')!=='true'&&getComputedStyle(panel).display!=='none';
   setTimeout(()=>{
    if(wasOpen){closeOtherPanels(null);return;}
    closeOtherPanels(panel);
    panel.hidden=false;panel.removeAttribute('aria-hidden');panel.style.removeProperty('display');
    positionPanel(trigger,panel);
   },0);
   return;
  }
  if(!e.target.closest?.('.joint-media-options'))closeOtherPanels(null);
 },true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeOtherPanels(null)});
 window.addEventListener('resize',()=>document.querySelectorAll('.joint-media-options').forEach(p=>{
  if(p.hidden||p.getAttribute('aria-hidden')==='true'||getComputedStyle(p).display==='none')return;
  const w=p.parentElement;const t=w?.querySelector?.('button[aria-label="Post options"],button[aria-label="Profile options"],.joint-post-menu');if(t)positionPanel(t,p);
 }));
 // Do not reposition on every scroll: that caused menus to jump/blink over unrelated posts.
}
function start(){wireMenuDismissal();scan();new MutationObserver(rs=>rs.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.documentElement,{childList:true,subtree:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
