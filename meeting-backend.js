/* JOINT meetings backend. Uses the existing Supabase schema: room_type, invite_code, tools. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const params = new URLSearchParams(location.search);
  const requestedMeetingId = params.get('meeting');
  let db, user, currentMeeting, profileCache = [];
  const dateFmt = value => value ? new Date(value).toLocaleString() : 'Starts when the host begins';
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
    let publicRows = [];
    let hostNames = {};
    async function load() {
      target.innerHTML = '<p class="muted">Loading public meetings…</p>';
      try {
        const { data, error } = await db.from('joint_meetings')
          .select('id,host_id,title,description,room_type,visibility,status,scheduled_at,created_at')
          .eq('visibility', 'public').in('status', ['scheduled','active'])
          .order('created_at', {ascending:false}).limit(200);
        if (error) throw error;
        publicRows = data || [];
        const ids = [...new Set(publicRows.map(row => row.host_id).filter(Boolean))];
        hostNames = {};
        if (ids.length) {
          const result = await db.from('joint_profiles').select('id,display_name').in('id', ids);
          if (result.error) console.warn('Host names unavailable:', result.error.message);
          (result.data || []).forEach(profile => { hostNames[profile.id] = profile.display_name || ''; });
        }
        render();
      } catch (error) {
        console.error('Public meeting search failed:', error);
        target.innerHTML = '';
        show(empty, 'Could not load meetings. ' + friendlyError(error), true);
      }
    }
    function render() {
      const query = (search?.value || '').trim().toLowerCase();
      const rows = publicRows.filter(row => [row.title, row.description, row.room_type, hostNames[row.host_id]].join(' ').toLowerCase().includes(query));
      if (!rows.length) { target.innerHTML = ''; show(empty, query ? 'No public meetings match your search.' : 'No public meetings are available right now.'); return; }
      empty.hidden = true; empty.style.display = 'none';
      target.innerHTML = rows.map(row => `<article class="meeting-card"><span class="meeting-label">${row.status === 'active' ? 'Active' : 'Scheduled'}</span><h3>${esc(row.title)}</h3><p>${esc(row.description || '')}</p><p class="muted">Host: ${esc(hostNames[row.host_id] || 'JOINT member')}<br>${esc(row.room_type || 'Meeting')} · ${esc(dateFmt(row.scheduled_at))}</p><div class="meeting-actions"><a class="btn" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}">${row.status === 'active' ? 'Join meeting' : 'View meeting'}</a></div></article>`).join('');
    }
    search?.addEventListener('input', render);
    $('meeting-search-form')?.addEventListener('submit', event => { event.preventDefault(); render(); });
    await load();
    await renderMyMeetings();
  }

  async function renderMyMeetings() {
    const target = $('active-meetings');
    if (!target) return;
    const empty = $('active-empty');
    try {
      const { data, error } = await db.from('joint_meetings')
        .select('id,host_id,title,description,room_type,status,scheduled_at,visibility,created_at')
        .eq('host_id', user.id)
        .order('created_at', {ascending:false});
      if (error) throw error;
      const rows = data || [];
      target.innerHTML = rows.map(row => `<article class="meeting-card"><span class="meeting-label">${row.status === 'active' ? 'Active' : row.status === 'scheduled' ? 'Scheduled' : row.status === 'ended' ? 'Ended' : 'Cancelled'}</span><h3>${esc(row.title)}</h3><p>${esc(row.description || '')}</p><p class="muted">${esc(row.room_type || 'Meeting')} · ${esc(dateFmt(row.scheduled_at))} · ${esc(row.visibility)}</p><div class="meeting-actions">${row.status === 'ended' || row.status === 'cancelled' ? '' : `<a class="btn" href="meeting-room.html?meeting=${encodeURIComponent(row.id)}">Open</a>`}<button type="button" class="btn secondary" data-delete-meeting="${esc(row.id)}">Delete</button></div></article>`).join('');
      target.querySelectorAll('[data-delete-meeting]').forEach(button => button.addEventListener('click', async () => { if (!confirm('Permanently delete this meeting? This cannot be undone.')) return; button.disabled = true; const result = await db.from('joint_meetings').delete().eq('id', button.dataset.deleteMeeting).eq('host_id', user.id); if (result.error) { alert('Could not delete meeting: ' + friendlyError(result.error)); button.disabled = false; return; } await renderMyMeetings(); }));
      if (empty) { empty.hidden = rows.length > 0; empty.style.display = rows.length ? 'none' : 'block'; empty.textContent = 'You have no meetings yet. Meetings you end will remain here until you delete them.'; }
    } catch (error) {
      console.error('Your meetings could not load:', error);
      target.innerHTML = '';
      show(empty, 'Your meetings could not load. ' + friendlyError(error), true);
    }
  }

  function setupJoin() {
    async function findMeeting(rawValue) {
      const raw = (rawValue || '').trim();
      if (!raw) return;
      let candidate = raw;
      try { const url = new URL(raw, location.href); candidate = url.searchParams.get('meeting') || raw; } catch (_) {}
      let result;
      // First accept a meeting UUID or a full JOINT meeting URL.
      result = await db.from('joint_meetings').select('id,visibility,status,host_id,invite_code').eq('id', candidate).maybeSingle();
      if (result.error && !/invalid input syntax/i.test(result.error.message || '')) throw result.error;
      let row = result.data;
      // If it was not an ID, try the private invitation code. RLS must permit a signed-in user to look up the matching row.
      if (!row) {
        const codeResult = await db.from('joint_meetings').select('id,visibility,status,host_id,invite_code').eq('invite_code', raw).maybeSingle();
        if (codeResult.error) throw codeResult.error;
        row = codeResult.data;
      }
      if (!row) throw new Error('No meeting matched that link, meeting ID, or invitation code. Check it and try again.');
      if (['ended','cancelled'].includes(row.status)) throw new Error('This meeting has ended or was cancelled.');
      if (row.visibility === 'private' && row.host_id !== user.id && row.invite_code !== raw && !raw.includes('meeting=')) {
        throw new Error('This is a private meeting. Enter the invitation code supplied by the host.');
      }
      location.href = 'meeting-room.html?meeting=' + encodeURIComponent(row.id);
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
    currentMeeting = row;
    title.textContent = row.title || 'Meeting room';
    $('room-subtitle').textContent = row.status === 'active' ? 'Active meeting' : row.status === 'scheduled' ? 'Scheduled meeting' : row.status === 'ended' ? 'Meeting ended' : 'Meeting cancelled';
    $('stage-title').textContent = row.title || 'Meeting stage';
    $('stage-description').textContent = row.status === 'active' ? 'Meeting details are connected. Live audio/video requires a meeting provider.' : 'Meeting details are ready.';
    $('room-details').textContent = [row.description, row.room_type || 'Meeting', row.visibility, dateFmt(row.scheduled_at)].filter(Boolean).join(' · ');
    const isHost = row.host_id === user.id;
    if (isHost) {
      if ($('host-controls')) $('host-controls').hidden = false;
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
    } else if (row.visibility === 'private') {
      const invitation = await db.from('joint_meeting_invitations').select('id,status').eq('meeting_id', row.id).eq('invitee_id', user.id).in('status', ['pending','accepted']).maybeSingle();
      const codeInUrl = params.get('code');
      if (!invitation.data && row.invite_code !== codeInUrl) { show($('room-message'), 'You need a valid invitation or invitation code to access this private meeting.', true); return; }
    }
    if (row.status === 'active') {
      const participant = await db.from('joint_meeting_participants').upsert({meeting_id:row.id,user_id:user.id,left_at:null},{onConflict:'meeting_id,user_id'});
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
    const { data, error } = await db.from('joint_profiles').select('id,display_name').neq('id',user.id).order('display_name').limit(200);
    if (error) { target.textContent = 'Members could not be loaded: ' + friendlyError(error); return; }
    profileCache = data || [];
    const render = () => {
      const query = (search?.value || '').toLowerCase().trim();
      const rows = profileCache.filter(profile => (profile.display_name || '').toLowerCase().includes(query));
      target.innerHTML = rows.map(profile => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><span>${esc(profile.display_name || 'JOINT member')}</span><button type="button" data-invite="${profile.id}">Invite</button></div>`).join('') || '<p>No members found.</p>';
      target.querySelectorAll('[data-invite]').forEach(button => button.addEventListener('click', () => inviteMember(button.dataset.invite, button)));
    };
    search?.addEventListener('input', render); render();
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
