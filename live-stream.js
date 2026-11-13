/* JOINT Live only. Independent of the JOINT Meetings implementation. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { db:null, user:null, session:null, participant:null, channel:null, pc:null, localStream:null, remoteStream:null, role:null, makingOffer:false, activityCount:0, reactionCount:0, giftCount:0, giftDiamondTotal:0, presenceChannel:null, giftAnimationUntil:0, selectedGift:null, sfuSessionId:null, sfuPeer:null, sfuRole:null, targetSessionId:null, sfuSubscribedPublishers:new Set(), sfuSubscribePending:new Set(), sfuSubscribeQueue:Promise.resolve(), sfuOperationQueue:Promise.resolve(), remotePublisherInProgress:null, guestPresenceTimer:null, eventCache:[], publisherPollTimer:null, commentProfileCache:new Map(), localVideoSender:null, guestWasPresent:false, rotatingInviteCode:false, restoreAttempted:false, initPromise:null, foregroundRecoveryPromise:null, wasDocumentHidden:false, lastForegroundRecoveryAt:0, mediaStartPromise:null, hostTabOwner:false, hostSessionInOtherTab:null, hostTabHeartbeat:null, isRestoringHost:false };
  // Cloudflare Calls has one SDP offer/answer state machine per SFU session.
  // Serialize complete publish/subscribe/renegotiate transactions, not merely
  // individual HTTP requests, so a second tracks/new cannot race an unanswered offer.
  function enqueueSfuMutation(operation){
    const task=state.sfuOperationQueue.then(operation,operation);
    state.sfuOperationQueue=task.catch(()=>{});
    return task;
  }
  function closeSfuConnection(){return enqueueSfuMutation(async()=>{if(state.sfuSessionId&&state.session)await sfuCall('close');});}
  function waitForSignalingStable(pc,timeout=8000){
    if(!pc||pc.signalingState==='closed')return Promise.reject(new Error('The live connection is closed. Rejoin the live room.'));
    if(pc.signalingState==='stable')return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);pc.removeEventListener('signalingstatechange',check);error?reject(error):resolve();};
      const check=()=>{if(pc.signalingState==='stable')finish();else if(pc.signalingState==='closed')finish(new Error('The live connection closed during WebRTC negotiation.'))};
      const timer=setTimeout(()=>finish(new Error('WebRTC negotiation did not return to a stable state. Please retry joining the live.')),timeout);
      pc.addEventListener('signalingstatechange',check);check();
    });
  }
  // A host broadcast must have exactly one browser-tab owner. The previous
  // navigation flow intentionally opens JOINT sections in another tab; without
  // this lease, the new tab also restored the host session and opened a second
  // camera/microphone + Cloudflare publisher.
  const hostTabToken = (()=>{
    try{
      let token=sessionStorage.getItem('joint_live_host_tab_token');
      if(!token){token=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));sessionStorage.setItem('joint_live_host_tab_token',token);}
      return token;
    }catch(_){return crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random();}
  })();
  const hostTabLeaseMs=180000;
  function hostTabLockKey(){return 'joint_live_host_tab_lock_'+String(state.user?.id||'');}
  function readHostTabLock(){
    try{const raw=localStorage.getItem(hostTabLockKey());return raw?JSON.parse(raw):null;}catch(_){return null;}
  }
  function writeHostTabLock(sessionId){
    try{localStorage.setItem(hostTabLockKey(),JSON.stringify({owner:hostTabToken,session_id:sessionId||null,updated_at:Date.now()}));return true;}catch(_){return false;}
  }
  function startHostTabHeartbeat(){
    if(state.hostTabHeartbeat)clearInterval(state.hostTabHeartbeat);
    state.hostTabHeartbeat=setInterval(()=>{
      if(!state.hostTabOwner)return;
      const lock=readHostTabLock();
      if(lock?.owner&&lock.owner!==hostTabToken){
        state.hostTabOwner=false;clearInterval(state.hostTabHeartbeat);state.hostTabHeartbeat=null;
        console.warn('This JOINT Live tab no longer owns the host media session.');return;
      }
      writeHostTabLock(state.session?.id||lock?.session_id||null);
    },15000);
  }
  function claimHostTabLock(sessionId){
    const now=Date.now(),lock=readHostTabLock();
    if(lock?.owner&&lock.owner!==hostTabToken&&now-Number(lock.updated_at||0)<hostTabLeaseMs)return false;
    if(!writeHostTabLock(sessionId))return false;
    state.hostTabOwner=true;state.hostSessionInOtherTab=null;startHostTabHeartbeat();return true;
  }
  function releaseHostTabLock(){
    if(state.hostTabHeartbeat){clearInterval(state.hostTabHeartbeat);state.hostTabHeartbeat=null;}
    try{const lock=readHostTabLock();if(!lock?.owner||lock.owner===hostTabToken)localStorage.removeItem(hostTabLockKey());}catch(_){}
    state.hostTabOwner=false;
  }
  function ensureLocalPreview(stream){
    const grid=$('live-video-grid');if(!grid||!stream)return;
    let tile=grid.querySelector('.live-video-tile.local');
    let video=tile?.querySelector('video');
    if(!video){video=addVideo('live-video-grid','You',stream,true);}
    else if(video.srcObject!==stream)video.srcObject=stream;
    video.muted=true;video.playsInline=true;
    video.play().catch(()=>{});
  }
  const show = (id, message, error=false) => { const el=$(id); if(!el) return; el.textContent=message; el.classList.add('show'); el.style.background=error?'#fff0f0':''; el.style.color=error?'#a52834':''; };
  const setStatus = (message, error=false) => { const el=$('live-call-status'); if(el){el.textContent=message;el.style.color=error?'#a52834':'';} };
  const randomCode = () => { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes=new Uint8Array(8); crypto.getRandomValues(bytes); return Array.from(bytes,b=>chars[b%chars.length]).join(''); };
  async function getDb(){
    if (window.jointSupabaseConnection) return await window.jointSupabaseConnection;
    await new Promise((resolve,reject)=>{ const script=document.createElement('script'); script.src='./supabase.js'; script.onload=()=>window.jointSupabaseConnection?resolve():reject(new Error('JOINT Supabase did not initialize.')); script.onerror=()=>reject(new Error('Could not load supabase.js.')); document.head.appendChild(script); });
    return await window.jointSupabaseConnection;
  }
  async function init(){
    if(state.initPromise)return state.initPromise;
    state.initPromise=(async()=>{
      state.db=await getDb();
      const {data,error}=await state.db.auth.getUser();
      if(error || !data?.user) throw new Error('Please sign in to JOINT before hosting or joining a live stream.');
      state.user=data.user;
      // Session restoration is best-effort and must never block unrelated Live
      // features such as public discovery, search, join requests, or recaps.
      try{await restoreHostSessionOnReturn();}
      catch(recoveryError){
        console.warn('JOINT Live session recovery could not complete; continuing normal initialization:',recoveryError);
        state.restoreAttempted=false;
      }
    })();
    try{return await state.initPromise;}
    catch(error){state.initPromise=null;throw error;}
  }
  function openCall(){ $('live-call-panel').hidden=false; $('live-call-panel').scrollIntoView({behavior:'smooth',block:'start'}); }
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function updateHostEngagementStats(){
    const wrap=$('live-host-engagement-stats'); if(!wrap)return;
    const reactions=wrap.querySelector('[data-host-reactions]');
    const gifts=wrap.querySelector('[data-host-gifts]');
    const diamonds=wrap.querySelector('[data-host-diamonds]');
    if(reactions)reactions.textContent=String(state.reactionCount);
    if(gifts)gifts.textContent=String(state.giftCount);
    if(diamonds)diamonds.textContent=state.giftDiamondTotal.toLocaleString();
  }
  function updateStageLayout(){
    const grid=$('live-video-grid');if(!grid)return;
    const tiles=[...grid.querySelectorAll('.live-video-tile')];
    const two=tiles.length>1;
    grid.classList.toggle('viewer-two-streams',state.role==='viewer'&&two);
    grid.classList.toggle('live-two-participants',state.role!=='viewer'&&two);
  }
  function updateStreamerOverlays(){
    const grid=$('live-video-grid');if(!grid)return;
    const viewers=Number((($('live-viewer-count')?.textContent||'').match(/\d+/)||['0'])[0]);
    for(const tile of grid.querySelectorAll('.live-video-tile')){
      let overlay=tile.querySelector('.live-streamer-support-overlay');
      if(!overlay){overlay=document.createElement('div');overlay.className='live-streamer-support-overlay';tile.append(overlay);}
      const ownerId=tile.dataset.userId||'';
      const events=state.eventCache||[];
      const received=events.filter(e=>e.kind==='gift'&&(e.recipient_user_id===ownerId||( !e.recipient_user_id && ownerId===state.session?.host_user_id)));
      const diamonds=received.reduce((n,e)=>n+Number(e.diamond_value||0),0);
      const reactions=events.filter(e=>e.kind==='reaction').length;
      overlay.textContent='🎁 '+received.length+'  ·  💎 '+diamonds.toLocaleString()+'  ·  ✨ '+reactions+'  ·  👁 '+viewers;
    }
    updateStageLayout();
  }
  async function loadHostEngagementStats(){
    if(!state.db||!state.session)return;
    try{
      const {data,error}=await state.db.rpc('joint_live_get_engagement_totals',{p_session_id:state.session.id});
      if(error)throw error;
      state.eventCache=Array.isArray(data?.events)?data.events:[];
      state.reactionCount=state.eventCache.filter(e=>e.kind==='reaction').length;
      const gifts=state.eventCache.filter(e=>e.kind==='gift'&&(e.recipient_user_id===state.user.id||(!e.recipient_user_id&&state.user.id===state.session.host_user_id)));
      state.giftCount=gifts.length;state.giftDiamondTotal=gifts.reduce((n,e)=>n+Number(e.diamond_value||0),0);
      updateHostEngagementStats();updateStreamerOverlays();
    }catch(e){console.warn('Live engagement totals could not be loaded',e);}
  }
  function giftStyle(name){
    const n=String(name||'').toLowerCase();
    if(/christmas|winter|snow/.test(n))return 'snow';
    if(/valentine|rose|love/.test(n))return 'love';
    if(/easter|spring/.test(n))return 'spring';
    if(/birthday|cake/.test(n))return 'birthday';
    if(/confetti|party|dance/.test(n))return 'party';
    if(/firework|champagne|victory|trophy/.test(n))return 'fireworks';
    if(/dragon|phoenix|royal|throne/.test(n))return 'legendary';
    return 'cosmic';
  }
  function appendActivity(item, animate=true){
    const feed=$('live-activity-feed'); if(!feed)return;
    if(feed.children.length===1 && feed.textContent.includes('Live activity will appear here'))feed.replaceChildren();
    const row=document.createElement('div');row.className='live-feed-item'+(item.kind==='gift'?' gift':'');
    const emoji=document.createElement('span');emoji.className='live-feed-emoji';emoji.textContent=item.emoji|| (item.kind==='gift'?'🎁':'✨');
    const text=document.createElement('span');
    if(item.kind==='gift') text.textContent=(item.sender||'A JOINT member')+' sent '+(item.gift_name||'a gift')+(item.diamond_value?' · '+Number(item.diamond_value).toLocaleString()+' Diamonds':'');
    else text.textContent=(item.sender||'A JOINT member')+' reacted '+(item.reaction||'✨');
    row.append(emoji,text);feed.prepend(row);while(feed.children.length>30)feed.lastElementChild.remove();
    const tiles=[...($('live-video-grid')?.querySelectorAll('.live-video-tile')||[])];
    if(item.kind==='gift'){
      state.giftAnimationUntil=Date.now()+5200;
      tiles.forEach(tile=>{const overlay=document.createElement('div');overlay.className='live-stage-overlay live-gift-cinema-scene';const floater=document.createElement('div');floater.className='live-floating-gift gift-style-'+giftStyle(item.gift_name);const icon=document.createElement('b');icon.textContent=item.emoji||'🎁';const label=document.createElement('span');const sender=document.createElement('small');sender.className='live-gift-sender';sender.textContent='@'+String(item.sender||'JOINT member').trim().replace(/^@+/, '');const title=document.createElement('strong');title.className='live-gift-title';title.textContent=item.gift_name||'JOINT Gift';const value=document.createElement('small');value.className='live-gift-value';value.textContent=Number(item.diamond_value||0).toLocaleString()+' Diamonds';label.append(sender,title,value);floater.append(icon,label);overlay.append(floater);
      // The selected gift becomes a transparent mini-cinematic: fragments converge, form the gift, then burst outward.
      const particles=document.createElement('span');particles.className='live-gift-film-particles';for(let i=0;i<26;i++){const dot=document.createElement('i');const angle=Math.random()*Math.PI*2;const distance=55+Math.random()*Math.min(220,Math.max(95,tile.clientWidth*.42));dot.style.setProperty('--px',(50+(Math.random()-.5)*12)+'%');dot.style.setProperty('--py',(46+(Math.random()-.5)*12)+'%');dot.style.setProperty('--size',(3+Math.random()*6)+'px');dot.style.setProperty('--burst-x',(Math.cos(angle)*distance*.55)+'px');dot.style.setProperty('--burst-y',(Math.sin(angle)*distance*.55)+'px');dot.style.setProperty('--end-x',(Math.cos(angle)*distance)+'px');dot.style.setProperty('--end-y',(Math.sin(angle)*distance)+'px');dot.style.animationDelay=(Math.random()*.5)+'s';particles.append(dot);}overlay.append(particles);
      const shards=['✦','✧','✺',item.emoji||'🎁', '✧','✦'];for(let i=0;i<shards.length;i++){const shard=document.createElement('span');shard.className='live-gift-shard';shard.textContent=shards[i];const angle=(Math.PI*2*i/shards.length)+(Math.random()*.35);const from=100+Math.random()*170;const to=70+Math.random()*Math.min(150,tile.clientWidth*.3);shard.style.setProperty('--from-x',(Math.cos(angle)*from)+'px');shard.style.setProperty('--from-y',(Math.sin(angle)*from)+'px');shard.style.setProperty('--to-x',(Math.cos(angle)*to)+'px');shard.style.setProperty('--to-y',(Math.sin(angle)*to)+'px');shard.style.setProperty('--spin',(Math.random()>.5?'':'-')+(30+Math.random()*220)+'deg');shard.style.setProperty('--shard-size',(1.1+Math.random()*2.4)+'rem');shard.style.animationDelay=(Math.random()*.24)+'s';overlay.append(shard);}const spark=document.createElement('span');spark.className='live-gift-spark';spark.textContent='✧';overlay.append(spark);tile.append(overlay);setTimeout(()=>overlay.remove(),6000);});
    } else if(Date.now()>=state.giftAnimationUntil){
      // Reactions float over the video without adding an opaque card/background.
      // Animate on each visible participant tile so the host and viewers can see them.
      tiles.forEach(tile=>{
        let layer=tile.querySelector('.live-stage-reaction-layer');
        if(!layer){layer=document.createElement('div');layer.className='live-stage-reaction-layer';tile.append(layer);}
        const floater=document.createElement('span');
        floater.className='live-floating-reaction';
        floater.style.setProperty('--x',(15+Math.random()*70)+'%');
        floater.textContent=item.reaction||item.emoji||'✨';
        layer.append(floater);setTimeout(()=>floater.remove(),2400);
      });
    }
    if(item.kind==='gift'&&(item.recipient_user_id===state.user?.id||(!item.recipient_user_id&&state.user?.id===state.session?.host_user_id))){state.giftCount++;state.giftDiamondTotal+=Number(item.diamond_value||0);}else if(item.kind==='reaction')state.reactionCount++;
    // Gift RPCs already persist the event, but their return payload may not include its row id.
    // Keep the live-stage cache updated from the confirmed payment/broadcast so the tiny
    // per-streamer counters immediately show gifts and Diamonds instead of staying at zero.
    if(item.id){if(!state.eventCache.some(e=>e.id===item.id))state.eventCache.push(item);}
    else state.eventCache.push({...item,_liveLocalKey:[item.kind,item.user_id,item.recipient_user_id,item.gift_name,item.diamond_value,Date.now()].join(':')});
    updateHostEngagementStats();updateStreamerOverlays();
    state.activityCount++;
  }
  async function recordActivity(item){
    if(!state.db||!state.session||!state.user)throw new Error('Join a live room before reacting or sending a gift.');
    const profileName=state.user.user_metadata?.full_name||state.user.user_metadata?.name||state.user.email?.split('@')[0]||'JOINT member';
    let data;
    if(item.kind==='reaction'){
      const {data: saved,error}=await state.db.rpc('joint_live_record_reaction',{p_session_id:state.session.id,p_reaction:item.reaction||item.emoji||'✨'});
      if(error)throw new Error('Reaction could not be saved. Apply the JOINT Live reactions SQL migration. '+error.message);
      data=(saved&&saved.event)||saved;if(data?.ok===false)throw new Error(data.error||'Reaction was not saved.');
    }else{
      const payload={session_id:state.session.id,user_id:state.user.id,kind:item.kind,reaction:item.reaction||null,gift_name:item.gift_name||null,gift_emoji:item.emoji||null,diamond_value:item.diamond_value||0,recipient_user_id:item.recipient_user_id||null};
      const {data:saved,error}=await state.db.from('joint_live_events').insert(payload).select('id,kind,reaction,gift_name,gift_emoji,diamond_value,recipient_user_id,created_at').single();
      if(error)throw new Error('Could not save live activity. '+error.message);data=saved;
    }
    const event={...(data||{}),kind:item.kind,emoji:item.emoji||data?.gift_emoji||item.reaction,sender:profileName,user_id:state.user.id};
    appendActivity(event);
    if(state.channel)await state.channel.send({type:'broadcast',event:'live-activity',payload:{...event,from:state.user.id}});
    show('live-engagement-notice',item.kind==='gift'?'Gift recorded in this live session.':'Reaction recorded in this live session.');
  }
  async function loadRecaps(){
    const list=$('live-recap-list');if(!list)return;
    try{
      await init();
      const {data: sessions,error}=await state.db.from('joint_live_sessions').select('id,title,description,status,started_at,ended_at,host_user_id,room_code').eq('status','ended').order('ended_at',{ascending:false}).limit(30);
      if(error)throw error;
      const own=(sessions||[]).filter(s=>s.host_user_id===state.user.id);
      if(!own.length){list.innerHTML='<div class="live-summary-empty"><div class="live-icon" aria-hidden="true">▤</div><div><strong>No completed live recaps yet</strong><p>After you end a live session, its recap and engagement totals will appear here.</p></div></div>';return;}
      list.replaceChildren();
      for(const session of own){
        const {data: events}=await state.db.from('joint_live_events').select('kind,diamond_value').eq('session_id',session.id);
        const all=events||[], gifts=all.filter(e=>e.kind==='gift'), reactions=all.filter(e=>e.kind==='reaction');
        const duration=session.started_at&&session.ended_at?Math.max(0,Math.round((new Date(session.ended_at)-new Date(session.started_at))/60000)):0;
        const card=document.createElement('article');card.className='live-recap-item';
        const title=document.createElement('strong');title.textContent=session.title||'JOINT Live session';
        const desc=document.createElement('p');desc.textContent=(session.ended_at?new Date(session.ended_at).toLocaleString():'Completed session')+' · '+duration+' min';
        const stats=document.createElement('div');stats.className='live-recap-stats';
        [['🎁 '+gifts.length+' gifts'],['✨ '+reactions.length+' reactions'],['🎁 '+gifts.reduce((n,e)=>n+Number(e.diamond_value||0),0)+' gift-value points']].forEach(([t])=>{const span=document.createElement('span');span.textContent=t;stats.append(span);});
        card.append(title,desc,stats);list.append(card);
      }
    }catch(err){console.warn('JOINT Live recaps unavailable',err);list.innerHTML='<div class="live-summary-empty"><div class="live-icon" aria-hidden="true">▤</div><div><strong>Live recaps need database setup</strong><p>Apply the updated JOINT Live SQL migration to store session activity and summaries.</p></div></div>';}
  }
  function addVideo(id,label,stream,muted=false){
    const wrap=document.createElement('div'); wrap.className='live-video-tile'+(label==='You'?' local':'');if(label==='You'&&state.user)wrap.dataset.userId=state.user.id;
    const video=document.createElement('video'); video.autoplay=true; video.playsInline=true; video.muted=muted; video.srcObject=stream;
    const tag=document.createElement('span'); tag.className='live-video-label'; tag.textContent=label;
    wrap.append(video,tag); $(id).appendChild(wrap); return video;
  }
  async function startMediaOnce(options={}){
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires HTTPS and a supported browser.');
    const existing=state.localStream;
    const existingTracks=existing?.getTracks?.()||[];
    const existingHealthy=existingTracks.some(t=>t.kind==='video'&&t.readyState==='live'&&t.enabled)&&existingTracks.some(t=>t.kind==='audio'&&t.readyState==='live'&&t.enabled);
    if(!options.replaceExisting&&existingHealthy){ensureLocalPreview(existing);return existing;}
    const previous=state.localStream;
    // Stop the old capture before opening another one. This avoids overlapping
    // Android camera/microphone capture sessions during a foreground recovery.
    if(previous){previous.getTracks().forEach(track=>{try{track.stop();}catch(_){}});state.localStream=null;}
    const facing=state.cameraFacing||'user';
    const freshStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}},audio:true});
    state.localStream=freshStream;
    const grid=$('live-video-grid');
    if(grid){
      grid.querySelectorAll('audio[data-live-remote-audio]').forEach(audio=>{audio.pause();audio.srcObject=null;audio.remove();});
      grid.querySelectorAll('.live-video-tile.remote').forEach(tile=>tile.remove());
      grid.querySelectorAll('.live-video-tile.local').forEach(tile=>tile.remove());
      const preview=addVideo('live-video-grid','You',state.localStream,true);
      try{await preview.play();}catch(playError){console.warn('Live camera preview needs a user gesture to play',playError);}
    }
    return freshStream;
  }
  async function startMedia(options={}){
    if(state.mediaStartPromise)return state.mediaStartPromise;
    state.mediaStartPromise=startMediaOnce(options).finally(()=>{state.mediaStartPromise=null;});
    return state.mediaStartPromise;
  }

  async function resumeHostMediaAfterReturn(){
    if(state.role!=='host'||!state.session||!state.user||state.isRestoringHost||!state.hostTabOwner)return;
    if(state.foregroundRecoveryPromise)return state.foregroundRecoveryPromise;
    const now=Date.now();
    if(now-state.lastForegroundRecoveryAt<2500)return;
    state.lastForegroundRecoveryAt=now;
    state.foregroundRecoveryPromise=(async()=>{
      const stream=state.localStream;
      const videoTrack=stream?.getVideoTracks?.()[0];
      const audioTrack=stream?.getAudioTracks?.()[0];
      const peer=state.sfuPeer;
      const tracksHealthy=!!videoTrack&&videoTrack.readyState==='live'&&videoTrack.enabled&&
        !!audioTrack&&audioTrack.readyState==='live'&&audioTrack.enabled;
      const peerHealthy=!!peer&&peer.connectionState==='connected'&&peer.iceConnectionState!=='failed';
      if(peerHealthy&&tracksHealthy){ensureLocalPreview(stream);return;}
      setStatus('Welcome back. Restoring your existing live connection…');
      // Close the previous Cloudflare publication before replacing the peer.
      // The Edge Function resolves the user's stored SFU connection, so this
      // also cleans up a publisher left behind by a suspended Android tab.
      try{if(state.sfuSessionId)await closeSfuConnection();}catch(closeError){console.warn('Could not close the previous JOINT Live SFU connection before recovery',closeError);}
      try{peer?.close();}catch(_){}
      state.sfuPeer=null;state.sfuSessionId=null;state.localVideoSender=null;
      state.sfuSubscribedPublishers.clear();state.sfuSubscribePending.clear();
      // Reuse healthy camera/microphone tracks. Only ask Android for a new
      // capture when the existing tracks have actually ended or been disabled.
      if(tracksHealthy)ensureLocalPreview(stream);
      else await startMedia({replaceExisting:true});
      await publishToSfu();
      await subscribeToSfuPublishers();
      if(state.channel)await state.channel.send({type:'broadcast',event:'live-publisher-ready',payload:{user_id:state.user.id,from:state.user.id,media_restarted_at:Date.now()}});
      setStatus('Your existing live is restored. Continue streaming or end it when finished.');
    })().catch(error=>{
      console.warn('JOINT Live camera/video resume failed',error);
      setStatus('Your live session is still active, but video could not resume: '+(error?.message||'Check camera permission and network, then return to Live.'),true);
    }).finally(()=>{state.foregroundRecoveryPromise=null;});
    return state.foregroundRecoveryPromise;
  }

  async function switchLiveCamera(){
    if(!state.localStream||!['host','guest'].includes(state.role))return;
    const current=state.localStream.getVideoTracks()[0];
    if(!current){show('live-engagement-notice','No active camera track is available.',true);return;}
    const button=$('live-viewer-count');
    if(button)button.disabled=true;
    let replacementStream=null;
    try{
      const devices=await navigator.mediaDevices.enumerateDevices();
      const cameras=devices.filter(device=>device.kind==='videoinput');
      const currentId=current.getSettings?.().deviceId||'';
      const currentDevice=cameras.find(device=>device.deviceId===currentId);
      const currentLabel=(currentDevice?.label||'').toLowerCase();
      const wantsRear=state.cameraFacing!=='environment';
      const rear=cameras.find(device=>/back|rear|environment|world/.test((device.label||'').toLowerCase()));
      const front=cameras.find(device=>/front|user|facetime|selfie/.test((device.label||'').toLowerCase()));
      let target=null;
      if(wantsRear)target=rear&&rear.deviceId!==currentId?rear:null;
      else target=front&&front.deviceId!==currentId?front:null;
      if(!target)target=cameras.find(device=>device.deviceId&&device.deviceId!==currentId)||null;

      if(target?.deviceId){
        replacementStream=await navigator.mediaDevices.getUserMedia({
          video:{deviceId:{exact:target.deviceId},width:{ideal:1280},height:{ideal:720}},
          audio:false
        });
      }else{
        const nextFacing=wantsRear?'environment':'user';
        try{
          replacementStream=await navigator.mediaDevices.getUserMedia({
            video:{facingMode:{exact:nextFacing},width:{ideal:1280},height:{ideal:720}},
            audio:false
          });
        }catch(exactError){
          replacementStream=await navigator.mediaDevices.getUserMedia({
            video:{facingMode:{ideal:nextFacing},width:{ideal:1280},height:{ideal:720}},
            audio:false
          });
        }
      }
      const replacement=replacementStream?.getVideoTracks()[0];
      if(!replacement)throw new Error('The selected camera is unavailable. Check camera permission and try again.');

      const sender=state.localVideoSender||state.sfuPeer?.getSenders().find(item=>item.track?.kind==='video');
      if(!sender)throw new Error('The live video publishing connection is not ready. Please try again in a moment.');
      await sender.replaceTrack(replacement);

      state.localStream.removeTrack(current);
      state.localStream.addTrack(replacement);
      const localVideo=$('live-video-grid')?.querySelector('.live-video-tile.local video');
      if(localVideo){
        localVideo.srcObject=state.localStream;
        try{await localVideo.play();}catch(playError){console.warn('Local preview autoplay was blocked',playError);}
      }
      current.stop();
      const newLabel=(replacement.getSettings?.().facingMode||target?.label||'').toLowerCase();
      state.cameraFacing=/environment|back|rear|world/.test(newLabel)?'environment':
        /user|front|facetime|selfie/.test(newLabel)?'user':(wantsRear?'environment':'user');
      if(button){
        button.title=state.cameraFacing==='environment'?'Using back camera · tap to switch to front':'Using front camera · tap to switch to back';
        button.setAttribute('aria-label',button.title);
      }
      show('live-engagement-notice',state.cameraFacing==='environment'?'Back camera enabled.':'Front camera enabled.');
    }catch(error){
      replacementStream?.getTracks().forEach(track=>track.stop());
      console.warn('JOINT Live camera switch failed',error);
      show('live-engagement-notice',error?.message||'Could not switch camera. Check camera permissions and try again.',true);
    }finally{if(button)button.disabled=!(state.role==='host'||state.role==='guest');}
  }
  async function sfuCall(action, extra={}){
    const {data:{session}}=await state.db.auth.getSession();
    if(!session?.access_token)throw new Error('Your JOINT sign-in expired. Please sign in again.');
    const {data,error}=await state.db.functions.invoke('joint-live-sfu',{body:{action,live_session_id:state.session?.id,room_code:state.session?.room_code,...extra}});
    if(error){
      // Supabase's generic "non-2xx" message hides the actual Edge Function
      // response. Surface the server's safe JSON error so a guest knows whether
      // the failure is authorization, TURN, participant state, or Cloudflare.
      let detail=error.message||'JOINT Live SFU request failed.';
      try{
        const response=error.context?.clone?error.context.clone():error.context;
        const payload=response?.json?await response.json():null;
        if(payload?.error||payload?.message)detail=payload.error||payload.message;
        if(response?.status)detail+=' (HTTP '+response.status+')';
      }catch(_){ }
      throw new Error(detail);
    }
    if(!data||data.ok===false)throw new Error(data?.error||data?.errorDescription||'JOINT Live SFU request failed.');
    return data;
  }
  function waitForIce(pc, timeout=10000){
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};const check=()=>{if(pc.iceGatheringState==='complete')finish();};const timer=setTimeout(finish,timeout);pc.addEventListener('icegatheringstatechange',check);});
  }
  function waitForPeerConnected(pc,timeout=18000){
    if(pc.connectionState==='connected'||pc.iceConnectionState==='connected'||pc.iceConnectionState==='completed')return Promise.resolve();
    if(pc.connectionState==='failed'||pc.iceConnectionState==='failed')return Promise.reject(new Error('WebRTC could not establish a media route. Check your internet connection and Cloudflare TURN configuration.'));
    return new Promise((resolve,reject)=>{
      let done=false;
      const cleanup=()=>{clearTimeout(timer);pc.removeEventListener('connectionstatechange',check);pc.removeEventListener('iceconnectionstatechange',check);};
      const finish=(error)=>{if(done)return;done=true;cleanup();error?reject(error):resolve();};
      const check=()=>{
        if(pc.connectionState==='connected'||pc.iceConnectionState==='connected'||pc.iceConnectionState==='completed')finish();
        else if(pc.connectionState==='failed'||pc.iceConnectionState==='failed')finish(new Error('WebRTC connection failed (connection: '+pc.connectionState+', ICE: '+pc.iceConnectionState+'). Check mobile data/Wi-Fi and TURN connectivity.'));
      };
      const timer=setTimeout(()=>finish(new Error('The camera and microphone are enabled, but Cloudflare media transport did not connect within 18 seconds (connection: '+pc.connectionState+', ICE: '+pc.iceConnectionState+'). Configure Cloudflare TURN credentials and try again.')),timeout);
      pc.addEventListener('connectionstatechange',check);
      pc.addEventListener('iceconnectionstatechange',check);
      check();
    });
  }
  async function resumeLivePlaybackFromGesture(){
    const grid=$('live-video-grid');
    if(!grid)return;
    const media=[...grid.querySelectorAll('video,audio[data-live-remote-audio]')];
    for(const element of media){
      if(element instanceof HTMLVideoElement&&element.muted)continue;
      try{await element.play();}catch(error){console.debug('Live playback still waiting for browser permission',error?.message||error);}
    }
  }
  $('live-video-grid')?.addEventListener('click',()=>{resumeLivePlaybackFromGesture();});
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)resumeLivePlaybackFromGesture();
  });

  function attachRemoteTrack(event, label='Live host', publisherId=null){
    const grid=$('live-video-grid');
    if(!grid||!event.track)return;
    const pendingPublishers=[...(state.sfuSubscribePending||[])];
    const ownerId=publisherId||state.remotePublisherInProgress||(pendingPublishers.length===1?pendingPublishers[0]:'');
    // Reuse one hidden audio element per publisher. A replacement audio track
    // must replace the old source, never create another media element.
    if(event.track.kind==='audio'){
      let audio=[...grid.querySelectorAll('audio[data-live-remote-audio]')].find(a=>(ownerId&&a.dataset.userId===ownerId)||a.dataset.trackId===event.track.id);
      if(!audio){audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.dataset.liveRemoteAudio='1';audio.style.display='none';grid.append(audio);}
      audio.dataset.trackId=event.track.id;if(ownerId)audio.dataset.userId=ownerId;
      audio.srcObject=new MediaStream([event.track]);audio.play().catch(()=>{});return;
    }
    if(event.track.kind!=='video')return;
    const stream=event.streams?.[0] || new MediaStream([event.track]);
    const streamKey=stream.id || event.track.id;
    // Track IDs and MediaStream IDs change after reconnects. The publisher's
    // JOINT user ID is the stable identity, so it takes precedence for dedupe.
    let tile=[...grid.querySelectorAll('.live-video-tile.remote')].find(node=>(ownerId&&node.dataset.userId===ownerId)||node.dataset.trackId===event.track.id||node.dataset.streamKey===streamKey);
    if(!tile){
      tile=document.createElement('div');tile.className='live-video-tile remote';
      const v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.controls=false;v.muted=false;
      const tag=document.createElement('span');tag.className='live-video-label';tag.textContent=label;
      tile.append(v,tag);grid.append(tile);
    }
    tile.dataset.streamKey=streamKey;tile.dataset.trackId=event.track.id;if(ownerId)tile.dataset.userId=ownerId;
    const video=tile.querySelector('video');
    if(video.srcObject!==stream)video.srcObject=stream;
    const panel=$('live-call-panel');
    if(state.role==='viewer')panel?.classList.add('viewer-mode');else panel?.classList.remove('viewer-mode');
    updateStageLayout();updateStreamerOverlays();
    video.play().catch(()=>setStatus('Live is connected. Tap the video to start playback if your browser blocks autoplay.'));
  }
  async function createSfuConnection(role){
    state.sfuRole=role;
    const created=await sfuCall('create-session');state.sfuSessionId=created.session_id;
    const iceServers=Array.isArray(created.iceServers)&&created.iceServers.length
      ?created.iceServers:[{urls:'stun:stun.cloudflare.com:3478'}];
    if(!iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>String(url||'').startsWith('turn')))){
      console.warn('JOINT Live is using STUN only. Configure Cloudflare TURN secrets for reliable mobile-network connectivity.');
    }
    const pc=new RTCPeerConnection({iceServers});
    state.sfuPeer=pc;
    pc.ontrack=e=>attachRemoteTrack(e,role==='viewer'?'Live stream':'Live partner',state.remotePublisherInProgress);
    pc.onconnectionstatechange=()=>{
      const status=({connected:'Connected — live video is running.',connecting:'Connecting live video…',disconnected:'Video connection interrupted. Waiting to reconnect…',failed:'Connection failed. Check mobile data/Wi-Fi and retry the live stream.',closed:'Live connection ended.'})[pc.connectionState]||'Setting up live connection…';
      setStatus(status,pc.connectionState==='failed');
    };
    return pc;
  }
  async function publishToSfuNow(){
    if(!state.localStream||!state.localStream.getTracks().some(track=>track.readyState==='live')){
      await startMedia({replaceExisting:true});
    }
    const liveTracks=state.localStream.getTracks().filter(track=>track.readyState==='live'&&track.enabled);
    if(!liveTracks.some(track=>track.kind==='video'))throw new Error('Your camera is not producing a live video track. Allow camera access and try again.');
    if(!liveTracks.some(track=>track.kind==='audio'))throw new Error('Your microphone is not producing a live audio track. Allow microphone access and try again.');
    const pc=await createSfuConnection(state.role==='host'?'host':'guest');
    const tracks=[];
    for(const track of liveTracks){
      const transceiver=pc.addTransceiver(track,{direction:'sendonly',streams:[state.localStream]});
      if(track.kind==='video')state.localVideoSender=transceiver.sender;
      tracks.push({location:'local',mid:transceiver.mid,trackName:track.kind==='audio'?'microphone':'camera'});
    }
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);
    // RTCSessionDescription is a browser object; explicitly copy its fields
    // into a plain JSON object before sending through Supabase Functions.
    // This prevents browsers/WebViews from serializing it as an empty object.
    const localDescription=pc.localDescription;
    if(!localDescription||localDescription.type!=='offer'||typeof localDescription.sdp!=='string'||!localDescription.sdp.trim()){
      throw new Error('Your browser did not create a valid WebRTC offer. Close the join screen and try again.');
    }
    const localTracks=pc.getTransceivers()
      .filter(t=>t.sender?.track&&t.sender.track.readyState==='live')
      .map(t=>({location:'local',mid:t.mid==null?'':String(t.mid),trackName:t.sender.track.kind==='audio'?'microphone':t.sender.track.kind==='video'?'camera':'screen'}));
    if(!localTracks.length||localTracks.length>4||localTracks.some(t=>!/^\d{1,3}$/.test(t.mid))){
      throw new Error('Your camera/microphone tracks are not ready for the live connection. Please allow both permissions and retry.');
    }
    const published=await sfuCall('publish',{session_description:{type:localDescription.type,sdp:localDescription.sdp},tracks:localTracks});
    if(!published.sessionDescription)throw new Error('Cloudflare did not return a publishing answer.');
    const failed=(published.tracks||[]).filter(track=>track.errorCode||track.error);
    if(failed.length)throw new Error('Cloudflare could not publish '+failed.map(track=>track.trackName||'a media track').join(' and ')+'. Please retry the camera and microphone connection.');
    await pc.setRemoteDescription(published.sessionDescription);
    await waitForPeerConnected(pc);
    return pc;
  }
  function publishToSfu(){return enqueueSfuMutation(publishToSfuNow);}
  async function subscribeToSfuPublishersNow(requestedIds=null){
    const run=async()=>{
      let pc=state.sfuPeer;
      if(!pc)pc=await createSfuConnection(state.role==='viewer'?'viewer':state.role);
      let ids=requestedIds;
      if(!ids){
        const participants=await state.db.from('joint_live_participants').select('user_id,role,status').eq('session_id',state.session.id).eq('status','connected').in('role',['host','guest']);
        if(participants.error)throw participants.error;
        ids=[...new Set([state.session.host_user_id,...(participants.data||[]).map(p=>p.user_id)])];
      }
      const publishers=ids.filter(id=>id&&id!==state.user.id&&!state.sfuSubscribedPublishers.has(id)&&!state.sfuSubscribePending.has(id));
      let subscribed=false;
      for(const publisher_user_id of publishers){
        state.sfuSubscribePending.add(publisher_user_id);
        state.remotePublisherInProgress=publisher_user_id;
        try{
          await waitForSignalingStable(pc);
          let result;
          try{result=await sfuCall('subscribe',{publisher_user_id});}
          catch(err){if(/not published|has not published|preparing|Create your Cloudflare/i.test(err.message))continue;throw err;}
          const needsRenegotiation=result.requiresImmediateRenegotiation===true||result.sessionDescription?.type==='offer';
          if(!needsRenegotiation)continue;
          if(!result.sessionDescription||result.sessionDescription.type!=='offer')throw new Error('Cloudflare requested WebRTC renegotiation but did not return a valid offer.');
          await waitForSignalingStable(pc);
          await pc.setRemoteDescription(result.sessionDescription);
          const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await waitForIce(pc);
          if(!pc.localDescription||pc.localDescription.type!=='answer'||!pc.localDescription.sdp)throw new Error('The browser did not produce a valid answer for the live guest connection.');
          // The next SFU mutation must not start until Cloudflare accepts this answer.
          await sfuCall('renegotiate',{session_description:{type:'answer',sdp:pc.localDescription.sdp}});
          await waitForSignalingStable(pc);
          await waitForPeerConnected(pc);
          state.sfuSubscribedPublishers.add(publisher_user_id);subscribed=true;
        }finally{state.sfuSubscribePending.delete(publisher_user_id);}
      }
      state.remotePublisherInProgress=null;
      if(!subscribed&&state.role==='viewer'&&!state.sfuSubscribedPublishers.size)throw new Error('The host is preparing the stream. Please try joining again in a few seconds.');
    };
    return run();
  }
  function subscribeToSfuPublishers(requestedIds=null){return enqueueSfuMutation(()=>subscribeToSfuPublishersNow(requestedIds));}
  function startPublisherDiscovery(){
    if(state.publisherPollTimer)clearInterval(state.publisherPollTimer);
    // Broadcast notifications are fast, while this small poll covers mobile reconnects
    // and a guest who publishes just before a viewer's channel finishes subscribing.
    state.publisherPollTimer=setInterval(()=>{
      if(!state.session||!state.sfuPeer)return;
      subscribeToSfuPublishers().catch(err=>console.debug('Waiting for live publisher',err?.message||err));
    },3000);
  }
  async function setupEngagementChannel(){
    if(!state.session||!state.db)return;
    try{if(state.channel)await state.db.removeChannel(state.channel);}catch(_){}
    state.channel=state.db.channel('joint-live-engagement-'+state.session.id,{config:{broadcast:{self:false},presence:{key:state.user.id}}});
    state.channel.on('broadcast',{event:'live-activity'},({payload})=>{if(payload&&payload.from!==state.user.id){appendActivity(payload);}});
    state.channel.on('broadcast',{event:'live-comment'},({payload})=>{if(payload&&payload.from!==state.user.id)appendComment(payload);});
    state.channel.on('broadcast',{event:'live-publisher-ready'},({payload})=>{
      if(payload?.from===state.user.id||!payload?.user_id)return;
      const publisherId=payload.user_id;
      if(!state.sfuSubscribedPublishers.has(publisherId)&&!state.sfuSubscribePending.has(publisherId)) subscribeToSfuPublishers([publisherId]).catch(e=>console.warn('Could not add/reconnect live partner video',e));
    });
    state.channel.on('presence',{event:'sync'},()=>{
      const presence=state.channel.presenceState();
      const presenceEntries=Object.values(presence).flat().filter(Boolean);
      // A member may briefly have more than one presence meta while returning
      // from another tab/device. Count unique JOINT accounts, not tab instances.
      const uniquePresence=new Map();
      presenceEntries.forEach(entry=>{
        const key=String(entry.user_id||entry.presence_ref||'');
        if(key)uniquePresence.set(key,entry);
      });
      const count=uniquePresence.size;
      if(state.role==='host'){
        const guestPresent=presenceEntries.some(entry=>entry.role==='guest'&&entry.user_id!==state.user.id);
        if(guestPresent){
          state.guestWasPresent=true;
          if(state.guestPresenceTimer){clearTimeout(state.guestPresenceTimer);state.guestPresenceTimer=null;}
        }else if(state.guestWasPresent){
          // Presence can briefly disappear while Android suspends/resumes the
          // guest PWA. Give it a grace period before removing the remote tile.
          if(!state.guestPresenceTimer)state.guestPresenceTimer=setTimeout(()=>{
            state.guestPresenceTimer=null;
            const latest=state.channel?.presenceState?.()||{};
            const stillPresent=Object.values(latest).flat().some(entry=>entry?.role==='guest'&&entry.user_id!==state.user.id);
            if(!stillPresent){state.guestWasPresent=false;restoreHostSingleScreen();refreshHostInviteCode().catch(error=>console.warn('Could not refresh guest invite code',error));}
          },12000);
        }else restoreHostSingleScreen();
      }
      const label=$('live-viewer-count');
      if(label){
        label.textContent='👁 '+Math.max(0,count)+' watching';
        const canSwitch=state.role==='host'||state.role==='guest';
        label.disabled=!canSwitch;
        label.title=canSwitch?(state.cameraFacing==='environment'?'Using back camera · tap to switch to front':'Using front camera · tap to switch to back'):'Viewer count';
        label.setAttribute('aria-label',canSwitch?'Switch between front and back camera. '+Math.max(0,count)+' watching':Math.max(0,count)+' watching');
      }
      updateStreamerOverlays();
    });
    const status=await state.channel.subscribe(async (status)=>{if(status==='SUBSCRIBED'){try{await state.channel.track({user_id:state.user.id,role:state.role||'viewer',joined_at:new Date().toISOString()});}catch(e){console.warn('Live presence tracking unavailable',e);}startPublisherDiscovery();}});
  }
  function commentAvatarFromProfile(profile,user){
    const metadata=user?.user_metadata||{};
    return profile?.avatar_url||profile?.photo_url||profile?.profile_picture_url||
      profile?.profile_image_url||profile?.avatar||profile?.photo||profile?.profile_image||
      profile?.profile_picture||profile?.image_url||metadata.avatar_url||metadata.picture||
      metadata.profile_photo_url||metadata.photo_url||metadata.profile_picture_url||'';
  }
  async function hydrateCommentProfile(item){
    const enriched={...item};
    const userId=String(item?.from||item?.user_id||'');
    if(enriched.avatar_url)return enriched;
    if(!userId)return enriched;
    const cached=state.commentProfileCache.get(userId);
    if(cached!==undefined){enriched.avatar_url=cached;return enriched;}
    let avatar='';
    try{
      if(state.db){
        const {data,error}=await state.db.from('joint_profiles').select('*').eq('id',userId).maybeSingle();
        if(!error&&data)avatar=commentAvatarFromProfile(data,userId===state.user?.id?state.user:null);
      }
    }catch(error){console.warn('Could not load live commenter profile photo',error);}
    if(!avatar&&userId===state.user?.id)avatar=commentAvatarFromProfile(null,state.user);
    state.commentProfileCache.set(userId,avatar||'');
    enriched.avatar_url=avatar||'';
    return enriched;
  }
  function makeCommentAvatar(item){
    const avatar=document.createElement('img');
    avatar.className='live-comment-avatar';avatar.alt=(item.sender||'Commenter')+' profile photo';avatar.loading='lazy';
    const fallback=()=>{
      avatar.removeAttribute('src');
      avatar.classList.add('live-comment-avatar-fallback');
      avatar.alt=(item.sender||'Commenter')+' profile placeholder';
      avatar.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#7541b8"/><text x="20" y="26" text-anchor="middle" font-size="19" fill="white">'+String(item.sender||'J').trim().charAt(0).replace(/[<>&]/g,'')+'</text></svg>');
    };
    const url=String(item.avatar_url||'').trim();
    if(url && (/^https:\/\//i.test(url)||url.startsWith('/'))){
      avatar.src=url;avatar.referrerPolicy='no-referrer';avatar.onerror=fallback;
    }else fallback();
    return avatar;
  }
  function appendComment(item){
    // Keep the full activity history below the controls, and also show a short,
    // transparent rolling overlay at the bottom of each visible video tile.
    const feed=$('live-activity-feed');
    if(feed){
      if(feed.children.length===1&&feed.textContent.includes('Live activity will appear here'))feed.replaceChildren();
      const row=document.createElement('div');row.className='live-feed-item';
      const icon=document.createElement('span');icon.className='live-feed-emoji';icon.textContent='💬';
      const avatar=makeCommentAvatar(item);
      const body=document.createElement('span');body.textContent=(item.sender||'JOINT member')+': '+String(item.text||'').slice(0,300);
      row.append(icon,avatar,body);feed.prepend(row);while(feed.children.length>30)feed.lastElementChild.remove();
    }
    const tiles=[...($('live-video-grid')?.querySelectorAll('.live-video-tile')||[])];
    tiles.forEach(tile=>{
      let overlay=tile.querySelector('.live-comment-overlay');
      if(!overlay){overlay=document.createElement('div');overlay.className='live-comment-overlay';overlay.setAttribute('aria-live','polite');overlay.setAttribute('aria-label','Recent live comments');tile.append(overlay);}
      // Remove oldest lines first; only the latest three remain visible.
      while(overlay.children.length>=3){const oldest=overlay.firstElementChild;if(!oldest)break;oldest.classList.add('is-leaving');setTimeout(()=>oldest.remove(),280);if(overlay.children.length<=3)break;}
      const line=document.createElement('div');line.className='live-comment-line';
      const avatar=makeCommentAvatar(item);
      const content=document.createElement('span');content.className='live-comment-content';
      const name=document.createElement('span');name.className='live-comment-name';name.textContent=(item.sender||'JOINT member')+': ';
      const message=document.createElement('span');message.textContent=String(item.text||'').slice(0,300);
      content.append(name,message);line.append(avatar,content);overlay.append(line);
      while(overlay.children.length>3)overlay.firstElementChild.remove();
      // Comments are transient on the video; they remain in the activity feed below.
      setTimeout(()=>{if(line.isConnected){line.classList.add('is-leaving');setTimeout(()=>line.remove(),300);}},7000);
    });
  }

  // Reuse the user's existing participation row when the database enforces one
  // participation row per user. This avoids duplicate-key failures on re-entry.
  async function claimLiveParticipant(sessionId, role){
    const existingResult=await state.db.from('joint_live_participants')
      .select('id,session_id,role,status')
      .eq('user_id',state.user.id)
      .limit(1)
      .maybeSingle();
    if(existingResult.error)throw existingResult.error;
    const existing=existingResult.data;
    if(!existing){
      const inserted=await state.db.from('joint_live_participants')
        .insert({session_id:sessionId,user_id:state.user.id,role,status:'connected',left_at:null})
        .select().single();
      if(inserted.error)throw inserted.error;
      return inserted.data;
    }
    if(existing.status==='connected'&&existing.session_id!==sessionId){
      const previous=await state.db.from('joint_live_sessions')
        .select('status').eq('id',existing.session_id).maybeSingle();
      if(previous.error)throw previous.error;
      if(previous.data?.status==='live'){
        throw new Error('You are already connected to another live session. Leave that live before joining this one.');
      }
    }
    const updated=await state.db.from('joint_live_participants')
      .update({session_id:sessionId,role,status:'connected',left_at:null})
      .eq('id',existing.id)
      .select().single();
    if(updated.error)throw updated.error;
    return updated.data;
  }
  async function restoreHostSessionOnReturn(){
    if(state.restoreAttempted||!state.db||!state.user)return;
    state.restoreAttempted=true;
    // Only recover a live session owned by this signed-in host. Do not silently
    // rejoin a viewer/guest session or create a new live session.
    const active=await state.db.from('joint_live_sessions')
      .select('*').eq('host_user_id',state.user.id).eq('status','live')
      .order('started_at',{ascending:false}).limit(1).maybeSingle();
    if(active.error)throw active.error;
    if(!active.data)return;

    const session=active.data;
    if(!claimHostTabLock(session.id)){
      state.hostSessionInOtherTab=session;
      show('host-notice','Your live is already running in another JOINT tab. Return to the original tab to continue or end it. This tab will not open another camera or microphone session.',true);
      return;
    }
    state.session=session;
    state.role='host';
    state.guestWasPresent=false;
    state.sfuSubscribedPublishers.clear();state.sfuSubscribePending.clear();
    state.eventCache=[];
    state.reactionCount=0;state.giftCount=0;state.giftDiamondTotal=0;

    // Reactivate the existing host participation row (or create it if it is
    // genuinely missing) instead of inserting a duplicate participation.
    try{
      state.participant=await claimLiveParticipant(session.id,'host');
    }catch(error){
      state.session=null;state.role=null;releaseHostTabLock();
      throw new Error('Your previous JOINT Live session was found, but its host participation could not be restored: '+error.message);
    }

    $('live-viewer-count').disabled=false;
    $('live-host-engagement-stats').hidden=false;
    $('live-engagement-panel').hidden=true;
    $('live-call-panel').classList.remove('viewer-mode');
    $('live-room-code-display').textContent=session.room_code||'';
    $('live-room-share').hidden=false;
    $('live-room-code-wrap').hidden=true;
    $('live-add-guest').hidden=false;
    $('live-end-button').hidden=false;
    $('host-live').hidden=true;
    $('open-host-live').setAttribute('aria-expanded','false');
    openCall();
    setStatus('Restoring your existing live session. Reconnecting camera and microphone…');

    state.isRestoringHost=true;
    try{
      await setupEngagementChannel();
      await startMedia();
      await publishToSfu();
      await loadHostEngagementStats();
      if(state.channel)await state.channel.send({
        type:'broadcast',event:'live-publisher-ready',
        payload:{user_id:state.user.id,from:state.user.id,media_restarted_at:Date.now()}
      });
      await subscribeToSfuPublishers();
      setStatus('Your previous live session is back. You can continue streaming or end it here.');
    }catch(error){
      console.error('JOINT Live host recovery could not reconnect media',error);
      // Keep the existing session and its End Live controls visible even when
      // camera permission/network recovery fails. Never create a replacement session.
      setStatus('Your live session was restored, but video could not reconnect: '+(error?.message||'Check camera permission and network, then reload this page.'),true);
    }finally{state.isRestoringHost=false;}
  }

  function restoreHostSingleScreen(){
    const grid=$('live-video-grid');
    if(!grid)return;
    grid.querySelectorAll('.live-video-tile.remote').forEach(tile=>{
      tile.querySelector('video')?.srcObject?.getTracks?.().forEach(track=>track.stop());
      tile.remove();
    });
    grid.querySelectorAll('audio[data-live-remote-audio]').forEach(audio=>{
      audio.pause();audio.srcObject?.getTracks?.().forEach(track=>track.stop());audio.remove();
    });
    if(state.sfuSubscribedPublishers){
      state.sfuSubscribedPublishers.clear();state.sfuSubscribePending.clear();
    }
    updateStageLayout();
    updateStreamerOverlays();
  }

  async function refreshHostInviteCode(){
    if(state.role!=='host'||!state.session||state.rotatingInviteCode)return;
    state.rotatingInviteCode=true;
    try{
      const nextCode=randomCode();
      const result=await state.db.from('joint_live_sessions').update({room_code:nextCode})
        .eq('id',state.session.id).eq('host_user_id',state.user.id).eq('status','live')
        .select('room_code').single();
      if(result.error)throw result.error;
      state.session.room_code=result.data.room_code||nextCode;
      $('live-room-code-display').textContent=state.session.room_code;
      show('live-engagement-notice','Your guest has left. The invitation code has been refreshed; tap ＋ to reveal and share the new code.');
    }catch(error){
      console.warn('Could not refresh JOINT Live invitation code',error);
      show('live-engagement-notice','Your guest has left and the host screen is restored. The current invitation code remains active.',true);
    }finally{state.rotatingInviteCode=false;}
  }
  async function host(){
    await init();
    if(state.hostSessionInOtherTab){show('host-notice','Your existing live is still running in another JOINT tab. Switch back to that tab to continue or end it; do not start a second broadcast.',true);return;}
    if(state.session&&state.role==='host'){
      openCall();
      const peer=state.sfuPeer;
      const tracks=state.localStream?.getTracks?.()||[];
      const mediaReady=tracks.some(track=>track.kind==='video'&&track.readyState==='live')&&tracks.some(track=>track.kind==='audio'&&track.readyState==='live');
      if(!mediaReady||!peer||peer.connectionState==='failed'||peer.connectionState==='closed'){
        await resumeHostMediaAfterReturn();
      }else{
        setStatus('Your existing live session is active. Continue streaming here or use End live when finished.');
      }
      return;
    }
    const title=$('live-title').value.trim(); if(!title)throw new Error('Enter a live session title.');
    if(!claimHostTabLock('pending'))throw new Error('A JOINT Live session is already owned by another browser tab. Return to that tab to continue or end it before starting another live.');
    await startMedia();
    let code=randomCode(), created;
    for(let attempt=0;attempt<4;attempt++){
      created=await state.db.from('joint_live_sessions').insert({host_user_id:state.user.id,title,description:$('live-description').value.trim(),audience:'public',room_code:code,status:'live',started_at:new Date().toISOString()}).select().single();
      if(!created.error)break; if(!/duplicate|unique/i.test(created.error.message||''))throw created.error; code=randomCode();
    }
    if(created.error)throw created.error;
    let hostParticipant;
    try{hostParticipant=await claimLiveParticipant(created.data.id,'host');}
    catch(error){
      await state.db.from('joint_live_sessions').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',created.data.id);
      if(state.localStream){state.localStream.getTracks().forEach(track=>track.stop());state.localStream=null;}
      throw error;
    }
    state.session=created.data;writeHostTabLock(state.session.id);state.participant=hostParticipant;state.guestWasPresent=false;state.sfuSubscribedPublishers.clear();state.sfuSubscribePending.clear();state.eventCache=[];state.role='host';$('live-viewer-count').disabled=false;$('live-host-engagement-stats').hidden=false;state.reactionCount=0;state.giftCount=0;state.giftDiamondTotal=0;updateHostEngagementStats();$('live-engagement-panel').hidden=true;
    await setupEngagementChannel();
    await publishToSfu();
    await loadHostEngagementStats();
    if(state.channel)await state.channel.send({type:'broadcast',event:'live-publisher-ready',payload:{user_id:state.user.id,from:state.user.id}});
    $('live-room-code-display').textContent=code;$('live-room-share').hidden=false;$('live-room-code-wrap').hidden=true;$('live-add-guest').hidden=false;$('live-end-button').hidden=false;$('host-live').hidden=true;$('open-host-live').setAttribute('aria-expanded','false');openCall();setStatus(state.session.audience==='invite'?'You are live. Share the private room code with authorized people.':'You are live publicly. You can stay on screen alone; use ＋ to invite one guest.');

  }
  function parseCode(raw){const val=raw.trim();try{const u=new URL(val);return (u.searchParams.get('room')||u.searchParams.get('code')||u.pathname.split('/').filter(Boolean).pop()||val).toUpperCase().replace(/[^A-Z0-9]/g,'');}catch(_){return val.toUpperCase().replace(/[^A-Z0-9]/g,'');}}
  async function joinOnce(requestedRole='guest'){
    await init();
    if(state.session){
      openCall();
      setStatus(state.role==='host'?'Your existing live session has been restored. Continue streaming or end it here.':'You are already in a live room. Leave it before opening another live.');
      return;
    }
    const code=parseCode($('live-room-code').value);let found; if(state.targetSessionId){found=await state.db.from('joint_live_sessions').select('*').eq('id',state.targetSessionId).eq('status','live').maybeSingle();state.targetSessionId=null;}else{if(!code)throw new Error('Choose a public live card or enter a room code or invitation link.');found=await state.db.from('joint_live_sessions').select('*').eq('room_code',code).eq('status','live').maybeSingle();}if(found.error)throw found.error;if(!found.data)throw new Error('No active live stream was found for that room code.');
    const session=found.data;if(session.host_user_id===state.user.id)throw new Error('You are already the host of this live stream.');
    state.session=session;state.sfuSubscribedPublishers.clear();state.sfuSubscribePending.clear();state.eventCache=[]; state.role=requestedRole==='viewer'?'viewer':'guest'; $('live-viewer-count').disabled=state.role==='viewer'; $('live-host-engagement-stats').hidden=!['host','guest'].includes(state.role); $('live-engagement-panel').hidden=state.role!=='viewer';
    $('live-call-panel').classList.toggle('viewer-mode',state.role==='viewer');
    if(state.role==='viewer'){await setupEngagementChannel();await subscribeToSfuPublishers();openCall();await loadHostEngagementStats();updateStreamerOverlays();$('live-room-share').hidden=true;$('live-end-button').hidden=true;setStatus('Watching live.');return;}
    const existing=await state.db.from('joint_live_participants').select('id,user_id,role,status').eq('session_id',session.id).eq('status','connected');if(existing.error)throw existing.error;
    const otherConnected=(existing.data||[]).filter(p=>p.user_id!==state.user.id);
    if(otherConnected.length>=2)throw new Error('This live stream already has two connected on-screen participants.');
    state.participant=await claimLiveParticipant(session.id,'guest');await setupEngagementChannel();await startMedia();await publishToSfu();await subscribeToSfuPublishers([session.host_user_id]);await state.channel.send({type:'broadcast',event:'live-publisher-ready',payload:{user_id:state.user.id,from:state.user.id}});await loadHostEngagementStats();openCall();$('live-room-code-display').textContent=session.room_code;$('live-room-share').hidden=true;$('live-end-button').hidden=true;setStatus('Joined on screen. Live video is connected.');
  }
  // Prevent rapid/double taps from creating multiple viewer sessions or duplicate tiles.
  let joinInFlight = null;
  async function join(requestedRole='guest'){
    if (state.session) {
      openCall();
      setStatus('You are already in a live room. Leave it before opening another live.');
      return;
    }
    if (joinInFlight) return joinInFlight;
    joinInFlight = joinOnce(requestedRole);
    try { return await joinInFlight; }
    catch(error){
      // A failed guest setup must not leave a connected participant row, camera,
      // or half-created SFU session behind. Release the partial attempt so the
      // next tap is a clean retry rather than a duplicate publisher.
      if(state.session&&state.role!=='host'){
        try{await cleanup(false);}catch(cleanupError){console.warn('Could not fully roll back failed JOINT Live join',cleanupError);}
      }
      throw error;
    }
    finally { joinInFlight = null; }
  }
  async function cleanup(endSession=false){
    const leavingRole=state.role;
    if(state.publisherPollTimer){clearInterval(state.publisherPollTimer);state.publisherPollTimer=null;}
    try{if(state.channel)await state.db.removeChannel(state.channel);}catch(_){}state.channel=null;
    if(state.sfuSessionId&&state.session){try{await closeSfuConnection();}catch(e){console.warn('Could not close Cloudflare Live session cleanly',e);}}state.sfuSessionId=null;if(state.sfuPeer){state.sfuPeer.close();state.sfuPeer=null;}if(state.pc){state.pc.close();state.pc=null;}if(state.localStream){state.localStream.getTracks().forEach(t=>t.stop());state.localStream=null;}
    if(state.participant&&state.db){await state.db.from('joint_live_participants').update({status:'left',left_at:new Date().toISOString()}).eq('id',state.participant.id);}
    if(endSession&&state.session&&state.role==='host'){await state.db.from('joint_live_sessions').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',state.session.id).eq('host_user_id',state.user.id);}
    if(leavingRole==='host')releaseHostTabLock();
    state.session=null;state.participant=null;state.role=null;joinInFlight=null;state.sfuSubscribedPublishers.clear();state.sfuSubscribePending.clear();if(state.guestPresenceTimer){clearTimeout(state.guestPresenceTimer);state.guestPresenceTimer=null;}state.eventCache=[];$('live-host-engagement-stats').hidden=true;$('live-call-panel').classList.remove('viewer-mode');$('live-viewer-count').disabled=true;$('live-video-grid').replaceChildren();$('live-room-share').hidden=true;$('live-end-button').hidden=true;$('live-comment-form').hidden=true;$('live-call-panel').hidden=true;setStatus('Live session ended.');loadRecaps();
  }
  const wrapError=(id,fn)=>async e=>{e.preventDefault();show(id,'Connecting…');try{await fn();}catch(err){console.error(err);show(id,err?.message||'Live action failed. Check the JOINT Live database setup.',true);if(state.localStream&&!state.session){state.localStream.getTracks().forEach(track=>track.stop());state.localStream=null;}if(state.hostTabOwner&&!state.session)releaseHostTabLock();}};
  $('live-host-form').addEventListener('submit',wrapError('host-notice',host));
  $('live-join-form').addEventListener('submit',wrapError('join-notice',join));
  $('live-end-button').addEventListener('click',()=>cleanup(true));
  $('live-viewer-count')?.addEventListener('click',()=>{
    if(state.role==='host'||state.role==='guest')switchLiveCamera();
  });
  $('live-leave-button').addEventListener('click',()=>cleanup(false));
  $('live-add-guest')?.addEventListener('click',()=>{const codeWrap=$('live-room-code-wrap');if(!codeWrap)return;codeWrap.hidden=!codeWrap.hidden;const button=$('live-add-guest');button.setAttribute('aria-expanded',String(!codeWrap.hidden));setStatus(codeWrap.hidden?'You are live alone. Tap ＋ whenever you want to invite one guest.':'Share this guest code only with the one person you want to join on screen. Public viewers can watch without a code.');});
  $('live-copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('live-room-code-display').textContent);setStatus('Room code copied.');}catch(_){setStatus('Room code: '+$('live-room-code-display').textContent);}});
  document.querySelectorAll('[data-live-reaction]').forEach(button=>button.addEventListener('click',async()=>{try{await recordActivity({kind:'reaction',reaction:button.dataset.liveReaction,emoji:button.dataset.liveReaction});}catch(err){show('live-engagement-notice',err.message,true);}}));
  function normalizeLiveSearch(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  }
  function filterPublicLiveCards(){
    const input=$('live-public-search-input');const list=$('live-public-list');if(!input||!list)return;
    const query=normalizeLiveSearch(input.value);const terms=query.split(/\s+/).filter(Boolean);let visible=0;
    list.querySelectorAll('.live-public-card').forEach(card=>{
      const haystack=normalizeLiveSearch([card.dataset.search,card.dataset.hostName,card.dataset.liveTitle,card.dataset.description,card.textContent].join(' '));
      const match=!terms.length||terms.every(term=>haystack.includes(term));
      card.hidden=!match;
      card.style.display=match?'':'none';
      if(match)visible++;
    });
    let empty=list.querySelector('.live-public-search-empty');
    if(terms.length&&visible===0){
      if(!empty){empty=document.createElement('div');empty.className='live-summary-empty live-public-search-empty';empty.setAttribute('role','status');list.append(empty);}
      empty.textContent='No active live matches that search.';
      empty.hidden=false;
    }else if(empty)empty.remove();
  }

  // Supabase table rows can remain marked connected after a browser closes
  // unexpectedly. Realtime presence is the authoritative signal that a host
  // is currently online in this live room, so stale sessions are not shown.
  async function isHostPresentNow(session){
    if(!state.db||!session?.id||!session?.host_user_id)return false;
    const channel=state.db.channel('joint-live-engagement-'+session.id,{config:{presence:{key:'public-live-discovery-'+state.user.id}}});
    let subscribed=false;
    try{
      const result=await new Promise(resolve=>{
        let settled=false;
        const finish=value=>{if(settled)return;settled=true;resolve(value);};
        channel.on('presence',{event:'sync'},()=>{
          const presence=channel.presenceState();
          const entries=Object.values(presence).flat();
          finish(entries.some(entry=>entry?.user_id===session.host_user_id&&entry?.role==='host'));
        });
        channel.subscribe(status=>{
          if(status==='SUBSCRIBED'){
            subscribed=true;
            // Allow the initial presence sync to arrive before reading state.
            setTimeout(()=>{
              const entries=Object.values(channel.presenceState()).flat();
              finish(entries.some(entry=>entry?.user_id===session.host_user_id&&entry?.role==='host'));
            },350);
          }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')finish(false);
        });
        setTimeout(()=>finish(false),2200);
      });
      return result;
    }catch(_){return false;}
    finally{try{await state.db.removeChannel(channel);}catch(_){}}
  }
  async function loadPublicLives(){
    const list=$('live-public-list');if(!list)return;
    list.innerHTML='<div class="live-summary-empty"><strong>Loading active public lives…</strong></div>';
    try{
      await init();
      // Only rows still marked live are candidates. A DB participant row may
      // remain connected after a mobile browser is closed, so confirm each host
      // against the room's live Realtime presence before rendering its card.
      const result=await state.db.from('joint_live_sessions').select('id,title,description,host_user_id,room_code,started_at,audience,status').eq('status','live').eq('audience','public').order('started_at',{ascending:false}).limit(40);
      if(result.error)throw result.error;
      const candidates=(result.data||[]).filter(s=>s.host_user_id!==state.user.id);
      if(!candidates.length){list.innerHTML='<div class="live-summary-empty"><strong>No public live sessions right now</strong><p>When a member starts a public live, it can appear here.</p></div>';return;}
      const presenceResults=[];
      for(let i=0;i<candidates.length;i+=8){
        const batch=candidates.slice(i,i+8);
        presenceResults.push(...await Promise.all(batch.map(async session=>({session,online:await isHostPresentNow(session)}))));
      }
      const sessions=presenceResults.filter(item=>item.online).map(item=>item.session);
      if(!sessions.length){list.innerHTML='<div class="live-summary-empty"><strong>No public live sessions right now</strong><p>Only hosts who are currently connected appear here.</p></div>';return;}
      const hostIds=[...new Set(sessions.map(s=>s.host_user_id).filter(Boolean))];
      const [profileResult,followResult]=await Promise.all([
        state.db.from('joint_profiles').select('*').in('id',hostIds),
        state.db.from('joint_follows').select('followed_user_id').eq('follower_id',state.user.id).in('followed_user_id',hostIds)
      ]);
      const profiles=new Map((profileResult.data||[]).map(p=>[p.id,p]));
      const followed=new Set((followResult.data||[]).map(f=>f.followed_user_id));
      sessions.sort((a,b)=>Number(followed.has(b.host_user_id))-Number(followed.has(a.host_user_id))||new Date(b.started_at||0)-new Date(a.started_at||0));
      list.replaceChildren();
      sessions.forEach(session=>{
        const card=document.createElement('article');card.className='live-public-card';card.setAttribute('aria-label','Live stream card for '+(session.title||'Live now'));
        const profile=profiles.get(session.host_user_id)||{};
        const hostName=profile.display_name||profile.username||'JOINT member';
        card.dataset.hostName=hostName;card.dataset.liveTitle=session.title||'Live now';card.dataset.description=session.description||'';card.dataset.search=normalizeLiveSearch([hostName,profile.username,session.title,session.description].join(' '));
        const avatar=profile.avatar_url||profile.photo_url||profile.profile_picture_url||profile.profile_image_url||profile.avatar||profile.photo||'';
        const avatarEl=avatar?document.createElement('img'):document.createElement('div');avatarEl.className='live-public-avatar';
        if(avatar){avatarEl.src=avatar;avatarEl.alt=hostName+' profile picture';avatarEl.loading='lazy';avatarEl.onerror=()=>{const fallback=document.createElement('div');fallback.className='live-public-avatar';fallback.textContent=hostName.trim().slice(0,1).toUpperCase();avatarEl.replaceWith(fallback);};}
        else avatarEl.textContent=hostName.trim().slice(0,1).toUpperCase();
        avatarEl.setAttribute('aria-label','Open live host profile');
        const profileLink=document.createElement('a');profileLink.className='live-public-profile-link';profileLink.href='member-profile.html?id='+encodeURIComponent(session.host_user_id);profileLink.setAttribute('aria-label','Open '+hostName+' profile');profileLink.append(avatarEl);
        const badge=document.createElement('span');badge.className='live-badge';badge.textContent='● LIVE';
        const title=document.createElement('h3');title.textContent=hostName;
        const titleLink=document.createElement('a');titleLink.className='live-public-title-link';titleLink.href='member-profile.html?id='+encodeURIComponent(session.host_user_id);titleLink.append(title);
        const liveTitle=document.createElement('p');liveTitle.className='live-public-title';liveTitle.textContent=session.title||'Live now';
        if(followed.has(session.host_user_id)){const following=document.createElement('span');following.className='live-following-badge';following.textContent='Following';card.append(following);}
        const desc=document.createElement('p');desc.textContent=session.description||'Tap to watch live';
        const time=document.createElement('p');time.className='live-public-time';time.textContent='Started '+(session.started_at?new Date(session.started_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'recently');
        const button=document.createElement('button');button.className='live-btn live-full';button.type='button';button.textContent='Watch live';
        const openPublicLive=()=>{if(state.session){openCall();setStatus('You are already watching a live. Leave it before opening another stream.');return;}if(joinInFlight)return;state.targetSessionId=session.id;$('live-room-code').value='';join('viewer').catch(err=>show('join-notice',err?.message||'Could not open this public live.',true));};
        button.addEventListener('click',openPublicLive);
        profileLink.addEventListener('click',ev=>ev.stopPropagation());titleLink.addEventListener('click',ev=>ev.stopPropagation());
        card.append(profileLink,badge,titleLink,liveTitle,desc,time,button);list.append(card);
      });
      filterPublicLiveCards();
    }catch(err){console.warn('Public JOINT Live list unavailable',err);list.innerHTML='<div class="live-summary-empty"><strong>Public lives could not load</strong><p>Check the JOINT Live database policies and connection.</p></div>';}
  }
  const publicSearch=$('live-public-search-input');
  if(publicSearch){
    ['input','search','keyup','change'].forEach(type=>publicSearch.addEventListener(type,filterPublicLiveCards));
    publicSearch.addEventListener('compositionend',filterPublicLiveCards);
    publicSearch.form?.addEventListener('submit',event=>{event.preventDefault();filterPublicLiveCards();});
  }

  $('live-reaction-control')?.addEventListener('click',()=>{const row=$('live-reaction-options');if(row)row.hidden=!row.hidden;});
  $('live-comment-control')?.addEventListener('click',()=>{const form=$('live-comment-form');if(!form)return;form.hidden=!form.hidden;if(!form.hidden)$('live-comment-input')?.focus();});
  $('live-comment-form')?.addEventListener('submit',async ev=>{
    ev.preventDefault();const input=$('live-comment-input'),text=(input?.value||'').trim();
    if(!text)return;if(!state.session||!state.channel){show('live-engagement-notice','Join a live session before commenting.',true);return;}
    const sender=state.user?.user_metadata?.full_name||state.user?.user_metadata?.name||state.user?.email?.split('@')[0]||'JOINT member';
    const payload=await hydrateCommentProfile({text:text.slice(0,300),sender,from:state.user.id});
    appendComment(payload);
    try{await state.channel.send({type:'broadcast',event:'live-comment',payload});if(input)input.value='';$('live-comment-form').hidden=true;}catch(err){show('live-engagement-notice','Comment could not be sent. Please try again.',true);}
  });
  $('live-share-control')?.addEventListener('click',async()=>{
    if(!state.session){show('live-engagement-notice','Join a live before sharing.',true);return;}
    const url=new URL(location.href);url.searchParams.set('room',state.session.room_code||'');
    try{if(navigator.share)await navigator.share({title:state.session.title||'JOINT Live',text:'Watch this JOINT Live session',url:url.toString()});else if(navigator.clipboard){await navigator.clipboard.writeText(url.toString());show('live-engagement-notice','Live link copied.');}else show('live-engagement-notice','Share this room code: '+(state.session.room_code||''));}catch(err){if(err?.name!=='AbortError')show('live-engagement-notice','Could not share this live link.',true);}
  });
  const giftModal=$('live-gift-modal'), giftForm=$('live-gift-payment-form'), giftSelected=$('live-gift-selected'), giftConfirm=$('confirm-live-gift'), giftRecipient=$('live-gift-recipient');
  let giftRecipients=[];
  function giftKey(){return 'livegift_'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));}
  async function loadGiftRecipients(){
    if(!giftRecipient||!state.session)return;
    const sessionId=state.session.id, hostId=state.session.host_user_id;
    giftRecipients=[{id:hostId,label:'Host streamer'}];
    try{
      const {data,error}=await state.db.from('joint_live_participants').select('user_id,role,status').eq('session_id',sessionId).eq('status','connected');
      if(error)throw error;
      const guest=(data||[]).find(p=>p.user_id!==hostId&&p.role==='guest');
      if(guest)giftRecipients.push({id:guest.user_id,label:'Guest streamer'});
    }catch(err){console.warn('Could not load live gift recipients',err);}
    giftRecipient.replaceChildren();
    giftRecipients.forEach(person=>{const option=document.createElement('option');option.value=person.id;option.textContent=person.label;giftRecipient.append(option);});
    if(giftRecipients.length>1){const both=document.createElement('option');both.value='both';both.textContent='Both streamers (split this gift)';giftRecipient.append(both);}
  }
  document.getElementById('open-live-gifts')?.addEventListener('click',async()=>{if(!state.session){show('live-engagement-notice','Join a live session before sending gifts.',true);return;}await loadGiftRecipients();giftModal.hidden=false;});
  document.getElementById('close-live-gifts')?.addEventListener('click',()=>{giftModal.hidden=true;$('live-gift-pin').value='';});
  document.querySelectorAll('#live-gift-modal-grid [data-live-gift]').forEach(button=>button.addEventListener('click',()=>{
    const giftAmount=Number(String(button.dataset.giftValue||'').replace(/,/g,'').trim());
    if(!Number.isSafeInteger(giftAmount)||giftAmount<=0){
      giftSelected.textContent='This gift has an invalid Diamond price. Please refresh the live page and try again.';
      giftSelected.style.color='#a52834';giftConfirm.disabled=true;return;
    }
    state.selectedGift={name:button.dataset.liveGift,emoji:button.dataset.giftEmoji,value:giftAmount};
    document.querySelectorAll('#live-gift-modal-grid [data-live-gift]').forEach(item=>{item.classList.toggle('is-selected',item===button);item.setAttribute('aria-pressed',String(item===button));});
    giftSelected.textContent=state.selectedGift.emoji+' '+state.selectedGift.name+' · '+state.selectedGift.value.toLocaleString()+' Diamonds selected. Choose the recipient and enter your wallet PIN.';
    giftSelected.style.color='';giftConfirm.disabled=false;
  }));
  giftForm?.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(!state.selectedGift||!state.session)return;
    const gift={...state.selectedGift};
    const pin=$('live-gift-pin').value;
    if(!/^\d{6}$/.test(pin)){giftSelected.textContent='Enter your six-digit Diamond Wallet PIN.';return;}
    const recipientValue=giftRecipient?.value||state.session.host_user_id;
    let targets;
    if(recipientValue==='both'){
      const people=giftRecipients.filter(p=>p.id!==state.user?.id);
      if(people.length<2){giftSelected.textContent='Both streamers are not available to receive this gift.';return;}
      // Split the chosen gift value across both streamers; odd Diamonds go to the first recipient.
      const firstAmount=Math.ceil(gift.value/2), secondAmount=gift.value-firstAmount;
      targets=[{...people[0],amount:firstAmount},{...people[1],amount:secondAmount}].filter(p=>p.amount>0);
    }else{
      const person=giftRecipients.find(p=>p.id===recipientValue);
      if(!person){giftSelected.textContent='Please choose a valid streamer to receive this gift.';return;}
      if(person.id===state.user?.id){giftSelected.textContent='You cannot send a gift to yourself.';return;}
      targets=[{...person,amount:gift.value}];
    }
    giftConfirm.disabled=true;giftSelected.textContent='Verifying your PIN and processing gift securely…';
    let completed=[];
    try{
      for(const target of targets){
        const payment=await state.db.rpc('joint_live_send_gift',{
          p_session_id:state.session.id,
          p_gift_name:gift.name,
          p_gift_emoji:gift.emoji,
          p_diamond_amount:target.amount,
          p_pin:pin,
          p_recipient_user_id:target.id,
          p_idempotency_key:giftKey()
        });
        if(payment.error)throw new Error(payment.error.message||'Secure gift payment is not configured.');
        if(!payment.data||payment.data.ok!==true)throw new Error(payment.data?.message||payment.data?.error||'Gift payment was not confirmed.');
        completed.push(target);
        // The SQL RPC has already written the gift event. Broadcast only; never insert it a second time.
        const event={kind:'gift',gift_name:gift.name,emoji:gift.emoji,diamond_value:target.amount,recipient_user_id:target.id,user_id:state.user.id,sender:state.user?.user_metadata?.full_name||state.user?.user_metadata?.name||state.user?.email?.split('@')[0]||'JOINT member'};
        appendActivity(event);
        if(state.channel)await state.channel.send({type:'broadcast',event:'live-activity',payload:{...event,from:state.user.id}});
      }
      giftSelected.textContent=recipientValue==='both'?'Gift sent to both streamers. The Diamonds were split between them.':'Gift sent successfully to '+targets[0].label+'.';
      giftSelected.style.color='#287447';
      setTimeout(()=>{giftModal.hidden=true;giftForm.reset();state.selectedGift=null;document.querySelectorAll('#live-gift-modal-grid [data-live-gift]').forEach(item=>{item.classList.remove('is-selected');item.setAttribute('aria-pressed','false');});giftSelected.textContent='Select a gift above.';giftSelected.style.color='';},900);
    }catch(err){
      const prefix=completed.length?'Gift was only partly sent. One streamer received their share; please check the live totals before retrying. ':'Gift not sent: ';
      giftSelected.textContent=prefix+err.message+(completed.length?'':' Your selected gift is still selected; you can retry.');giftSelected.style.color='#a52834';
    }finally{giftConfirm.disabled=!state.selectedGift;}
  });
  $('refresh-live-list')?.addEventListener('click',()=>{const list=$('live-public-list');if(list){const expanded=list.classList.toggle('expanded');$('refresh-live-list').textContent=expanded?'Show less':'View more';if(!expanded)list.scrollTo({left:0,behavior:'smooth'});}});
  loadPublicLives();
  loadRecaps();
  // Recover an already-running host session on page return/reload so the host
  // sees the existing live controls instead of being blocked by a stale lock.
  init().catch(error=>console.warn('JOINT Live session recovery was not completed:',error));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      state.wasDocumentHidden=true;
      return;
    }
    if(state.wasDocumentHidden){
      state.wasDocumentHidden=false;
      if(state.role==='host'&&state.session)resumeHostMediaAfterReturn();
    }
  });
  window.addEventListener('pageshow',()=>{
    if(state.role==='host'&&state.session)resumeHostMediaAfterReturn();
  });
  window.addEventListener('focus',()=>{
    if(state.role==='host'&&state.session&&state.wasDocumentHidden){
      state.wasDocumentHidden=false;
      resumeHostMediaAfterReturn();
    }
  });

  // Keep the publisher document alive during in-app navigation.
  // In an installed Chrome PWA, window.open() can create a separate Chrome
  // context rather than another view inside the installed app. Navigating the
  // current document would destroy its MediaStream. Render the destination in
  // a same-origin overlay iframe instead, leaving this live document mounted.
  function openJointPageOverLive(url){
    let shell=document.getElementById('joint-live-navigation-shell');
    if(!shell){
      shell=document.createElement('section');
      shell.id='joint-live-navigation-shell';
      shell.setAttribute('aria-label','JOINT app navigation while live is running');
      shell.style.cssText='position:fixed;inset:0;z-index:2147483000;display:none;flex-direction:column;background:#fff;';
      const bar=document.createElement('div');
      bar.style.cssText='height:54px;min-height:54px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#5426b8;color:#fff;font:600 14px Arial,sans-serif;box-shadow:0 2px 8px #0002;';
      const back=document.createElement('button');
      back.type='button';back.textContent='← Return to Live';
      back.style.cssText='border:0;border-radius:10px;padding:10px 13px;background:#fff;color:#5426b8;font-weight:800;font-size:14px;';
      back.addEventListener('click',()=>{shell.style.display='none';});
      const label=document.createElement('span');
      label.textContent='Your live stream remains active';
      label.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      bar.append(back,label);
      const frame=document.createElement('iframe');
      frame.id='joint-live-navigation-frame';
      frame.title='JOINT app page';
      frame.style.cssText='border:0;display:block;flex:1 1 auto;width:100%;min-height:0;background:#fff;';
      frame.setAttribute('allow','autoplay; clipboard-read; clipboard-write');
      frame.addEventListener('load',()=>{
        try{
          const doc=frame.contentDocument;
          if(!doc||doc.documentElement.dataset.jointLiveReturnBound==='1')return;
          doc.documentElement.dataset.jointLiveReturnBound='1';
          doc.addEventListener('click',ev=>{
            const a=ev.target.closest('a[href]');if(!a)return;
            let target;try{target=new URL(a.href,frame.contentWindow.location.href);}catch(_){return;}
            if(target.origin!==location.origin)return;
            const page=target.pathname.split('/').pop();
            if(page==='live.html'){
              ev.preventDefault();ev.stopPropagation();shell.style.display='none';
            }else if(page==='auth.html'){
              ev.preventDefault();ev.stopPropagation();location.href=target.href;
            }
          },true);
        }catch(err){console.debug('JOINT live navigation frame hook unavailable',err);}
      });
      shell.append(bar,frame);document.body.appendChild(shell);
    }
    const frame=document.getElementById('joint-live-navigation-frame');
    const next=new URL(url,location.href);
    if(next.origin!==location.origin)return false;
    shell.style.display='flex';
    if(frame.src!==next.href)frame.src=next.href;
    return true;
  }

  document.addEventListener('click',event=>{
    const link=event.target.closest('nav.main-nav a, nav.live-bottom-nav a, header .brand, header .avatar');
    if(!link||!state.session||state.role!=='host')return;
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    if(link.target==='_blank'||link.hasAttribute('download'))return;
    const destination=new URL(link.href,location.href);
    if(destination.origin!==location.origin)return;
    event.preventDefault();
    const installedPwa=window.matchMedia?.('(display-mode: standalone)').matches||window.matchMedia?.('(display-mode: minimal-ui)').matches||navigator.standalone===true;
    if(installedPwa){
      if(!openJointPageOverLive(destination.href))location.href=destination.href;
      return;
    }
    // In a normal browser, preserve the original behavior: the live owner stays
    // in its tab and the requested JOINT section opens in another tab.
    const opened=window.open(destination.href,'_blank','noopener,noreferrer');
    if(!opened)openJointPageOverLive(destination.href);
    show('live-engagement-notice','Your live remains active. Use the Return to Live bar to come back without creating another broadcast.');
  });

})();
