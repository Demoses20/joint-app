/* JOINT post video controls: replace browser-native controls with safe custom controls. */
(()=>{'use strict';
if(window.__jointPostVideoControlsV1)return;window.__jointPostVideoControlsV1=true;
const css=document.createElement('style');
css.textContent=`
.joint-video-player{position:relative;display:block;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:14px;background:#171421;margin:12px 0}
.joint-video-player>video{display:block!important;width:100%!important;height:100%!important;max-width:100%;aspect-ratio:auto!important;object-fit:contain;border:0!important;border-radius:0!important;margin:0!important;background:#171421}
.joint-video-controls{position:absolute;left:0;right:0;bottom:0;z-index:5;display:flex;align-items:center;gap:8px;padding:10px;background:linear-gradient(transparent,rgba(0,0,0,.86));color:#fff;font:12px/1.2 system-ui,sans-serif}
.joint-video-controls button{appearance:none;border:0;border-radius:8px;background:rgba(255,255,255,.18);color:#fff;min-width:34px;height:32px;padding:0 9px;font:700 14px system-ui,sans-serif;cursor:pointer}
.joint-video-controls input[type=range]{min-width:0;flex:1;accent-color:#a982ff;height:20px;margin:0}
.joint-video-time{white-space:nowrap;font-variant-numeric:tabular-nums}
.joint-video-controls button:focus-visible,.joint-video-controls input:focus-visible{outline:2px solid #d8c6ff;outline-offset:2px}
.joint-video-player video::-webkit-media-controls{display:none!important}
`;
document.head.appendChild(css);
const fmt=t=>{if(!Number.isFinite(t)||t<0)t=0;return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')};
function setup(v){
 if(!v||v.dataset.jointPostControlsReady)return;
 v.dataset.jointPostControlsReady='1';v.controls=false;
 v.setAttribute('controlslist','nodownload noplaybackrate noremoteplayback');
 v.setAttribute('disablepictureinpicture','');v.setAttribute('webkit-playsinline','true');
 v.addEventListener('contextmenu',e=>e.preventDefault());
 let player=v.closest('.joint-video-player');
 if(!player){player=document.createElement('div');player.className='joint-video-player';v.parentNode?.insertBefore(player,v);player.appendChild(v)}
 let bar=player.querySelector('.joint-video-controls');
 if(!bar){
  bar=document.createElement('div');bar.className='joint-video-controls';
  const play=document.createElement('button');play.type='button';play.textContent=v.paused?'▶':'Ⅱ';play.setAttribute('aria-label',v.paused?'Play video':'Pause video');
  const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='1000';seek.value='0';seek.setAttribute('aria-label','Seek video');
  const time=document.createElement('span');time.className='joint-video-time';time.textContent='0:00 / 0:00';
  const mute=document.createElement('button');mute.type='button';mute.textContent=v.muted?'🔇':'🔊';mute.setAttribute('aria-label',v.muted?'Unmute video':'Mute video');
  bar.append(play,seek,time,mute);player.appendChild(bar);
  play.addEventListener('click',e=>{e.stopPropagation();if(v.paused)v.play().catch(()=>{});else v.pause()});
  mute.addEventListener('click',e=>{e.stopPropagation();v.muted=!v.muted;mute.textContent=v.muted?'🔇':'🔊';mute.setAttribute('aria-label',v.muted?'Unmute video':'Mute video')});
  seek.addEventListener('input',()=>{if(Number.isFinite(v.duration)&&v.duration>0)v.currentTime=Number(seek.value)/1000*v.duration});
  const update=()=>{if(!seek.matches(':active')&&Number.isFinite(v.duration)&&v.duration>0)seek.value=String(Math.round(v.currentTime/v.duration*1000));time.textContent=fmt(v.currentTime)+' / '+fmt(v.duration)};
  v.addEventListener('timeupdate',update);v.addEventListener('loadedmetadata',update);v.addEventListener('durationchange',update);
  v.addEventListener('play',()=>{v.controls=false;play.textContent='Ⅱ';play.setAttribute('aria-label','Pause video')});
  v.addEventListener('pause',()=>{v.controls=false;play.textContent='▶';play.setAttribute('aria-label','Play video')});
  // Capture before existing post click handlers, so they cannot re-enable browser-native Download/Playback speed menus.
  v.addEventListener('click',e=>{e.stopImmediatePropagation();v.controls=false;if(v.paused)v.play().catch(()=>{});else v.pause()},true);
 }
 // Keep native controls disabled even if another legacy handler tries to enable them.
 v.controls=false;
}
function scan(root=document){if(root.matches?.('video'))setup(root);root.querySelectorAll?.('video').forEach(setup)}
function start(){
 scan();
 new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.documentElement,{childList:true,subtree:true});
 if('IntersectionObserver'in window){
  const io=new IntersectionObserver(entries=>entries.forEach(e=>{const v=e.target;if(e.isIntersecting&&e.intersectionRatio>=.6){document.querySelectorAll('video').forEach(other=>{if(other!==v)other.pause()});v.muted=true;const mute=v.closest('.joint-video-player')?.querySelector('.joint-video-controls button:last-child');if(mute){mute.textContent='🔇';mute.setAttribute('aria-label','Unmute video')}v.play().catch(()=>{})}else v.pause()}),{threshold:[0,.6,1]});
  const observe=()=>document.querySelectorAll('video').forEach(v=>{if(!v.dataset.jointPostVideoObserved){v.dataset.jointPostVideoObserved='1';io.observe(v)}});
  observe();new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();