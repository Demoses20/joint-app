/* JOINT Live only. Independent of the JOINT Meetings implementation. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { db:null, user:null, session:null, participant:null, channel:null, pc:null, localStream:null, remoteStream:null, role:null, makingOffer:false, activityCount:0 };
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
  function appendActivity(item, animate=true){
    const feed=$('live-activity-feed'); if(!feed)return;
    if(feed.children.length===1 && feed.textContent.includes('Live activity will appear here'))feed.replaceChildren();
    const row=document.createElement('div');row.className='live-feed-item'+(item.kind==='gift'?' gift':'');
    const emoji=document.createElement('span');emoji.className='live-feed-emoji';emoji.textContent=item.emoji|| (item.kind==='gift'?'🎁':'✨');
    const text=document.createElement('span');
    if(item.kind==='gift') text.textContent=(item.sender||'A JOINT member')+' sent '+(item.gift_name||'a gift')+(item.diamond_value?' · '+item.diamond_value+' Diamonds':'');
    else text.textContent=(item.sender||'A JOINT member')+' reacted '+(item.reaction||'✨');
    row.append(emoji,text);feed.prepend(row);while(feed.children.length>30)feed.lastElementChild.remove();
    if(item.kind==='gift'){
      const tile=$('live-video-grid')?.querySelector('.live-video-tile');if(tile){const overlay=document.createElement('div');overlay.className='live-stage-overlay';const floater=document.createElement('div');floater.className='live-floating-gift';const icon=document.createElement('b');icon.textContent=item.emoji||'🎁';const label=document.createElement('span');label.textContent=(item.sender||'Someone')+' sent '+(item.gift_name||'a gift');floater.append(icon,label);overlay.append(floater);tile.append(overlay);setTimeout(()=>overlay.remove(),3100);}
    }
    state.activityCount++;
  }
  async function recordActivity(item){
    if(!state.db||!state.session||!state.user)throw new Error('Join a live room before reacting or sending a gift.');
    const payload={session_id:state.session.id,user_id:state.user.id,kind:item.kind,reaction:item.reaction||null,gift_name:item.gift_name||null,gift_emoji:item.emoji||null,diamond_value:item.diamond_value||0};
    const {data,error}=await state.db.from('joint_live_events').insert(payload).select('id,kind,reaction,gift_name,gift_emoji,diamond_value,created_at').single();
    if(error)throw new Error('Could not save live activity. Confirm the JOINT Live SQL update has been applied. '+error.message);
    const profileName=state.user.user_metadata?.full_name||state.user.user_metadata?.name||state.user.email?.split('@')[0]||'JOINT member';
    const event={...data,kind:item.kind,emoji:item.emoji||data.gift_emoji||item.reaction,sender:profileName};
    appendActivity(event);
    if(state.channel) await state.channel.send({type:'broadcast',event:'live-activity',payload:{...event,from:state.user.id}});
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
    const wrap=document.createElement('div'); wrap.className='live-video-tile';
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
  async function host(){
    await init(); const title=$('live-title').value.trim(); if(!title)throw new Error('Enter a live session title.');
    await startMedia();
    let code=randomCode(), created;
    for(let attempt=0;attempt<4;attempt++){
      created=await state.db.from('joint_live_sessions').insert({host_user_id:state.user.id,title,description:$('live-description').value.trim(),audience:$('live-audience').value,room_code:code,status:'live',started_at:new Date().toISOString()}).select().single();
      if(!created.error)break; if(!/duplicate|unique/i.test(created.error.message||''))throw created.error; code=randomCode();
    }
    if(created.error)throw created.error;
    state.session=created.data;state.role='host';
    const p=await state.db.from('joint_live_participants').insert({session_id:state.session.id,user_id:state.user.id,role:'host',status:'connected'}).select().single(); if(p.error)throw p.error;state.participant=p.data;
    await subscribeRoom(code,true);makePeer();
    $('live-room-code-display').textContent=code;$('live-room-share').hidden=false;$('live-end-button').hidden=false;openCall();setStatus('You are live. Share this room code with one person to invite them on screen.');
    state.channel.on('broadcast',{event:'guest-ready'},async ({payload})=>{if(payload?.from===state.user.id||!state.pc)return;try{state.makingOffer=true;const offer=await state.pc.createOffer();await state.pc.setLocalDescription(offer);await state.channel.send({type:'broadcast',event:'signal',payload:{kind:'offer',description:state.pc.localDescription,from:state.user.id}});}catch(e){setStatus('Could not start the partner connection: '+e.message,true);}finally{state.makingOffer=false;}});
  }
  function parseCode(raw){const val=raw.trim();try{const u=new URL(val);return (u.searchParams.get('room')||u.searchParams.get('code')||u.pathname.split('/').filter(Boolean).pop()||val).toUpperCase().replace(/[^A-Z0-9]/g,'');}catch(_){return val.toUpperCase().replace(/[^A-Z0-9]/g,'');}}
  async function join(){
    await init();const code=parseCode($('live-room-code').value);if(!code)throw new Error('Enter a room code or invitation link.');
    const found=await state.db.from('joint_live_sessions').select('*').eq('room_code',code).eq('status','live').maybeSingle();if(found.error)throw found.error;if(!found.data)throw new Error('No active live stream was found for that room code.');
    const session=found.data;if(session.host_user_id===state.user.id)throw new Error('You are already the host of this live stream.');
    if($('live-join-mode').value==='viewer')throw new Error('Viewer playback requires a broadcast distribution service. For this first two-person live connection, select “Request to join on screen”.');
    const existing=await state.db.from('joint_live_participants').select('id,role,status').eq('session_id',session.id).eq('status','connected');if(existing.error)throw existing.error;if((existing.data||[]).length>=2)throw new Error('This live stream already has two connected on-screen participants.');
    const inserted=await state.db.from('joint_live_participants').insert({session_id:session.id,user_id:state.user.id,role:'guest',status:'connected'}).select().single();if(inserted.error){if(/capacity|two participants|full/i.test(inserted.error.message||''))throw new Error('This live stream is full. Only two on-screen participants are allowed.');throw inserted.error;}
    state.session=session;state.participant=inserted.data;state.role='guest';await startMedia();await subscribeRoom(code,false);makePeer();openCall();$('live-room-code-display').textContent=code;$('live-room-share').hidden=false;$('live-end-button').hidden=false;setStatus('Joined. Waiting for the host to connect your video…');await state.channel.send({type:'broadcast',event:'guest-ready',payload:{from:state.user.id}});
  }
  async function cleanup(endSession=false){
    try{if(state.channel)await state.db.removeChannel(state.channel);}catch(_){}state.channel=null;
    if(state.pc){state.pc.close();state.pc=null;}if(state.localStream){state.localStream.getTracks().forEach(t=>t.stop());state.localStream=null;}
    if(state.participant&&state.db){await state.db.from('joint_live_participants').update({status:'left',left_at:new Date().toISOString()}).eq('id',state.participant.id);}
    if(endSession&&state.session&&state.role==='host'){await state.db.from('joint_live_sessions').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',state.session.id).eq('host_user_id',state.user.id);}
    state.session=null;state.participant=null;state.role=null;$('live-video-grid').replaceChildren();$('live-room-share').hidden=true;$('live-end-button').hidden=true;setStatus('Live session ended.');loadRecaps();
  }
  const wrapError=(id,fn)=>async e=>{e.preventDefault();show(id,'Connecting…');try{await fn();}catch(err){console.error(err);show(id,err?.message||'Live action failed. Check the JOINT Live database setup.',true);if(state.localStream&&!state.session)state.localStream.getTracks().forEach(t=>t.stop());}};
  $('live-host-form').addEventListener('submit',wrapError('host-notice',host));
  $('live-join-form').addEventListener('submit',wrapError('join-notice',join));
  $('live-end-button').addEventListener('click',()=>cleanup(true));
  $('live-leave-button').addEventListener('click',()=>cleanup(false));
  $('live-copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('live-room-code-display').textContent);setStatus('Room code copied.');}catch(_){setStatus('Room code: '+$('live-room-code-display').textContent);}});
  document.querySelectorAll('[data-live-reaction]').forEach(button=>button.addEventListener('click',async()=>{try{await recordActivity({kind:'reaction',reaction:button.dataset.liveReaction,emoji:button.dataset.liveReaction});}catch(err){show('live-engagement-notice',err.message,true);}}));
  document.querySelectorAll('[data-live-gift]').forEach(button=>button.addEventListener('click',async()=>{try{const value=Number(button.dataset.giftValue||0);if(!Number.isFinite(value)||value<1)throw new Error('This gift is not configured correctly.');await recordActivity({kind:'gift',gift_name:button.dataset.liveGift,emoji:button.dataset.giftEmoji,diamond_value:value});}catch(err){show('live-engagement-notice',err.message,true);}}));
  loadRecaps();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.pc?.connectionState==='failed')setStatus('Connection interrupted. Return to the page and retry if needed.',true);});
})();
