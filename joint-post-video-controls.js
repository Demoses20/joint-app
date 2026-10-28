/* JOINT shared video controls: home feed, personal profile, and member-profile posts. */
(()=>{'use strict';
 if(window.__jointVideoControllerV2)return;window.__jointVideoControllerV2=true;
 const style=document.createElement('style');style.textContent=`
 .joint-video-player{position:relative;display:block;width:100%;max-width:100%;aspect-ratio:auto;overflow:hidden;border-radius:14px;background:transparent;margin:12px 0;isolation:isolate}
 .joint-video-player>video{display:block!important;width:100%!important;height:auto!important;max-width:100%;aspect-ratio:auto;object-fit:contain!important;object-position:center center;border:0!important;border-radius:0!important;margin:0!important;background:transparent;cursor:pointer}
 .joint-video-controls{position:absolute;left:0;right:0;bottom:0;z-index:8;display:flex;align-items:center;gap:8px;padding:10px 12px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.82));font:12px/1.2 system-ui,sans-serif;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .16s ease,visibility .16s ease}
 .joint-video-player.joint-controls-visible .joint-video-controls{opacity:1;visibility:visible;pointer-events:auto}
 .joint-video-controls button{appearance:none;-webkit-appearance:none;border:0;border-radius:9px;background:rgba(255,255,255,.18);color:#fff;min-width:34px;height:32px;padding:0 8px;font:700 14px system-ui,sans-serif;cursor:pointer}
 .joint-video-controls input[type=range]{min-width:0;flex:1;accent-color:#a982ff;height:20px;margin:0}
 .joint-video-time{white-space:nowrap;font-variant-numeric:tabular-nums}
 .joint-video-controls button:focus-visible,.joint-video-controls input:focus-visible{outline:2px solid #d8c6ff;outline-offset:2px}
 .joint-video-player video::-webkit-media-controls{display:none!important}
 .joint-video-player video::-webkit-media-controls-enclosure{display:none!important}
 @media(prefers-reduced-motion:reduce){.joint-video-controls{transition:none}}
 `;document.head.appendChild(style);
 const fmt=t=>{if(!Number.isFinite(t)||t<0)t=0;return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')};
 function setup(v){
  if(!(v instanceof HTMLVideoElement)||v.dataset.jointVideoUi==='ready')return;
  v.dataset.jointVideoUi='ready';v.controls=false;v.loop=true;v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','true');v.setAttribute('controlslist','nodownload noplaybackrate noremoteplayback');v.setAttribute('disablepictureinpicture','');
  // Default to audible playback. Browsers may still block audible autoplay until a user gesture.
  v.muted=false;
  let player=v.closest('.joint-video-player');if(!player){player=document.createElement('div');player.className='joint-video-player';v.parentNode?.insertBefore(player,v);player.appendChild(v)}
  const fitUploadedAspect=()=>{if(v.videoWidth>0&&v.videoHeight>0){const ratio=v.videoWidth+'/'+v.videoHeight;if(player.style.aspectRatio!==ratio)player.style.aspectRatio=ratio;player.dataset.jointVideoRatio=ratio;v.style.aspectRatio=ratio;}};
  v.addEventListener('loadedmetadata',fitUploadedAspect);v.addEventListener('resize',fitUploadedAspect);fitUploadedAspect();
  let bar=player.querySelector('.joint-video-controls');if(!bar){
   bar=document.createElement('div');bar.className='joint-video-controls';
   const play=document.createElement('button');play.type='button';play.textContent=v.paused?'▶':'Ⅱ';play.setAttribute('aria-label',v.paused?'Play video':'Pause video');
   const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='1000';seek.value='0';seek.setAttribute('aria-label','Seek video');
   const time=document.createElement('span');time.className='joint-video-time';time.textContent='0:00 / 0:00';
   const mute=document.createElement('button');mute.type='button';mute.textContent=v.muted?'🔇':'🔊';mute.setAttribute('aria-label',v.muted?'Unmute video':'Mute video');
   bar.append(play,seek,time,mute);player.appendChild(bar);
   const syncPlay=()=>{play.textContent=v.paused?'▶':'Ⅱ';play.setAttribute('aria-label',v.paused?'Play video':'Pause video')};
   const syncMute=()=>{mute.textContent=v.muted?'🔇':'🔊';mute.setAttribute('aria-label',v.muted?'Unmute video':'Mute video')};
   play.addEventListener('click',e=>{e.stopPropagation();if(v.paused){v.muted=false;v.play().catch(()=>{v.muted=true;syncMute();v.play().catch(()=>{})})}else v.pause();showControls(player)});
   mute.addEventListener('click',e=>{e.stopPropagation();v.muted=!v.muted;if(!v.muted&&v.paused)v.play().catch(()=>{});syncMute();showControls(player)});
   seek.addEventListener('input',()=>{if(Number.isFinite(v.duration)&&v.duration>0)v.currentTime=Number(seek.value)/1000*v.duration;showControls(player)});
   const update=()=>{if(!seek.matches(':active')&&Number.isFinite(v.duration)&&v.duration>0)seek.value=String(Math.round(v.currentTime/v.duration*1000));time.textContent=fmt(v.currentTime)+' / '+fmt(v.duration)};
   v.addEventListener('timeupdate',update);v.addEventListener('loadedmetadata',update);v.addEventListener('durationchange',update);v.addEventListener('play',()=>{syncPlay();syncMute()});v.addEventListener('pause',syncPlay);v.addEventListener('volumechange',syncMute);
  }
  let timer;function showControls(target){target.classList.add('joint-controls-visible');clearTimeout(timer);timer=setTimeout(()=>target.classList.remove('joint-controls-visible'),3200)}
  // Capture first so legacy page handlers cannot re-enable native Download/Playback speed controls.
  v.addEventListener('click',e=>{e.stopImmediatePropagation();showControls(player);if(v.paused){v.muted=false;v.play().catch(()=>{v.muted=true;v.play().catch(()=>{})})}else if(v.muted){/* A tap is a user gesture: restore sound unless the user explicitly mutes again. */v.muted=false}},true);
  v.addEventListener('contextmenu',e=>e.preventDefault());
  v.controls=false;
 }
 function scan(root=document){if(root instanceof HTMLVideoElement)setup(root);root.querySelectorAll?.('video').forEach(setup)}
 function start(){scan();new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.documentElement,{childList:true,subtree:true});
  if('IntersectionObserver'in window){const io=new IntersectionObserver(entries=>entries.forEach(e=>{const v=e.target;if(e.isIntersecting&&e.intersectionRatio>=.6){document.querySelectorAll('video').forEach(other=>{if(other!==v)other.pause()});v.play().catch(()=>{if(!v.isConnected)return;v.muted=true;v.play().catch(()=>{})})}else if(v.isConnected)v.pause()}),{threshold:[0,.6,1]});const observe=()=>document.querySelectorAll('video').forEach(v=>{if(v.dataset.jointVideoObserved!=='1'){v.dataset.jointVideoObserved='1';io.observe(v)}});observe();new MutationObserver(observe).observe(document.body,{childList:true,subtree:true})}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
