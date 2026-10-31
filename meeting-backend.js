/* JOINT meetings backend. Uses the existing Supabase schema: room_type, invite_code, tools. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const params = new URLSearchParams(location.search);
  const requestedMeetingId = params.get('meeting');
  let db, user, currentMeeting, profileCache = [];
  const dateFmt = value => value ? new Date(value).toLocaleString() : 'Starts when the host begins';
  const profileHref = id => 'member-profile.html?id=' + encodeURIComponent(id || '');
  const initials = name => String(name || 'J').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase() || 'J';
  const hostBadge = (id, profile={}) => { const name=profile.name||profile.display_name||profile.username||'JOINT member'; const avatar=profile.avatar||profile.avatar_url||profile.photo_url||''; return `<a class="meeting-host-avatar" href="${profileHref(id)}" title="View ${esc(name)} profile" aria-label="View ${esc(name)} profile">${avatar?`<img src="${esc(avatar)}" alt="${esc(name)} profile picture" loading="lazy">`:`<span>${esc(initials(name))}</span>`}</a>`; };
  async function bannerHref(path) {
    if (!path) return '';
    try { const r = await db.storage.from('joint-meeting-media').createSignedUrl(path, 3600); return r.data?.signedUrl || ''; }
    catch (_) { return ''; }
  }
  const show = (target, message, isError = false) => {
    if (!target) return;
    target.hidden = false;
    target.style.display = 'block';
    target.textContent = message;
    target.style.color = isError ? '#a52834' : '';
  };
  const friendlyError = error => {
    const message = error?.message || error?.details || String(error || 'Unknown error');
    if (/row-level security|permission denied|not allowed/i.test(message)) return 'Supabase blocked this action. Check the RLS policies for joint_meetings and your signed-in account.';
    if (/column .* does not exist|could not find the .* column/i.test(message)) return 'The database columns do not match the meeting code: ' + message;
    return message;
  };

  async function ensureSupabaseConnection() {
    // Use the shared client if it is already available.
    if (window.jointSupabaseConnection) return await window.jointSupabaseConnection;

    // Load supabase.js explicitly and wait for its load event before checking
    // the connection. This avoids racing navigation.js on mobile browsers.
    const existing = [...document.scripts].find(script => {
      try { return new URL(script.src, location.href).pathname.endsWith('/supabase.js'); }
      catch (_) { return false; }
    });

    if (existing && !existing.dataset.jointLoadFailed) {
      await new Promise((resolve, reject) => {
        if (window.jointSupabaseConnection) return resolve();
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          clearInterval(check);
          clearTimeout(timeout);
          fn(value);
        };
        const check = setInterval(() => {
          if (window.jointSupabaseConnection) finish(resolve);
        }, 50);
        const timeout = setTimeout(() => finish(reject, new Error('supabase.js loaded, but it did not create the JOINT Supabase connection. Check the contents of supabase.js.')), 10000);
        existing.addEventListener('error', () => finish(reject, new Error('The supabase.js file failed to load.')), { once: true });
      });
    } else {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './supabase.js?v=joint-meeting-fix-2';
        script.async = true;
        const timeout = setTimeout(() => reject(new Error('Timed out loading supabase.js. Confirm that supabase.js exists in the repository root beside meeting-backend.js.')), 15000);
        script.onload = () => {
          clearTimeout(timeout);
          if (window.jointSupabaseConnection) resolve();
          else reject(new Error('supabase.js loaded but window.jointSupabaseConnection was not created. Check that the latest supabase.js is published.'));
        };
        script.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Could not load ./supabase.js. Make sure the filename is exactly supabase.js and it is in the same GitHub repository folder as meeting-backend.js.'));
        };
        document.head.appendChild(script);
      });
    }

    if (!window.jointSupabaseConnection) throw new Error('JOINT Supabase connection did not initialize.');
    return await window.jointSupabaseConnection;
  }

  async function boot() {
    try {
      db = await ensureSupabaseConnection();
      const { data, error } = await db.auth.getUser();
      if (error) throw error;
      user = data.user;
      if (!user) {
        const next = location.pathname.split('/').pop() + location.search;
        location.replace('auth.html?next=' + encodeURIComponent(next));
        return;
      }
      if ($('meeting-form')) setupHost();
      if ($('public-meetings')) await setupList();
      if ($('join-meeting-form') || $('join-quick-form')) setupJoin();
      if ($('room-title')) await setupRoom();
    } catch (error) {
      console.error('JOINT meetings initialization failed:', error);
      const target = $('meeting-success') || $('room-message') || $('public-empty') || $('join-meeting-success');
      if (target) show(target, 'Meetings could not connect to Supabase: ' + friendlyError(error), true);
      else alert('Meetings could not connect to Supabase: ' + friendlyError(error));
    }
  }

  function setupHost() {
    const form = $('meeting-form');
    const visibilityInputs = [...document.querySelectorAll('input[name="visibility"]')];
    const toggleCode = () => {
      const isPrivate = document.querySelector('input[name="visibility"]:checked')?.value === 'private';
      if ($('code-field')) $('code-field').hidden = !isPrivate;
      if ($('meeting-code')) $('meeting-code').required = isPrivate;
    };
    visibilityInputs.forEach(input => input.addEventListener('change', toggleCode));
    toggleCode();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const title = $('meeting-title')?.value.trim();
      const visibility = document.querySelector('input[name="visibility"]:checked')?.value || 'public';
      const code = $('meeting-code')?.value.trim() || '';
      const out = $('meeting-success');
      if (!title) { $('meeting-title')?.focus(); return; }
      if (visibility === 'private' && code.length < 4) { show(out, 'Create a private invitation code with at least 4 characters.', true); $('meeting-code')?.focus(); return; }
      const dateValue = $('meeting-date')?.value;
      const scheduledAt = dateValue ? new Date(dateValue) : null;
      if (scheduledAt && Number.isNaN(scheduledAt.getTime())) { show(out, 'Please choose a valid meeting date and time.', true); return; }
      if (scheduledAt && scheduledAt.getTime() <= Date.now()) { show(out, 'Choose a future date and time, or clear the date to start the meeting now.', true); return; }
      const tools = {
        chat: !!$('tool-chat')?.checked,
        materials: !!$('tool-materials')?.checked,
        qa: !!$('tool-qa')?.checked,
        screen: !!$('tool-screen')?.checked,
        hand: !!$('tool-hand')?.checked
      };
      // These names match the actual joint_meetings columns shown in Supabase Table Editor.
      let bannerUrl = null;
      const bannerFile = $('meeting-banner')?.files?.[0];
      if (bannerFile) {
        if (!bannerFile.type.startsWith('image/') || bannerFile.size > 5 * 1024 * 1024) { show(out, 'Choose an image smaller than 5 MB.', true); return; }
        const ext = (bannerFile.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
        const path = `meetings/${user.id}/${crypto.randomUUID()}.${ext}`;
        const uploaded = await db.storage.from('joint-meeting-media').upload(path, bannerFile, {upsert:false, contentType:bannerFile.type});
        if (uploaded.error) { show(out, 'Banner upload failed. Run the included meeting migration and check Storage policies: ' + friendlyError(uploaded.error), true); return; }
        bannerUrl = path;
      }
      const row = {
        host_id: user.id,
        banner_url: bannerUrl,
        title,
        description: $('meeting-description')?.value.trim() || '',
        room_type: $('meeting-type')?.value || 'Video meeting',
        visibility,
        invite_code: visibility === 'private' ? code : null,
        tools,
        status: scheduledAt ? 'scheduled' : 'active',
        scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
      };
      const button = form.querySelector('[type="submit"]');
      if (button) { button.disabled = true; button.textContent = 'Creating…'; }
      show(out, 'Saving your meeting…');
      try {
        const { data: created, error } = await db.from('joint_meetings').insert(row).select('*').single();
        if (error) throw error;
        currentMeeting = created;
        const link = new URL('meeting-room.html?meeting=' + encodeURIComponent(created.id), location.href).href;
        out.replaceChildren(); out.style.display = 'block'; out.hidden = false; out.style.color = '';
        const heading = document.createElement('strong'); heading.textContent = 'Meeting created successfully'; out.appendChild(heading);
        const details = document.createElement('p'); details.textContent = visibility === 'private' ? 'Keep the invitation code private and share it only with invited people.' : 'Share this meeting link with participants.'; out.appendChild(details);
        const anchor = document.createElement('a'); anchor.href = link; anchor.textContent = link; anchor.style.overflowWrap = 'anywhere'; out.appendChild(anchor);
        if (visibility === 'private') { const codeText = document.createElement('p'); codeText.textContent = 'Invitation code: ' + code; out.appendChild(codeText); }
        const actions = document.createElement('div'); actions.className = 'actions'; actions.style.marginTop = '12px';
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy meeting link'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); copy.textContent = 'Link copied'; } catch (_) { window.prompt('Copy meeting link', link); } }); actions.appendChild(copy);
        const open = document.createElement('a'); open.className = 'btn secondary'; open.href = link; open.textContent = 'Open meeting'; actions.appendChild(open); out.appendChild(actions);
        out.scrollIntoView({behavior:'smooth', block:'nearest'});
      } catch (error) {
        console.error('Meeting insert failed:', error);
        show(out, 'Meeting was NOT created. ' + friendlyError(error), true);
      } finally {
        if (button) { button.disabled = false; button.textContent = 'Create meeting'; }
      }
    });
  }

  async function setupList() {
    const search = $('meeting-search');
    const target = $('public-meetings');
    const empty = $('public-empty');
    let hostNames = {};
    async function searchMeetings() {
      const query = (search?.value || '').trim();
      if (!query) {
        target.innerHTML = '';
        show(empty, 'Search by meeting name to find public meetings.');
        return;
      }
      target.innerHTML = '<p class="muted">Searching meetings…</p>';
      try {
        const { data, error } = await db.from('joint_meetings')
          .select('id,host_id,title,description,room_type,visibility,status,scheduled_at,created_at,banner_url')
          .eq('visibility', 'public').in('status', ['scheduled','active'])
          .ilike('title', '%' + query.replace(/[%_]/g, '') + '%')
          .order('created_at', {ascending:false}).limit(100);
        if (error) throw error;
        const rows = data || [];
        const ids = [...new Set(rows.map(row => row.host_id).filter(Boolean))];
        hostNames = {};
        if (ids.length) {
          const result = await db.from('joint_profiles').select('id,display_name,username,avatar_url,photo_url').in('id', ids);
          if (result.error) console.warn('Host names unavailable:', result.error.message);
          (result.data || []).forEach(profile => { hostNames[profile.id] = { name: profile.display_name || profile.username || '', avatar: profile.avatar_url || profile.photo_url || '' }; });
        }
        if (!rows.length) { target.innerHTML=''; show(empty, 'No public meetings match that meeting name.'); return; }
        empty.hidden = true; empty.style.display = 'none';
        const cards = await Promise.all(rows.map(async row => {
          const hostProfile = hostNames[row.host_id] || {name:'JOINT member',avatar:''};
          const banner = await bannerHref(row.banner_url);
          return `<article class="meeting-card meeting-card-with-host">${hostBadge(row.host_id,hostProfile)}${banner ? `<a class="meeting-banner-link" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}" aria-label="View ${esc(row.title)}"><img class="meeting-card-banner" src="${esc(banner)}" alt="${esc(row.title)} meeting banner" loading="lazy"></a>` : ''}<span class="meeting-label">${row.status === 'active' ? 'Active' : 'Scheduled'}</span><h3>${esc(row.title)}</h3><p>${esc(row.description || '')}</p><p class="muted">Host: <a class="meeting-profile-link" href="${profileHref(row.host_id)}">${esc(hostProfile.name || 'JOINT member')}</a><br>${esc(row.room_type || 'Meeting')} · ${esc(dateFmt(row.scheduled_at))}</p><div class="meeting-actions"><a class="btn" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}">${row.status === 'active' ? 'Join meeting' : 'View meeting'}</a></div></article>`;
        }));
        target.innerHTML = cards.join('');
      } catch (error) {
        console.error('Public meeting search failed:', error);
        target.innerHTML = '';
        show(empty, 'Could not search meetings. ' + friendlyError(error), true);
      }
    }
    $('meeting-search-form')?.addEventListener('submit', event => { event.preventDefault(); searchMeetings(); });
    search?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchMeetings(); } });
    await Promise.all([renderMyMeetings(), renderInvitedMeetings(), renderJoinedMeetings()]);
  }

  async function renderMeetingCards(targetId, emptyId, rows, emptyText, actionText='Open meeting') {
    const target=$(targetId), empty=$(emptyId);
    if (!target) return;
    if (!rows.length) { target.innerHTML=''; if(empty){empty.hidden=false;empty.style.display='block';empty.textContent=emptyText;} return; }
    if(empty){empty.hidden=true;empty.style.display='none';}
    const hostIds=[...new Set(rows.map(row=>row.host_id).filter(Boolean))];
    const hostProfiles={};
    if(hostIds.length){const pr=await db.from('joint_profiles').select('id,display_name,username,avatar_url,photo_url').in('id',hostIds);if(pr.error)console.warn('Meeting host profiles unavailable:',pr.error.message);(pr.data||[]).forEach(p=>hostProfiles[p.id]={name:p.display_name||p.username||'',avatar:p.avatar_url||p.photo_url||''});}
    const cards=await Promise.all(rows.map(async row=>{
      const banner=await bannerHref(row.banner_url),hp=hostProfiles[row.host_id]||{};
      return `<article class="meeting-card meeting-card-with-host">${hostBadge(row.host_id,hp)}${banner?`<a class="meeting-banner-link" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}"><img class="meeting-card-banner" src="${esc(banner)}" alt="${esc(row.title||'Meeting')} banner" loading="lazy"></a>`:''}<span class="meeting-label">${row.status==='active'?'Active':row.status==='scheduled'?'Scheduled':row.status==='ended'?'Ended':'Cancelled'}</span><h3>${esc(row.title||'Meeting')}</h3><p>${esc(row.description||'')}</p><p class="muted">${esc(row.room_type||'Meeting')} · ${esc(dateFmt(row.scheduled_at))}</p><div class="meeting-actions"><a class="btn" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}">${actionText}</a></div></article>`;
    }));
    target.innerHTML=cards.join('');
  }

  async function renderInvitedMeetings() {
    try {
      const {data:invites,error}=await db.from('joint_meeting_invitations').select('meeting_id,status').eq('invitee_id',user.id).in('status',['pending','accepted']).limit(100);
      if(error) throw error;
      const ids=[...new Set((invites||[]).map(x=>x.meeting_id).filter(Boolean))];
      if(!ids.length){await renderMeetingCards('invited-meetings','invited-empty',[],'No meeting invitations yet.');return;}
      const {data:rows,error:meetingError}=await db.from('joint_meetings').select('id,host_id,title,description,room_type,status,scheduled_at,banner_url').in('id',ids).in('status',['scheduled','active']);
      if(meetingError) throw meetingError;
      await renderMeetingCards('invited-meetings','invited-empty',rows||[],'No active or scheduled invitations.','Open invitation');
    } catch(error){console.error('Invited meetings failed:',error);show($('invited-empty'),'Invitations could not load. '+friendlyError(error),true);}
  }

  async function renderJoinedMeetings() {
    try {
      const {data:parts,error}=await db.from('joint_meeting_participants').select('meeting_id,joined_at,left_at').eq('user_id',user.id).order('joined_at',{ascending:false}).limit(100);
      if(error) throw error;
      const ids=[...new Set((parts||[]).map(x=>x.meeting_id).filter(Boolean))];
      if(!ids.length){await renderMeetingCards('joined-meetings','joined-empty',[],'Meetings you join will appear here.');return;}
      const {data:rows,error:meetingError}=await db.from('joint_meetings').select('id,host_id,title,description,room_type,status,scheduled_at,banner_url').in('id',ids).in('status',['scheduled','active','ended']);
      if(meetingError) throw meetingError;
      const order=new Map(ids.map((id,i)=>[id,i]));
      (rows||[]).sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999));
      await renderMeetingCards('joined-meetings','joined-empty',rows||[],'Meetings you join will appear here.','Return to meeting');
    } catch(error){console.error('Joined meetings failed:',error);show($('joined-empty'),'Joined meetings could not load. '+friendlyError(error),true);}
  }

  async function renderMyMeetings() {
    const target = $('active-meetings');
    if (!target) return;
    const empty = $('active-empty');
    try {
      const { data, error } = await db.from('joint_meetings')
        .select('id,host_id,title,description,room_type,status,scheduled_at,visibility,created_at,banner_url')
        .eq('host_id', user.id).order('created_at', {ascending:false}).limit(100);
      if (error) throw error;
      const rows = data || [];
      const ownProfileResult=await db.from('joint_profiles').select('display_name,username,avatar_url,photo_url').eq('id',user.id).maybeSingle();
      const ownHostProfile={name:ownProfileResult.data?.display_name||ownProfileResult.data?.username||'You',avatar:ownProfileResult.data?.avatar_url||ownProfileResult.data?.photo_url||''};
      target.innerHTML = (await Promise.all(rows.map(async row => { const banner = await bannerHref(row.banner_url); return `<article class="meeting-card meeting-card-with-host">${hostBadge(row.host_id,ownHostProfile)}${banner ? `<a class="meeting-banner-link" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}" aria-label="Open ${esc(row.title)}"><img class="meeting-card-banner" src="${esc(banner)}" alt="${esc(row.title)} meeting banner" loading="lazy"></a>` : ''}<span class="meeting-label">${row.status === 'active' ? 'Active' : row.status === 'scheduled' ? 'Scheduled' : row.status === 'ended' ? 'Ended' : 'Cancelled'}</span><h3>${esc(row.title)}</h3><p>${esc(row.description || '')}</p><p class="muted">${esc(row.room_type || 'Meeting')} · ${esc(dateFmt(row.scheduled_at))} · ${esc(row.visibility)}</p><div class="meeting-actions">${row.status === 'ended' || row.status === 'cancelled' ? '' : `<a class="btn" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}">Open</a>`}<button type="button" class="btn secondary" data-delete-meeting="${esc(row.id)}">Delete</button></div></article>`; }))).join('');
      target.querySelectorAll('[data-delete-meeting]').forEach(button => button.addEventListener('click', async () => { if (!confirm('Permanently delete this meeting? This cannot be undone.')) return; button.disabled = true; const result = await db.from('joint_meetings').delete().eq('id', button.dataset.deleteMeeting).eq('host_id', user.id); if (result.error) { alert('Could not delete meeting: ' + friendlyError(result.error)); button.disabled = false; return; } await renderMyMeetings(); }));
      if (empty) { empty.hidden = rows.length > 0; empty.style.display = rows.length ? 'none' : 'block'; empty.textContent = 'You have no hosted meetings yet.'; }
    } catch (error) { console.error('Your meetings could not load:', error); target.innerHTML = ''; show(empty, 'Your meetings could not load. ' + friendlyError(error), true); }
  }

  function setupJoin() {
    async function findMeeting(rawValue) {
      const raw = (rawValue || '').trim();
      if (!raw) return;
      let candidate = raw;
      let suppliedCode = raw;
      try {
        const url = new URL(raw, location.href);
        candidate = url.searchParams.get('meeting') || raw;
        suppliedCode = url.searchParams.get('code') || (url.searchParams.has('meeting') ? '' : raw);
      } catch (_) {}
      let result = await db.from('joint_meetings').select('id,visibility,status,host_id,invite_code').eq('id', candidate).maybeSingle();
      if (result.error && !/invalid input syntax/i.test(result.error.message || '')) throw result.error;
      let row = result.data;
      // A plain invitation code can also be used to find its meeting.
      if (!row) {
        const codeResult = await db.from('joint_meetings').select('id,visibility,status,host_id,invite_code').eq('invite_code', raw).maybeSingle();
        if (codeResult.error) throw codeResult.error;
        row = codeResult.data;
        suppliedCode = raw;
      }
      if (!row) throw new Error('No meeting matched that link, meeting ID, or invitation code. Check it and try again.');
      if (['ended','cancelled'].includes(row.status)) throw new Error('This meeting has ended or was cancelled.');
      // Private meetings always require the host's code. An invitation alone is not an access credential.
      if (row.visibility === 'private' && row.host_id !== user.id && row.invite_code !== suppliedCode) {
        throw new Error('This is a private meeting. Enter the invitation code supplied by the host, even if you were invited.');
      }
      const query = new URLSearchParams({ meeting: row.id });
      if (row.visibility === 'private' && row.host_id !== user.id) query.set('code', suppliedCode);
      location.href = 'meeting-room.html?' + query.toString();
    }
    const attach = (form, input) => form?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      const target = $('join-meeting-success');
      if (button) { button.disabled = true; button.textContent = 'Checking…'; }
      try { await findMeeting($(input)?.value); }
      catch (error) { console.error('Meeting join lookup failed:', error); if (target) show(target, friendlyError(error), true); else alert(friendlyError(error)); }
      finally { if (button) { button.disabled = false; button.textContent = form.id === 'join-quick-form' ? 'Continue' : 'Find meeting'; } }
    });
    attach($('join-quick-form'), 'join-value');
    attach($('join-meeting-form'), 'meeting-code');
    if (requestedMeetingId && $('join-meeting-success')) findMeeting(requestedMeetingId).catch(error => show($('join-meeting-success'), friendlyError(error), true));
  }

  async function setupRoom() {
    const title = $('room-title');
    if (!requestedMeetingId) { show(title, 'Meeting link is missing.', true); show($('room-subtitle'), 'Return to Meetings and open a meeting link.'); return; }
    const { data: row, error } = await db.from('joint_meetings').select('*').eq('id', requestedMeetingId).maybeSingle();
    if (error || !row) { console.error('Meeting room lookup failed:', error); show(title, 'Meeting unavailable', true); show($('room-subtitle'), error ? friendlyError(error) : 'This meeting was not found or your account does not have access.'); return; }
    const isHost = row.host_id === user.id;
    const suppliedCode = params.get('code') || '';
    // Never treat an invitation as a substitute for the private meeting code.
    // Stop before showing room details or creating a participant record.
    if (row.visibility === 'private' && !isHost && row.invite_code !== suppliedCode) {
      const gate = $('room-message');
      if (gate) {
        gate.hidden = false;
        gate.style.display = 'block';
        gate.style.color = '#a52834';
        gate.innerHTML = '<strong>This is a private meeting.</strong><p>Enter the invitation code supplied by the host to continue. Being invited does not replace the code.</p><form id="private-meeting-code-form" class="inline-join"><input id="private-meeting-code-input" type="password" autocomplete="off" placeholder="Private meeting code" required aria-label="Private meeting code"><button type="submit">Verify code</button></form><p id="private-meeting-code-error" role="alert"></p>';
        const form = $('private-meeting-code-form');
        form?.addEventListener('submit', event => {
          event.preventDefault();
          const entered = $('private-meeting-code-input')?.value.trim() || '';
          if (entered !== row.invite_code) { show($('private-meeting-code-error'), 'That invitation code is incorrect. Please check with the host.', true); return; }
          const next = new URL(location.href);
          next.searchParams.set('code', entered);
          location.replace(next.toString());
        });
      }
      if (title) title.textContent = 'Private meeting';
      if ($('room-subtitle')) $('room-subtitle').textContent = 'Code required';
      return;
    }
    currentMeeting = row;
    title.textContent = row.title || 'Meeting room';
    $('room-subtitle').textContent = row.status === 'active' ? 'Active meeting' : row.status === 'scheduled' ? 'Scheduled meeting' : row.status === 'ended' ? 'Meeting ended' : 'Meeting cancelled';
    $('stage-title').textContent = row.title || 'Meeting stage';
    $('stage-description').textContent = row.status === 'active' ? 'Meeting details are connected. Live audio/video requires a meeting provider.' : 'Meeting details are ready.';
    $('room-details').textContent = [row.description, row.room_type || 'Meeting', row.visibility, dateFmt(row.scheduled_at)].filter(Boolean).join(' · ');
    if (isHost) {
      if ($('host-controls')) $('host-controls').hidden = false;
      const inviteDetails=$('host-invitation-details');
      if(inviteDetails){inviteDetails.hidden=false;const meetingLink=new URL('meeting-room.html?meeting='+encodeURIComponent(row.id),location.href).href;const linkInput=$('host-meeting-link');if(linkInput)linkInput.value=meetingLink;const codeWrap=$('host-meeting-code-wrap');if(codeWrap)codeWrap.hidden=row.visibility!=='private';const codeInput=$('host-meeting-code');if(codeInput)codeInput.value=row.visibility==='private'?(row.invite_code||''):'';const copyLink=$('copy-host-meeting-link');if(copyLink)copyLink.onclick=async()=>{try{await navigator.clipboard.writeText(meetingLink);show($('host-invitation-status'),'Meeting link copied.');}catch(_){window.prompt('Copy meeting link',meetingLink);}};const copyCode=$('copy-host-meeting-code');if(copyCode)copyCode.onclick=async()=>{const code=row.invite_code||'';if(!code)return;try{await navigator.clipboard.writeText(code);show($('host-invitation-status'),'Private invitation code copied.');}catch(_){window.prompt('Copy private invitation code',code);}};}
      if ($('end-room')) $('end-room').hidden = row.status !== 'active';
      if ($('delete-room')) $('delete-room').hidden = false;
      if ($('host-status')) $('host-status').textContent = 'You are the host.';
      await loadInviteMembers();
      if ($('end-room')) $('end-room').onclick = endMeeting;
      if ($('delete-room')) $('delete-room').onclick = deleteMeeting;
      if (row.status === 'scheduled' && $('room-controls') && !$('start-room')) {
        const start = document.createElement('button'); start.id = 'start-room'; start.type = 'button'; start.textContent = 'Start meeting';
        start.onclick = async () => { start.disabled = true; const result = await db.from('joint_meetings').update({status:'active'}).eq('id', row.id).eq('host_id', user.id); if (result.error) { alert('Could not start meeting: ' + friendlyError(result.error)); start.disabled = false; return; } location.reload(); };
        $('room-controls').appendChild(start);
      }
    }
    if (!['ended','cancelled'].includes(row.status)) {
      const participant = await db.from('joint_meeting_participants').upsert({meeting_id:row.id,user_id:user.id,joined_at:new Date().toISOString(),left_at:null},{onConflict:'meeting_id,user_id'});
      if (participant.error) console.warn('Participant record was not saved:', participant.error.message);
    }
    if ($('leave-room')) $('leave-room').onclick = async () => { await db.from('joint_meeting_participants').update({left_at:new Date().toISOString()}).eq('meeting_id',row.id).eq('user_id',user.id); location.href='meetings.html'; };
    if ($('share-room')) $('share-room').onclick = async () => { const link = location.href; try { await navigator.clipboard.writeText(link); show($('room-message'),'Meeting link copied.'); } catch (_) { window.prompt('Copy meeting link',link); } };
    document.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => { const type = button.dataset.toggle; const on = button.dataset.on !== 'true'; button.dataset.on = String(on); button.textContent = (type === 'camera' ? '📹 Camera: ' : type === 'mic' ? '🎙️ Mic: ' : '✋ Raise hand: ') + (on ? 'On' : 'Off'); }));
    if (row.tools && $('room-tools')) $('room-tools').innerHTML = Object.entries(row.tools).filter(([,enabled]) => enabled).map(([key]) => `<span class="tool-state">${esc(({chat:'Chat',materials:'Shared materials',qa:'Q&A',screen:'Screen sharing',hand:'Raise hand'})[key] || key)}</span>`).join('');
  }

  async function endMeeting() {
    if (!currentMeeting || !confirm('End this meeting for everyone?')) return;
    const { error } = await db.from('joint_meetings').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',currentMeeting.id).eq('host_id',user.id);
    if (error) { alert('Could not end the meeting: ' + friendlyError(error)); return; }
    location.href = 'meetings.html';
  }
  async function deleteMeeting() {
    if (!currentMeeting || !confirm('Delete this meeting? This cannot be undone.')) return;
    const { error } = await db.from('joint_meetings').delete().eq('id',currentMeeting.id).eq('host_id',user.id);
    if (error) { alert('Could not delete the meeting: ' + friendlyError(error)); return; }
    location.href = 'meetings.html';
  }
  async function loadInviteMembers() {
    const search = $('invite-search'), target = $('invite-members');
    if (!target) return;
    target.style.cssText = 'max-height:280px;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch;padding:4px 6px 4px 0';
    try {
      const [followA,followB,convos] = await Promise.all([
        db.from('joint_follows').select('follower_id,followed_user_id').eq('follower_id',currentMeeting.host_id),
        db.from('joint_follows').select('follower_id,followed_user_id').eq('followed_user_id',currentMeeting.host_id),
        db.from('joint_conversations').select('user1_id,user2_id').or(`user1_id.eq.${currentMeeting.host_id},user2_id.eq.${currentMeeting.host_id}`)
      ]);
      if(followA.error) throw followA.error;
      if(followB.error) throw followB.error;
      if(convos.error) throw convos.error;
      const friendIds = new Set();
      (followA.data||[]).forEach(x=>friendIds.add(x.followed_user_id));
      (followB.data||[]).forEach(x=>friendIds.add(x.follower_id));
      (convos.data||[]).forEach(x=>friendIds.add(x.user1_id===currentMeeting.host_id?x.user2_id:x.user1_id));
      friendIds.delete(currentMeeting.host_id);
      if(!friendIds.size){profileCache=[];target.innerHTML='<p>No followers, following connections, or chat contacts are available to invite yet.</p>';return;}
      const {data,error}=await db.from('joint_profiles').select('id,display_name,username,avatar_url,photo_url').in('id',[...friendIds]).order('display_name').limit(300);
      if(error) throw error;
      profileCache=data||[];
      const render=()=>{
        const query=(search?.value||'').trim().toLowerCase();
        const rows=profileCache.filter(p=>!query||[p.display_name,p.username].some(v=>String(v||'').toLowerCase().includes(query)));
        target.innerHTML=rows.map(p=>{const name=p.display_name||p.username||'JOINT member',avatar=p.avatar_url||p.photo_url||'';return `<div class="invite-member-row"><a class="invite-member-identity" href="${profileHref(p.id)}" target="_blank" rel="noopener"><span class="invite-member-avatar">${avatar?`<img src="${esc(avatar)}" alt="${esc(name)} profile picture" loading="lazy">`:`${esc(initials(name))}`}</span><span><span class="invite-member-name">${esc(name)}</span>${p.username?`<span class="invite-member-username">@${esc(p.username)}</span>`:''}</span></a><button type="button" data-invite="${esc(p.id)}">Invite</button></div>`;}).join('')||'<p>No connected members match your search.</p>';
        target.querySelectorAll('[data-invite]').forEach(button=>button.addEventListener('click',()=>inviteMember(button.dataset.invite,button)));
      };
      search?.addEventListener('input',render);render();
    } catch(error){console.error('Invite friends load failed:',error);target.textContent='Connected members could not be loaded: '+friendlyError(error);}
  }
  async function inviteMember(profileId, button) {
    button.disabled = true;
    try {
      const { error } = await db.from('joint_meeting_invitations').upsert({meeting_id:currentMeeting.id,inviter_id:user.id,invitee_id:profileId,status:'pending'},{onConflict:'meeting_id,invitee_id'});
      if (error) throw error;
      show($('invite-status'), 'Invitation saved. Email and in-app delivery still require a secure server-side notification function.'); button.textContent = 'Invited';
    } catch (error) { console.error('Meeting invitation failed:', error); show($('invite-status'), 'Could not invite this member: ' + friendlyError(error), true); button.disabled = false; }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
