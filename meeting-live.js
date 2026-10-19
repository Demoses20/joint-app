/* JOINT live meeting tools: Supabase-backed room chat/media, presence, moderation and WebRTC mesh. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const params = new URLSearchParams(location.search), meetingId = params.get('meeting');
  let db, user, meeting, host = false, profile = {}, channel, pollTimer, localStream, recorder, voiceChunks = [], joined = false;
  const peers = new Map(), remoteStreams = new Map();
  const setStatus = (id, text, bad=false) => { const el=$(id); if(el){el.textContent=text;el.style.color=bad?'#a52834':'';} };
  const say = (text,bad=false) => setStatus('room-message',text,bad);
  const friendly = e => e?.message || String(e || 'Unknown error');
  async function waitClient(){
    for(let i=0;i<100;i++){ if(window.jointSupabaseConnection) return await window.jointSupabaseConnection; await new Promise(r=>setTimeout(r,100)); }
    throw new Error('Supabase connection did not initialize.');
  }
  async function boot(){
    if(!meetingId) return;
    try {
      db=await waitClient(); const auth=await db.auth.getUser(); user=auth.data?.user;
      if(!user) return;
      const res=await db.from('joint_meetings').select('*').eq('id',meetingId).maybeSingle();
      if(res.error || !res.data) throw res.error || new Error('Meeting not found.');
      meeting=res.data; host=meeting.host_id===user.id;
      if(['ended','cancelled'].includes(meeting.status)){say('This meeting has ended.');return;}
      const p=await db.from('joint_profiles').select('*').eq('id',user.id).maybeSingle(); profile=p.data||{};
      if(meeting.visibility==='private' && !host){
        const code=params.get('code');
        const inv=await db.from('joint_meeting_invitations').select('id,status').eq('meeting_id',meetingId).eq('invitee_id',user.id).in('status',['pending','accepted']).maybeSingle();
        if(!inv.data && meeting.invite_code!==code){say('You need the host invitation to join this private room.',true);return;}
      }
      const banner=$('meeting-banner-view'); if(banner && meeting.banner_url){const signed=await db.storage.from('joint-meeting-media').createSignedUrl(meeting.banner_url,3600); if(signed.data?.signedUrl){banner.src=signed.data.signedUrl;banner.hidden=false;}}
      if(host && $('host-live-controls')) $('host-live-controls').hidden=false;
      if($('switch-room-format')) $('switch-room-format').value=meeting.room_type||'Video meeting';
      bindActions(); await joinPresence(); await loadMessages(); await loadParticipants(); await loadMaterials();
      await connectRealtime();
      pollTimer=setInterval(()=>{loadParticipants();},12000);
      joined=true;
      const fmt=meeting.room_type||'Video meeting';
      const desc=$('stage-description'); if(desc) desc.textContent=fmt+' · Live room connected. Start camera/microphone if this format uses audio/video.';
      const title=$('stage-title'); if(title) title.textContent=meeting.title||'Meeting stage';
    } catch(e){console.error('Meeting live tools failed',e);say('Live tools could not start: '+friendly(e)+'. Run the included SQL migration and check Supabase policies.',true);}
  }
  function bindActions(){
    $('room-chat-form')?.addEventListener('submit',sendText);
    $('room-file')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)sendFile(f);e.target.value='';});
    $('record-voice')?.addEventListener('click',startVoice);
    $('stop-voice')?.addEventListener('click',stopVoice);
    $('start-live-media')?.addEventListener('click',startMedia);
    $('stop-live-media')?.addEventListener('click',stopMedia);
    $('apply-room-format')?.addEventListener('click',switchFormat);
    $('add-material')?.addEventListener('click',addMaterial);
    window.addEventListener('beforeunload',cleanup);
  }
  async function joinPresence(){
    const row={meeting_id:meetingId,user_id:user.id,display_name:profile.display_name||user.user_metadata?.display_name||user.email?.split('@')[0]||'JOINT member',avatar_url:profile.avatar_url||profile.photo_url||null,is_muted:false,is_kicked:false,left_at:null,joined_at:new Date().toISOString()};
    const r=await db.from('joint_meeting_live_participants').upsert(row,{onConflict:'meeting_id,user_id'});
    if(r.error) throw r.error;
  }
  async function connectRealtime(){
    channel=db.channel('joint-live-'+meetingId,{config:{broadcast:{self:false}}});
    channel.on('postgres_changes',{event:'*',schema:'public',table:'joint_meeting_room_messages',filter:'meeting_id=eq.'+meetingId},()=>loadMessages());
    channel.on('postgres_changes',{event:'*',schema:'public',table:'joint_meeting_live_participants',filter:'meeting_id=eq.'+meetingId},payload=>{loadParticipants();const r=payload.new;if(r?.user_id===user.id&&r.is_kicked){say('The host removed you from this meeting.',true);stopMedia();setTimeout(()=>location.href='meetings.html',1000);} if(r?.user_id===user.id&&r.is_muted){localStream?.getAudioTracks().forEach(t=>t.enabled=false);say('The host muted your microphone.');}});
    channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'joint_meetings',filter:'id=eq.'+meetingId},payload=>{if(payload.new?.room_type){meeting=payload.new;renderFormat();}});
    channel.on('broadcast',{event:'signal'},async ({payload})=>handleSignal(payload));
    channel.on('broadcast',{event:'room-format'},({payload})=>{if(payload?.room_type){meeting.room_type=payload.room_type;renderFormat();}});
    channel.on('broadcast',{event:'participant-hello'},async ({payload})=>{if(payload?.user_id&&payload.user_id!==user.id&&localStream&&user.id.localeCompare(payload.user_id)<0) await makeOffer(payload.user_id);});
    const status=await new Promise(resolve=>{channel.subscribe(s=>{if(s==='SUBSCRIBED')resolve(s); if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')resolve(s);});setTimeout(()=>resolve('TIMEOUT'),10000);});
    if(status!=='SUBSCRIBED') throw new Error('Supabase Realtime did not subscribe. Enable Realtime for meeting tables.');
    channel.send({type:'broadcast',event:'participant-hello',payload:{user_id:user.id}});
    if(localStream){const members=await db.from('joint_meeting_live_participants').select('user_id').eq('meeting_id',meetingId).is('left_at',null).eq('is_kicked',false);for(const member of (members.data||[])){if(member.user_id!==user.id&&user.id.localeCompare(member.user_id)<0)await makeOffer(member.user_id);}}
  }
  async function loadParticipants(){
    const target=$('live-participants'); if(!target||!db)return;
    const r=await db.from('joint_meeting_live_participants').select('*').eq('meeting_id',meetingId).is('left_at',null).eq('is_kicked',false).order('joined_at');
    if(r.error){target.textContent='Participants unavailable: '+friendly(r.error);return;}
    const rows=r.data||[]; const ids=rows.map(x=>x.user_id).filter(Boolean);
    let profiles={}; if(ids.length){const pr=await db.from('joint_profiles').select('id,display_name,avatar_url,photo_url,username').in('id',ids);(pr.data||[]).forEach(p=>profiles[p.id]=p);}
    target.innerHTML=rows.map(row=>{const p=profiles[row.user_id]||{},name=p.display_name||p.username||row.display_name||'JOINT member',avatar=p.avatar_url||p.photo_url||row.avatar_url,href='member-profile.html?id='+encodeURIComponent(row.user_id);return `<article class="participant" data-member="${esc(row.user_id)}"><a class="participant-profile-link" href="${href}" aria-label="Open ${esc(name)} profile">${avatar?`<img src="${esc(avatar)}" alt="${esc(name)} profile picture">`:'<span style="font-size:28px">👤</span>'}</a><a class="participant-name-link" href="${href}"><strong>${esc(name)}${row.user_id===meeting.host_id?' · Host':''}</strong></a><div class="muted">${row.is_muted?'🔇 Muted':'🟢 Joined'}${row.user_id===user.id?' · You':''}</div>${host&&row.user_id!==user.id?`<div class="post-tools"><button type="button" class="secondary" data-mute="${esc(row.user_id)}">${row.is_muted?'Unmute':'Mute'}</button><button type="button" class="danger" data-kick="${esc(row.user_id)}">Remove</button></div>`:''}</article>`;}).join('')||'<p>No participants yet.</p>';
    target.querySelectorAll('[data-mute]').forEach(b=>b.onclick=()=>moderate(b.dataset.mute,'mute',b));target.querySelectorAll('[data-kick]').forEach(b=>b.onclick=()=>moderate(b.dataset.kick,'kick',b));
    const grid=$('live-media-grid'); if(grid){const existing=new Set([...grid.querySelectorAll('[data-video-user]')].map(x=>x.dataset.videoUser)); for(const row of rows){if(row.user_id===user.id||existing.has(row.user_id))continue; const stream=remoteStreams.get(row.user_id);if(stream)addRemoteVideo(row.user_id,stream,profiles[row.user_id]?.display_name||row.display_name||'Participant');}}
  }
  async function moderate(id,action,button){
    if(!host)return; const label=action==='kick'?'Remove this member from the meeting?':'Change this member’s microphone mute status?';if(!confirm(label))return;button.disabled=true;
    const current=(await db.from('joint_meeting_live_participants').select('is_muted').eq('meeting_id',meetingId).eq('user_id',id).maybeSingle()).data;
    const changes=action==='kick'?{is_kicked:true,left_at:new Date().toISOString()}:{is_muted:!current?.is_muted};
    const r=await db.from('joint_meeting_live_participants').update(changes).eq('meeting_id',meetingId).eq('user_id',id);
    if(r.error){alert('Moderation failed: '+friendly(r.error));button.disabled=false;return;}setStatus('moderation-status',action==='kick'?'Member removed.':'Mute status updated.');await loadParticipants();
  }
  async function loadMessages(){
    const target=$('room-chat-log');if(!target||!db)return;
    const r=await db.from('joint_meeting_room_messages').select('*').eq('meeting_id',meetingId).eq('is_deleted',false).order('created_at',{ascending:true}).limit(250);
    if(r.error){target.textContent='Room messages unavailable: '+friendly(r.error);return;}
    const rows=r.data||[],ids=[...new Set(rows.map(x=>x.user_id))];let names={};if(ids.length){const p=await db.from('joint_profiles').select('id,display_name,username,avatar_url').in('id',ids);(p.data||[]).forEach(x=>names[x.id]=x.display_name||x.username||'JOINT member');}
    target.innerHTML=rows.map(m=>{let content='';if(m.message_type==='text')content=`<p>${esc(m.body||'')}</p>`;else if(m.message_type==='image')content=`<img src="${esc(m.signed_url||m.media_url||'')}" data-media-id="${esc(m.id)}" alt="Shared image" loading="lazy">`;else if(m.message_type==='video')content=`<video src="${esc(m.signed_url||m.media_url||'')}" data-media-id="${esc(m.id)}" controls playsinline></video>`;else if(m.message_type==='audio')content=`<audio src="${esc(m.signed_url||m.media_url||'')}" controls></audio>`;else content=`<a href="${esc(m.media_url||'#')}" target="_blank" rel="noopener">Open attachment</a>`;return `<article class="room-post"><strong>${esc(names[m.user_id]||m.display_name||'JOINT member')}</strong><span class="muted"> · ${esc(new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</span>${content}${host?`<div class="post-tools"><button type="button" class="secondary" data-delete-message="${esc(m.id)}">Delete message</button></div>`:''}</article>`;}).join('')||'<p class="muted">No messages yet. Start the conversation.</p>';target.scrollTop=target.scrollHeight;
    target.querySelectorAll('[data-delete-message]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this message for everyone?'))return;const d=await db.from('joint_meeting_room_messages').update({is_deleted:true,body:'',media_path:null,media_url:null}).eq('id',b.dataset.deleteMessage).eq('meeting_id',meetingId);if(d.error)alert('Could not delete message: '+friendly(d.error));else await loadMessages();});
  }
  async function sendText(e){e.preventDefault();const input=$('room-chat-input'),body=input?.value.trim();if(!body)return;if(await isMuted())return setStatus('upload-status','You are muted by the host and cannot send messages.',true);const result=await db.from('joint_meeting_room_messages').insert({meeting_id:meetingId,user_id:user.id,display_name:profile.display_name||user.email?.split('@')[0]||'JOINT member',message_type:'text',body});if(result.error){setStatus('upload-status','Message was not sent: '+friendly(result.error),true);return;}input.value='';setStatus('upload-status','');await loadMessages();}
  async function isMuted(){const r=await db.from('joint_meeting_live_participants').select('is_muted,is_kicked').eq('meeting_id',meetingId).eq('user_id',user.id).maybeSingle();if(r.data?.is_kicked){location.href='meetings.html';return true;}return !!r.data?.is_muted;}
  async function sendFile(file){if(file.size>100*1024*1024){setStatus('upload-status','Files must be smaller than 100 MB.',true);return;}if(!file.type.startsWith('image/')&&!file.type.startsWith('video/')){setStatus('upload-status','Choose an image or video file.',true);return;}if(await isMuted())return setStatus('upload-status','You are muted by the host.',true);setStatus('upload-status','Uploading media…');try{const ext=(file.name.split('.').pop()||'bin').replace(/[^a-z0-9]/gi,'').toLowerCase();const path=`room/${meetingId}/${user.id}/${crypto.randomUUID()}.${ext}`;const up=await db.storage.from('joint-meeting-media').upload(path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error;const type=file.type.startsWith('image/')?'image':'video';const ins=await db.from('joint_meeting_room_messages').insert({meeting_id:meetingId,user_id:user.id,display_name:profile.display_name||'JOINT member',message_type:type,media_path:path,body:file.name});if(ins.error)throw ins.error;setStatus('upload-status','Media shared.');await loadMessages();}catch(e){setStatus('upload-status','Upload failed: '+friendly(e),true);}}
  async function startVoice(){if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return setStatus('upload-status','Voice recording is not supported by this browser.',true);try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});voiceChunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)voiceChunks.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(voiceChunks,{type:recorder.mimeType||'audio/webm'});const ext=blob.type.includes('mp4')?'m4a':'webm';const file=new File([blob],`voice-note.${ext}`,{type:blob.type});await uploadAudio(file);};recorder.start();$('record-voice').hidden=true;$('stop-voice').hidden=false;setStatus('upload-status','Recording voice note… tap Stop & send when finished.');}catch(e){setStatus('upload-status','Microphone permission failed: '+friendly(e),true);}}
  function stopVoice(){if(recorder&&recorder.state!=='inactive'){recorder.stop();$('stop-voice').hidden=true;$('record-voice').hidden=false;}}
  async function uploadAudio(file){try{if(await isMuted())return;const path=`room/${meetingId}/${user.id}/${crypto.randomUUID()}.${file.name.split('.').pop()}`;const up=await db.storage.from('joint-meeting-media').upload(path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error;const ins=await db.from('joint_meeting_room_messages').insert({meeting_id:meetingId,user_id:user.id,display_name:profile.display_name||'JOINT member',message_type:'audio',media_path:path,body:'Voice note'});if(ins.error)throw ins.error;setStatus('upload-status','Voice note shared.');await loadMessages();}catch(e){setStatus('upload-status','Voice note failed: '+friendly(e),true);}}
  async function signedMedia(path){if(!path)return null;const r=await db.storage.from('joint-meeting-media').createSignedUrl(path,3600);return r.data?.signedUrl||null;}
  // Resolve private media to signed links before rendering; refresh URLs whenever messages reload.
  const originalLoadMessages=loadMessages;
  loadMessages=async function(){await originalLoadMessages();const imgs=$('room-chat-log')?.querySelectorAll('img[src=""],video[src=""],audio[src=""]');if(imgs)imgs.forEach(x=>x.remove());const r=await db.from('joint_meeting_room_messages').select('id,media_path').eq('meeting_id',meetingId).eq('is_deleted',false).not('media_path','is',null).order('created_at',{ascending:true}).limit(250);if(r.data){for(const m of r.data){const url=await signedMedia(m.media_path);const el=$('room-chat-log')?.querySelector(`[data-media-id="${CSS.escape(m.id)}"]`);if(el&&url)el.src=url;}}};
  async function addMaterial(){const input=$('room-material'),url=input?.value.trim();if(!url)return;try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw new Error('Use a valid http or https link.');const r=await db.from('joint_meeting_room_messages').insert({meeting_id:meetingId,user_id:user.id,display_name:profile.display_name||'JOINT member',message_type:'link',body:url,media_url:url});if(r.error)throw r.error;input.value='';await loadMaterials();await loadMessages();}catch(e){alert('Could not add link: '+friendly(e));}}
  async function loadMaterials(){const target=$('materials-list');if(!target)return;const r=await db.from('joint_meeting_room_messages').select('id,body,created_at,user_id').eq('meeting_id',meetingId).eq('message_type','link').eq('is_deleted',false).order('created_at',{ascending:false}).limit(100);if(r.error){target.textContent='Resources unavailable: '+friendly(r.error);return;}target.innerHTML=(r.data||[]).map(x=>`<p><a href="${esc(x.body)}" target="_blank" rel="noopener">${esc(x.body)}</a>${host?` <button type="button" class="secondary" data-delete-resource="${esc(x.id)}">Delete</button>`:''}</p>`).join('')||'<p class="muted">No resources shared yet.</p>';target.querySelectorAll('[data-delete-resource]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this shared link?')){const d=await db.from('joint_meeting_room_messages').update({is_deleted:true}).eq('id',b.dataset.deleteResource);if(d.error)alert(friendly(d.error));else loadMaterials();}});}
  async function switchFormat(){if(!host)return;const type=$('switch-room-format')?.value;if(!type)return;const r=await db.from('joint_meetings').update({room_type:type}).eq('id',meetingId).eq('host_id',user.id);if(r.error){setStatus('moderation-status','Could not switch format: '+friendly(r.error),true);return;}meeting.room_type=type;renderFormat();channel?.send({type:'broadcast',event:'room-format',payload:{room_type:type}});setStatus('moderation-status','Room format switched to '+type+'.');if(type==='Audio room'&&localStream){localStream.getVideoTracks().forEach(t=>t.enabled=false);}else if(type==='Video meeting'&&localStream){localStream.getVideoTracks().forEach(t=>t.enabled=true);}}
  function renderFormat(){const d=$('stage-description');if(d)d.textContent=(meeting.room_type||'Meeting')+' · Format changed by host. Use the room tools below.';if($('switch-room-format'))$('switch-room-format').value=meeting.room_type||'Video meeting';}
  async function startMedia(){if(!navigator.mediaDevices?.getUserMedia)return say('Camera/microphone access requires HTTPS and a supported browser.',true);try{const muted=await isMuted();if(muted)return say('The host has muted you. Ask the host to unmute you first.',true);const video=(meeting.room_type||'').toLowerCase().includes('video')||(meeting.room_type||'').toLowerCase().includes('lecture')||(meeting.room_type||'').toLowerCase().includes('project');localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:video});const preview=$('local-preview');preview.srcObject=localStream;preview.hidden=false;$('start-live-media').hidden=true;$('stop-live-media').hidden=false;for(const [id,pc] of peers){localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));if(user.id.localeCompare(id)<0)await makeOffer(id);}channel?.send({type:'broadcast',event:'participant-hello',payload:{user_id:user.id}});say('Media enabled. Browser peer-to-peer connection is active where network rules allow it.');}catch(e){say('Could not start camera/microphone: '+friendly(e),true);}}
  function stopMedia(){if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}const p=$('local-preview');if(p){p.srcObject=null;p.hidden=true;}for(const [id,pc] of peers){pc.close();peers.delete(id);}remoteStreams.clear();const grid=$('live-media-grid');if(grid)grid.innerHTML='';if($('start-live-media'))$('start-live-media').hidden=false;if($('stop-live-media'))$('stop-live-media').hidden=true;}
  function peerFor(id){if(peers.has(id))return peers.get(id);const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});peers.set(id,pc);if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate)channel?.send({type:'broadcast',event:'signal',payload:{from:user.id,to:id,kind:'candidate',candidate:e.candidate}});};pc.ontrack=e=>{const stream=e.streams[0];remoteStreams.set(id,stream);addRemoteVideo(id,stream,'Participant');};pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState)){const el=$('remote-'+id);if(el)el.remove();}};return pc;}
  async function makeOffer(id){try{const pc=peerFor(id);const offer=await pc.createOffer();await pc.setLocalDescription(offer);channel?.send({type:'broadcast',event:'signal',payload:{from:user.id,to:id,kind:'offer',sdp:offer}});}catch(e){console.warn('WebRTC offer failed',e);}}
  async function handleSignal(msg){if(!msg||msg.to!==user.id||!msg.from)return;try{const pc=peerFor(msg.from);if(msg.kind==='offer'){await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));const answer=await pc.createAnswer();await pc.setLocalDescription(answer);channel.send({type:'broadcast',event:'signal',payload:{from:user.id,to:msg.from,kind:'answer',sdp:answer}});}else if(msg.kind==='answer'){await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));}else if(msg.kind==='candidate'&&msg.candidate){await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));}}catch(e){console.warn('WebRTC signaling issue',e);}}
  function addRemoteVideo(id,stream,name){const grid=$('live-media-grid');if(!grid||$('remote-'+id))return;const wrap=document.createElement('article');wrap.className='participant';wrap.id='remote-'+id;const video=document.createElement('video');video.className='live-media';video.autoplay=true;video.playsInline=true;video.srcObject=stream;const label=document.createElement('strong');label.textContent=name;wrap.append(video,label);grid.append(wrap);}
  async function cleanup(){if(db&&user&&meetingId){try{await db.from('joint_meeting_live_participants').update({left_at:new Date().toISOString()}).eq('meeting_id',meetingId).eq('user_id',user.id);}catch(_){}}if(pollTimer)clearInterval(pollTimer);stopMedia();if(channel)db.removeChannel(channel);}
  document.addEventListener('DOMContentLoaded',boot);
})();
