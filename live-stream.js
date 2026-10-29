/* JOINT Live only. Independent of the JOINT Meetings implementation. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { db:null, user:null, session:null, participant:null, channel:null, pc:null, localStream:null, remoteStream:null, role:null, makingOffer:false, activityCount:0, reactionCount:0, giftCount:0, giftDiamondTotal:0, presenceChannel:null, giftAnimationUntil:0, selectedGift:null, sfuSessionId:null, sfuPeer:null, sfuRole:null, targetSessionId:null, sfuSubscribedPublishers:new Set(), sfuSubscribeQueue:Promise.resolve(), remotePublisherInProgress:null, eventCache:[], publisherPollTimer:null };
  const show = (id, message, error=false) => { const el=$(id); if(!el) return; el.textContent=message; el.classList.add('show'); el.style.background=error?'#fff0f0':''; el.style.color=error?'#a52834':''; };
  const setStatus = (message, error=false) => { const el=$('live-call-status'); if(el){el.textContent=message;el.style.color=error?'#a52834':'';} };
  const randomCode = () => { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes=new Uint8Array(8); crypto.getRandomValues(bytes); return Array.from(bytes,b=>chars[b%chars.length]).join(''); };
  async function getDb(){
    if (window.jointSupabaseConnection) return await window.jointSupabaseConnection;
    await new Promise((resolve,reject)=>{ const script=document.createElement('script'); script.src='./supabase.js'; script.onload=()=>window.jointSupabaseConnection?resolve():reject(new Error('JOINT Supabase did not initialize.')); script.onerror=()=>reject(new Error('Could not load supabase.js.')); document.head.appendChild(script); });
    return await window.jointSupabaseConnection;
  }
  async function init(){
    state.db=await getDb();
    const {data,error}=await state.db.auth.getUser();
    if(error || !data?.user) throw new Error('Please sign in to JOINT before hosting or joining a live stream.');
    state.user=data.user;
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
      state.giftAnimationUntil=Date.now()+3200;
      tiles.forEach(tile=>{const overlay=document.createElement('div');overlay.className='live-stage-overlay';const floater=document.createElement('div');floater.className='live-floating-gift';const icon=document.createElement('b');icon.textContent=item.emoji||'🎁';const label=document.createElement('span');label.textContent=(item.sender||'Someone')+' sent '+(item.gift_name||'a gift');floater.append(icon,label);overlay.append(floater);tile.append(overlay);setTimeout(()=>overlay.remove(),3200);});
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
    if(item.id&&!state.eventCache.some(e=>e.id===item.id))state.eventCache.push(item);updateHostEngagementStats();updateStreamerOverlays();
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
  async function startMedia(){
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires HTTPS and a supported browser.');
    state.localStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:true});
    $('live-video-grid').replaceChildren(); addVideo('live-video-grid','You',state.localStream,true);
  }
  function makePeer(){
    state.pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    state.remoteStream=new MediaStream();
    state.pc.ontrack=e=>{ e.streams[0]?.getTracks().forEach(t=>{if(!state.remoteStream.getTracks().some(x=>x.id===t.id))state.remoteStream.addTrack(t);}); $('live-video-grid').querySelectorAll('.live-video-tile.remote').forEach(n=>n.remove()); const wrap=document.createElement('div');wrap.className='live-video-tile remote';const v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.srcObject=state.remoteStream;const tag=document.createElement('span');tag.className='live-video-label';tag.textContent='Live partner';wrap.append(v,tag);$('live-video-grid').append(wrap); };
    state.localStream.getTracks().forEach(t=>state.pc.addTrack(t,state.localStream));
    state.pc.onicecandidate=e=>{if(e.candidate&&state.channel)state.channel.send({type:'broadcast',event:'signal',payload:{kind:'ice',candidate:e.candidate.toJSON(),from:state.user.id}});};
    state.pc.onconnectionstatechange=()=>setStatus(({connected:'Connected — live video is running.',connecting:'Connecting live video…',disconnected:'Video connection interrupted. Waiting to reconnect…',failed:'Connection failed. Check network/TURN configuration.',closed:'Live connection ended.'})[state.pc.connectionState]||'Setting up live connection…',state.pc.connectionState==='failed');
  }
  async function subscribeRoom(code, isHost){
    state.channel=state.db.channel('joint-live-'+code,{config:{broadcast:{self:false}}});
    state.channel.on('broadcast',{event:'signal'},async ({payload})=>{
      if(!payload||payload.from===state.user.id||!state.pc)return;
      try{
        if(payload.kind==='offer'&&!isHost){await state.pc.setRemoteDescription(payload.description);const answer=await state.pc.createAnswer();await state.pc.setLocalDescription(answer);await state.channel.send({type:'broadcast',event:'signal',payload:{kind:'answer',description:state.pc.localDescription,from:state.user.id}});}
        else if(payload.kind==='answer'&&isHost){await state.pc.setRemoteDescription(payload.description);}
        else if(payload.kind==='ice'&&payload.candidate){await state.pc.addIceCandidate(payload.candidate);}
      }catch(e){console.error('JOINT Live signaling error',e);setStatus('Could not establish the live connection. Please retry.',true);}
    });
    state.channel.on('broadcast',{event:'live-activity'},({payload})=>{if(!payload||payload.from===state.user.id)return;appendActivity(payload);});
    const result=await state.channel.subscribe(); if(result==='CHANNEL_ERROR'||result==='TIMED_OUT')throw new Error('Could not connect to the live room signaling channel.');
  }
  async function sfuCall(action, extra={}){
    const {data:{session}}=await state.db.auth.getSession();
    if(!session?.access_token) throw new Error('Your JOINT sign-in expired. Please sign in again.');
    const {data,error}=await state.db.functions.invoke('joint-live-sfu',{body:{action,live_session_id:state.session?.id,room_code:state.session?.room_code,...extra}});
    if(error) throw new Error(error.message||'JOINT Live SFU request failed.');
    if(!data||data.ok===false) throw new Error(data?.error||data?.errorDescription||'JOINT Live SFU request failed.');
    return data;
  }
  function waitForIce(pc, timeout=10000){
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};const check=()=>{if(pc.iceGatheringState==='complete')finish();};const timer=setTimeout(finish,timeout);pc.addEventListener('icegatheringstatechange',check);});
  }
  function attachRemoteTrack(event, label='Live host', publisherId=null){
    const grid=$('live-video-grid');
    // Cloudflare may deliver microphone and camera as separate ontrack events. Audio
    // must not create a second black video tile; that was the source of the double-screen bug.
    if(event.track?.kind==='audio'){
      let audio=[...grid.querySelectorAll('audio[data-live-remote-audio]')].find(a=>a.dataset.trackId===event.track.id);
      if(!audio){audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.dataset.liveRemoteAudio='1';audio.dataset.trackId=event.track.id;audio.style.display='none';audio.srcObject=new MediaStream([event.track]);grid.append(audio);}
      audio.play().catch(()=>{});return;
    }
    if(event.track?.kind!=='video')return;
    const stream=event.streams?.[0] || new MediaStream([event.track]);
    const streamKey=stream.id || event.track.id;
    let tile=[...grid.querySelectorAll('.live-video-tile.remote')].find(node=>node.dataset.trackId===event.track.id||node.dataset.streamKey===streamKey);
    if(!tile){
      tile=document.createElement('div');tile.className='live-video-tile remote';tile.dataset.streamKey=streamKey;tile.dataset.trackId=event.track.id;if(publisherId||state.remotePublisherInProgress)tile.dataset.userId=publisherId||state.remotePublisherInProgress;
      const v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.controls=false;v.muted=false;v.srcObject=stream;
      const tag=document.createElement('span');tag.className='live-video-label';tag.textContent=label;
      tile.append(v,tag);grid.append(tile);updateStageLayout();
    }else{
      const v=tile.querySelector('video');
      if(v.srcObject!==stream){try{if(v.srcObject instanceof MediaStream&&!v.srcObject.getTracks().some(t=>t.id===event.track.id))v.srcObject.addTrack(event.track);else v.srcObject=stream;}catch(_){v.srcObject=stream;}}
    }
    const panel=$('live-call-panel');
    if(state.role==='viewer')panel?.classList.add('viewer-mode');else panel?.classList.remove('viewer-mode');
    updateStageLayout();updateStreamerOverlays();
    tile.querySelector('video').play().catch(()=>setStatus('Live is connected. Tap the video to start playback if your browser blocks autoplay.'));
  }
  async function createSfuConnection(role){
    state.sfuRole=role;
    const created=await sfuCall('create-session');state.sfuSessionId=created.session_id;
    state.sfuPeer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});
    state.sfuPeer.ontrack=e=>attachRemoteTrack(e,role==='viewer'?'Live stream':'Live partner',state.remotePublisherInProgress);
    state.sfuPeer.onconnectionstatechange=()=>setStatus(({connected:'Connected — live video is running.',connecting:'Connecting live video…',disconnected:'Video connection interrupted. Waiting to reconnect…',failed:'Connection failed. Please retry the live stream.',closed:'Live connection ended.'})[state.sfuPeer?.connectionState]||'Setting up live connection…',state.sfuPeer?.connectionState==='failed');
    return state.sfuPeer;
  }
  async function publishToSfu(){
    const pc=await createSfuConnection(state.role==='host'?'host':'guest');
    const tracks=[];
    for(const track of state.localStream.getTracks()){
      const transceiver=pc.addTransceiver(track,{direction:'sendonly',streams:[state.localStream]});
      tracks.push({location:'local',mid:transceiver.mid,trackName:track.kind==='audio'?'microphone':'camera'});
    }
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);await waitForIce(pc);
    // Transceiver mids are assigned after createOffer/setLocalDescription.
    const localTracks=pc.getTransceivers().filter(t=>t.sender.track).map(t=>({location:'local',mid:t.mid,trackName:t.sender.track.kind==='audio'?'microphone':'camera'}));
    const published=await sfuCall('publish',{session_description:pc.localDescription,tracks:localTracks});
    if(!published.sessionDescription)throw new Error('Cloudflare did not return a publishing answer.');
    await pc.setRemoteDescription(published.sessionDescription);
  }
  async function subscribeToSfuPublishers(requestedIds=null){
    const run=async()=>{
      let pc=state.sfuPeer;
      if(!pc)pc=await createSfuConnection(state.role==='viewer'?'viewer':state.role);
      let ids=requestedIds;
      if(!ids){
        const participants=await state.db.from('joint_live_participants').select('user_id,role,status').eq('session_id',state.session.id).eq('status','connected').in('role',['host','guest']);
        if(participants.error)throw participants.error;
        ids=[...new Set([state.session.host_user_id,...(participants.data||[]).map(p=>p.user_id)])];
      }
      const publishers=ids.filter(id=>id&&id!==state.user.id&&!state.sfuSubscribedPublishers.has(id));
      let subscribed=false;
      for(const publisher_user_id of publishers){
        state.remotePublisherInProgress=publisher_user_id;
        let result;
        try{result=await sfuCall('subscribe',{publisher_user_id});}catch(err){if(/not published|has not published|preparing|Create your Cloudflare/i.test(err.message))continue;throw err;}
        if(!result.sessionDescription)continue;
        await pc.setRemoteDescription(result.sessionDescription);
        const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await waitForIce(pc);
        await sfuCall('renegotiate',{session_description:pc.localDescription});
        state.sfuSubscribedPublishers.add(publisher_user_id);subscribed=true;
      }
      state.remotePublisherInProgress=null;
      if(!subscribed&&state.role==='viewer'&&!state.sfuSubscribedPublishers.size)throw new Error('The host is preparing the stream. Please try joining again in a few seconds.');
    };
    state.sfuSubscribeQueue=state.sfuSubscribeQueue.then(run,run);return state.sfuSubscribeQueue;
  }
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
    state.channel.on('broadcast',{event:'live-activity'},({payload})=>{if(payload&&payload.from!==state.user.id){appendActivity(payload);if(payload.id&&!state.eventCache.some(e=>e.id===payload.id))state.eventCache.push(payload);updateStreamerOverlays();}});
    state.channel.on('broadcast',{event:'live-comment'},({payload})=>{if(payload&&payload.from!==state.user.id)appendComment(payload);});
    state.channel.on('broadcast',{event:'live-publisher-ready'},({payload})=>{if(payload?.from!==state.user.id&&payload?.user_id)subscribeToSfuPublishers([payload.user_id]).catch(e=>console.warn('Could not add live partner video',e));});
    state.channel.on('presence',{event:'sync'},()=>{
      const presence=state.channel.presenceState();
      const count=Object.values(presence).reduce((n,entries)=>n+(Array.isArray(entries)?entries.length:0),0);
      const label=$('live-viewer-count');if(label)label.textContent='👁 '+Math.max(0,count)+' watching';updateStreamerOverlays();
    });
    const status=await state.channel.subscribe(async (status)=>{if(status==='SUBSCRIBED'){try{await state.channel.track({user_id:state.user.id,role:state.role||'viewer',joined_at:new Date().toISOString()});}catch(e){console.warn('Live presence tracking unavailable',e);}startPublisherDiscovery();}});
  }
  function appendComment(item){
    // Keep the full activity history below the controls, and also show a short,
    // transparent rolling overlay at the bottom of each visible video tile.
    const feed=$('live-activity-feed');
    if(feed){
      if(feed.children.length===1&&feed.textContent.includes('Live activity will appear here'))feed.replaceChildren();
      const row=document.createElement('div');row.className='live-feed-item';
      const icon=document.createElement('span');icon.className='live-feed-emoji';icon.textContent='💬';
      const body=document.createElement('span');body.textContent=(item.sender||'JOINT member')+': '+String(item.text||'').slice(0,300);
      row.append(icon,body);feed.prepend(row);while(feed.children.length>30)feed.lastElementChild.remove();
    }
    const tiles=[...($('live-video-grid')?.querySelectorAll('.live-video-tile')||[])];
    tiles.forEach(tile=>{
      let overlay=tile.querySelector('.live-comment-overlay');
      if(!overlay){overlay=document.createElement('div');overlay.className='live-comment-overlay';overlay.setAttribute('aria-live','polite');overlay.setAttribute('aria-label','Recent live comments');tile.append(overlay);}
      // Remove oldest lines first; only the latest three remain visible.
      while(overlay.children.length>=3){const oldest=overlay.firstElementChild;if(!oldest)break;oldest.classList.add('is-leaving');setTimeout(()=>oldest.remove(),280);if(overlay.children.length<=3)break;}
      const line=document.createElement('div');line.className='live-comment-line';
      const name=document.createElement('span');name.className='live-comment-name';name.textContent=(item.sender||'JOINT member')+': ';
      const message=document.createElement('span');message.textContent=String(item.text||'').slice(0,300);
      line.append(name,message);overlay.append(line);
      while(overlay.children.length>3)overlay.firstElementChild.remove();
      // Comments are transient on the video; they remain in the activity feed below.
      setTimeout(()=>{if(line.isConnected){line.classList.add('is-leaving');setTimeout(()=>line.remove(),300);}},7000);
    });
  }
  async function host(){
    await init(); const title=$('live-title').value.trim(); if(!title)throw new Error('Enter a live session title.');
    await startMedia();
    let code=randomCode(), created;
    for(let attempt=0;attempt<4;attempt++){
      created=await state.db.from('joint_live_sessions').insert({host_user_id:state.user.id,title,description:$('live-description').value.trim(),audience:$('live-audience').value,room_code:code,status:'live',started_at:new Date().toISOString()}).select().single();
      if(!created.error)break; if(!/duplicate|unique/i.test(created.error.message||''))throw created.error; code=randomCode();
    }
    if(created.error)throw created.error;
    state.session=created.data;state.sfuSubscribedPublishers.clear();state.eventCache=[];state.role='host';$('live-host-engagement-stats').hidden=false;state.reactionCount=0;state.giftCount=0;state.giftDiamondTotal=0;updateHostEngagementStats();$('live-engagement-panel').hidden=true;
    const p=await state.db.from('joint_live_participants').insert({session_id:state.session.id,user_id:state.user.id,role:'host',status:'connected'}).select().single(); if(p.error)throw p.error;state.participant=p.data;
    await setupEngagementChannel();
    await publishToSfu();
    await loadHostEngagementStats();
    if(state.channel)await state.channel.send({type:'broadcast',event:'live-publisher-ready',payload:{user_id:state.user.id,from:state.user.id}});
    $('live-room-code-display').textContent=code;$('live-room-share').hidden=false;$('live-room-code-wrap').hidden=state.session.audience!=='invite';$('live-add-guest').hidden=state.session.audience==='invite';$('live-end-button').hidden=false;$('host-live').hidden=true;$('open-host-live').setAttribute('aria-expanded','false');openCall();setStatus(state.session.audience==='invite'?'You are live. Share the private room code with authorized people.':'You are live publicly. You can stay on screen alone; use ＋ to invite one guest.');

  }
  function parseCode(raw){const val=raw.trim();try{const u=new URL(val);return (u.searchParams.get('room')||u.searchParams.get('code')||u.pathname.split('/').filter(Boolean).pop()||val).toUpperCase().replace(/[^A-Z0-9]/g,'');}catch(_){return val.toUpperCase().replace(/[^A-Z0-9]/g,'');}}
  async function join(){
    await init();const code=parseCode($('live-room-code').value);let found; if(state.targetSessionId){found=await state.db.from('joint_live_sessions').select('*').eq('id',state.targetSessionId).eq('status','live').maybeSingle();state.targetSessionId=null;}else{if(!code)throw new Error('Choose a public live card or enter a room code or invitation link.');found=await state.db.from('joint_live_sessions').select('*').eq('room_code',code).eq('status','live').maybeSingle();}if(found.error)throw found.error;if(!found.data)throw new Error('No active live stream was found for that room code.');
    const session=found.data;if(session.host_user_id===state.user.id)throw new Error('You are already the host of this live stream.');
    state.session=session;state.sfuSubscribedPublishers.clear();state.eventCache=[]; state.role=$('live-join-mode').value==='viewer'?'viewer':'guest'; $('live-host-engagement-stats').hidden=!['host','guest'].includes(state.role); $('live-engagement-panel').hidden=state.role!=='viewer';
    $('live-call-panel').classList.toggle('viewer-mode',state.role==='viewer');
    if(state.role==='viewer'){await setupEngagementChannel();await subscribeToSfuPublishers();openCall();await loadHostEngagementStats();updateStreamerOverlays();$('live-room-share').hidden=true;$('live-end-button').hidden=true;setStatus('Watching live.');return;}
    const existing=await state.db.from('joint_live_participants').select('id,role,status').eq('session_id',session.id).eq('status','connected');if(existing.error)throw existing.error;if((existing.data||[]).length>=2)throw new Error('This live stream already has two connected on-screen participants.');
    const inserted=await state.db.from('joint_live_participants').insert({session_id:session.id,user_id:state.user.id,role:'guest',status:'connected'}).select().single();if(inserted.error){if(/capacity|two participants|full/i.test(inserted.error.message||''))throw new Error('This live stream is full. Only two on-screen participants are allowed.');throw inserted.error;}
    state.participant=inserted.data;await setupEngagementChannel();await startMedia();await publishToSfu();await subscribeToSfuPublishers([session.host_user_id]);await state.channel.send({type:'broadcast',event:'live-publisher-ready',payload:{user_id:state.user.id,from:state.user.id}});await loadHostEngagementStats();openCall();$('live-room-code-display').textContent=session.room_code;$('live-room-share').hidden=true;$('live-end-button').hidden=true;setStatus('Joined on screen. Live video is connected.');
  }
  async function cleanup(endSession=false){
    if(state.publisherPollTimer){clearInterval(state.publisherPollTimer);state.publisherPollTimer=null;}
    try{if(state.channel)await state.db.removeChannel(state.channel);}catch(_){}state.channel=null;
    if(state.sfuSessionId&&state.session){try{await sfuCall('close');}catch(e){console.warn('Could not close Cloudflare Live session cleanly',e);}}state.sfuSessionId=null;if(state.sfuPeer){state.sfuPeer.close();state.sfuPeer=null;}if(state.pc){state.pc.close();state.pc=null;}if(state.localStream){state.localStream.getTracks().forEach(t=>t.stop());state.localStream=null;}
    if(state.participant&&state.db){await state.db.from('joint_live_participants').update({status:'left',left_at:new Date().toISOString()}).eq('id',state.participant.id);}
    if(endSession&&state.session&&state.role==='host'){await state.db.from('joint_live_sessions').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',state.session.id).eq('host_user_id',state.user.id);}
    state.session=null;state.participant=null;state.role=null;state.sfuSubscribedPublishers.clear();state.eventCache=[];$('live-host-engagement-stats').hidden=true;$('live-call-panel').classList.remove('viewer-mode');$('live-video-grid').replaceChildren();$('live-room-share').hidden=true;$('live-end-button').hidden=true;$('live-comment-form').hidden=true;$('live-call-panel').hidden=true;setStatus('Live session ended.');loadRecaps();
  }
  const wrapError=(id,fn)=>async e=>{e.preventDefault();show(id,'Connecting…');try{await fn();}catch(err){console.error(err);show(id,err?.message||'Live action failed. Check the JOINT Live database setup.',true);if(state.localStream&&!state.session)state.localStream.getTracks().forEach(t=>t.stop());}};
  $('live-host-form').addEventListener('submit',wrapError('host-notice',host));
  $('live-join-form').addEventListener('submit',wrapError('join-notice',join));
  $('live-end-button').addEventListener('click',()=>cleanup(true));
  $('live-leave-button').addEventListener('click',()=>cleanup(false));
  $('live-add-guest')?.addEventListener('click',()=>{const codeWrap=$('live-room-code-wrap');if(!codeWrap)return;codeWrap.hidden=!codeWrap.hidden;const button=$('live-add-guest');button.setAttribute('aria-expanded',String(!codeWrap.hidden));setStatus(codeWrap.hidden?'You are live alone. Tap ＋ whenever you want to invite one guest.':'Share this code with the one person you want to join on screen. Public viewers can continue watching without a code.');});
  $('live-copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('live-room-code-display').textContent);setStatus('Room code copied.');}catch(_){setStatus('Room code: '+$('live-room-code-display').textContent);}});
  document.querySelectorAll('[data-live-reaction]').forEach(button=>button.addEventListener('click',async()=>{try{await recordActivity({kind:'reaction',reaction:button.dataset.liveReaction,emoji:button.dataset.liveReaction});}catch(err){show('live-engagement-notice',err.message,true);}}));
  async function loadPublicLives(){
    const list=$('live-public-list');if(!list)return;
    list.innerHTML='<div class="live-summary-empty"><strong>Loading active public lives…</strong></div>';
    try{
      await init();
      const result=await state.db.from('joint_live_sessions').select('id,title,description,host_user_id,room_code,started_at,audience,status').eq('status','live').eq('audience','public').order('started_at',{ascending:false}).limit(40);
      if(result.error)throw result.error;
      let sessions=(result.data||[]).filter(s=>s.host_user_id!==state.user.id);
      if(!sessions.length){list.innerHTML='<div class="live-summary-empty"><strong>No public live sessions right now</strong><p>When a member starts a public live, it can appear here.</p></div>';return;}
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
        const avatar=profile.avatar_url||profile.photo_url||profile.profile_picture_url||profile.profile_image_url||profile.avatar||profile.photo||'';
        const avatarEl=avatar?document.createElement('img'):document.createElement('div');avatarEl.className='live-public-avatar';
        if(avatar){avatarEl.src=avatar;avatarEl.alt=(profile.display_name||'Live host')+' profile picture';avatarEl.loading='lazy';avatarEl.onerror=()=>{const fallback=document.createElement('div');fallback.className='live-public-avatar';fallback.textContent=(profile.display_name||session.title||'J').trim().slice(0,1).toUpperCase();avatarEl.replaceWith(fallback);};}
        else avatarEl.textContent=(profile.display_name||session.title||'J').trim().slice(0,1).toUpperCase();
        avatarEl.setAttribute('aria-label','Open live host profile');
        const profileLink=document.createElement('a');profileLink.className='live-public-profile-link';profileLink.href='member-profile.html?id='+encodeURIComponent(session.host_user_id);profileLink.setAttribute('aria-label','Open '+(profile.display_name||profile.username||'host')+' profile');profileLink.append(avatarEl);
        const badge=document.createElement('span');badge.className='live-badge';badge.textContent='● LIVE';
        const title=document.createElement('h3');title.textContent=profile.display_name||profile.username||'JOINT member';
        const titleLink=document.createElement('a');titleLink.className='live-public-title-link';titleLink.href='member-profile.html?id='+encodeURIComponent(session.host_user_id);titleLink.append(title);
        const liveTitle=document.createElement('p');liveTitle.className='live-public-title';liveTitle.textContent=session.title||'Live now';
        if(followed.has(session.host_user_id)){const following=document.createElement('span');following.className='live-following-badge';following.textContent='Following';card.append(following);}
        const desc=document.createElement('p');desc.textContent=session.description||'Tap to watch live';
        const time=document.createElement('p');time.className='live-public-time';time.textContent='Started '+(session.started_at?new Date(session.started_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'recently');
        const button=document.createElement('button');button.className='live-btn live-full';button.type='button';button.textContent='Watch live';
        const openPublicLive=()=>{state.targetSessionId=session.id;$('live-room-code').value='';$('live-join-mode').value='viewer';$('join-live').hidden=true;$('open-join-live').setAttribute('aria-expanded','false');$('live-join-form').requestSubmit();};
        button.addEventListener('click',openPublicLive);
        profileLink.addEventListener('click',ev=>ev.stopPropagation());titleLink.addEventListener('click',ev=>ev.stopPropagation());
        card.append(profileLink,badge,titleLink,liveTitle,desc,time,button);list.append(card);
      });
    }catch(err){console.warn('Public JOINT Live list unavailable',err);list.innerHTML='<div class="live-summary-empty"><strong>Public lives could not load</strong><p>Check the JOINT Live database policies and connection.</p></div>';}
  }
  $('live-reaction-control')?.addEventListener('click',()=>{const row=$('live-reaction-options');if(row)row.hidden=!row.hidden;});
  $('live-comment-control')?.addEventListener('click',()=>{const form=$('live-comment-form');if(!form)return;form.hidden=!form.hidden;if(!form.hidden)$('live-comment-input')?.focus();});
  $('live-comment-form')?.addEventListener('submit',async ev=>{
    ev.preventDefault();const input=$('live-comment-input'),text=(input?.value||'').trim();
    if(!text)return;if(!state.session||!state.channel){show('live-engagement-notice','Join a live session before commenting.',true);return;}
    const sender=state.user?.user_metadata?.full_name||state.user?.user_metadata?.name||state.user?.email?.split('@')[0]||'JOINT member';
    const payload={text:text.slice(0,300),sender,from:state.user.id};appendComment(payload);
    try{await state.channel.send({type:'broadcast',event:'live-comment',payload});if(input)input.value='';$('live-comment-form').hidden=true;}catch(err){show('live-engagement-notice','Comment could not be sent. Please try again.',true);}
  });
  $('live-share-control')?.addEventListener('click',async()=>{
    if(!state.session){show('live-engagement-notice','Join a live before sharing.',true);return;}
    const url=new URL(location.href);url.searchParams.set('room',state.session.room_code||'');
    try{if(navigator.share)await navigator.share({title:state.session.title||'JOINT Live',text:'Watch this JOINT Live session',url:url.toString()});else if(navigator.clipboard){await navigator.clipboard.writeText(url.toString());show('live-engagement-notice','Live link copied.');}else show('live-engagement-notice','Share this room code: '+(state.session.room_code||''));}catch(err){if(err?.name!=='AbortError')show('live-engagement-notice','Could not share this live link.',true);}
  });
  const giftModal=$('live-gift-modal'), giftForm=$('live-gift-payment-form'), giftSelected=$('live-gift-selected'), giftConfirm=$('confirm-live-gift');
  document.getElementById('open-live-gifts')?.addEventListener('click',()=>{if(!state.session){show('live-engagement-notice','Join a live session before sending gifts.',true);return;}giftModal.hidden=false;});
  document.getElementById('close-live-gifts')?.addEventListener('click',()=>{giftModal.hidden=true;$('live-gift-pin').value='';});
  document.querySelectorAll('#live-gift-modal-grid [data-live-gift]').forEach(button=>button.addEventListener('click',()=>{
    state.selectedGift={name:button.dataset.liveGift,emoji:button.dataset.giftEmoji,value:Number(button.dataset.giftValue)};
    giftSelected.textContent=state.selectedGift.emoji+' '+state.selectedGift.name+' · '+state.selectedGift.value.toLocaleString()+' Diamonds selected. Enter your wallet PIN to continue.';
    giftConfirm.disabled=false;
  }));
  giftForm?.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(!state.selectedGift||!state.session)return;
    const pin=$('live-gift-pin').value;
    if(!/^\\d{6}$/.test(pin)){giftSelected.textContent='Enter your six-digit Diamond Wallet PIN.';return;}
    giftConfirm.disabled=true;giftSelected.textContent='Verifying and processing securely…';
    try{
      // Do not debit or credit on the client. This RPC must atomically verify PIN,
      // debit sender, credit host and write the transaction on the server.
      const payment=await state.db.rpc('joint_live_send_gift',{p_session_id:state.session.id,p_gift_name:state.selectedGift.name,p_gift_emoji:state.selectedGift.emoji,p_diamond_amount:state.selectedGift.value,p_pin:pin});
      if(payment.error)throw new Error(payment.error.message||'Secure gift payment is not configured.');
      if(!payment.data||payment.data.ok!==true)throw new Error(payment.data?.error||'Gift payment was not confirmed. No gift was sent.');
      await recordActivity({kind:'gift',gift_name:state.selectedGift.name,emoji:state.selectedGift.emoji,diamond_value:state.selectedGift.value});
      giftModal.hidden=true;giftForm.reset();state.selectedGift=null;giftSelected.textContent='Select a gift above.';
    }catch(err){giftSelected.textContent='Gift not sent: '+err.message;giftSelected.style.color='#a52834';}
    finally{giftConfirm.disabled=!state.selectedGift;}
  });
  $('refresh-live-list')?.addEventListener('click',()=>{const list=$('live-public-list');if(list){const expanded=list.classList.toggle('expanded');$('refresh-live-list').textContent=expanded?'Show less':'View more';if(!expanded)list.scrollTo({left:0,behavior:'smooth'});}});
  loadPublicLives();
  loadRecaps();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.pc?.connectionState==='failed')setStatus('Connection interrupted. Return to the page and retry if needed.',true);});
})();
