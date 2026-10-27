/* JOINT profile integration. Profile, posts, follows and post interactions use Supabase. */
(() => {
  'use strict';

  const STORAGE = {
    profile: 'joint_profile_demo_v2',
    posts: 'joint_user_posts_demo_v2',
    follows: 'joint_social_follows_demo_v1'
  };
  let supabaseClient = null;
  let currentUser = null;
  let remoteProfile = null;
  let selectedAvatarFile = null;

  const readLocal = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  };
  const writeLocal = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  };
  const localProfile = () => readLocal(STORAGE.profile, {
    name: 'JOINT Learner', bio: '', interests: '', age: '', avatar: ''
  });
  const posts = () => readLocal(STORAGE.posts, []);
  const follows = () => readLocal(STORAGE.follows, []);
  const safe = value => String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function localShareCount(postId) {
    try { const totals = JSON.parse(localStorage.getItem('joint_social_shares_demo_v1') || '{}'); return Number(totals[postId] || 0); } catch (_) { return 0; }
  }

  function localViewCount(postId) {
    try { const totals = JSON.parse(localStorage.getItem('joint_social_views_demo_v1') || '{}'); return Number(totals[postId] || 0); } catch (_) { return 0; }
  }

  function recordLocalPostView(postId) {
    // Count at most once per browser session for each post, avoiding repeated refresh inflation.
    try {
      const seenKey = 'joint_social_views_seen_session_v1';
      const seen = JSON.parse(sessionStorage.getItem(seenKey) || '[]');
      if (seen.includes(String(postId))) return;
      seen.push(String(postId));
      sessionStorage.setItem(seenKey, JSON.stringify(seen));
      const totals = JSON.parse(localStorage.getItem('joint_social_views_demo_v1') || '{}');
      totals[postId] = Number(totals[postId] || 0) + 1;
      localStorage.setItem('joint_social_views_demo_v1', JSON.stringify(totals));
    } catch (_) { /* Storage may be unavailable; the UI still renders. */ }
  }

  async function getClient() {
    if (supabaseClient) return supabaseClient;
    if (!window.jointSupabaseConnection) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './supabase.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load JOINT Supabase.'));
        document.head.appendChild(script);
      });
    }
    supabaseClient = await window.jointSupabaseConnection;
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) throw error;
    currentUser = data.user;
    if (!currentUser) throw new Error('Please sign in to manage your profile.');
    return supabaseClient;
  }

  function fallbackProfile() {
    const local = localProfile();
    return {
      id: currentUser?.id || '',
      username: remoteProfile?.username || (currentUser?.email || '').split('@')[0],
      display_name: remoteProfile?.display_name || local.name || currentUser?.user_metadata?.display_name || 'JOINT Learner',
      bio: remoteProfile?.bio ?? local.bio ?? '',
      interests: remoteProfile?.interests ?? local.interests ?? '',
      age: remoteProfile?.age ?? local.age ?? '',
      date_of_birth: remoteProfile?.date_of_birth || local.date_of_birth || '',
      country: remoteProfile?.country || '',
      state_region: remoteProfile?.state_region || '',
      gender: remoteProfile?.gender || '',
      avatar_url: remoteProfile?.avatar_url || local.avatar || '',
      account_type: remoteProfile?.account_type || 'student'
    };
  }

  async function loadProfile() {
    const client = await getClient();
    const { data, error } = await client
      .from('joint_profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    remoteProfile = data || null;

    // If this user's profile row does not exist, create it with their auth identity.
    if (!remoteProfile) {
      const local = localProfile();
      const base = ((currentUser.email || 'joint-user').split('@')[0])
        .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'joint-user';
      const candidate = `${base}_${currentUser.id.replace(/-/g, '').slice(0, 6)}`;
      const row = {
        id: currentUser.id,
        username: candidate,
        display_name: String(currentUser.user_metadata?.display_name || local.name || base).slice(0, 80),
        bio: String(local.bio || '').slice(0, 600),
        interests: String(local.interests || '').slice(0, 250),
        age: local.age ? Number(local.age) : null,
        date_of_birth: local.date_of_birth || null,
        avatar_url: null,
        account_type: 'student'
      };
      const { data: inserted, error: insertError } = await client
        .from('joint_profiles').insert(row).select('*').single();
      if (insertError) throw insertError;
      remoteProfile = inserted;
    }

    // Cache only as a convenience for the avatar/header; Supabase remains the source of truth.
    writeLocal(STORAGE.profile, {
      name: remoteProfile.display_name || 'JOINT Learner',
      bio: remoteProfile.bio || '',
      interests: remoteProfile.interests || '',
      age: remoteProfile.age || '',
      date_of_birth: remoteProfile.date_of_birth || '',
      avatar: remoteProfile.avatar_url || ''
    });
    return fallbackProfile();
  }

  function profileCard(profile) {
    const root = document.getElementById('joint-profile-summary');
    if (!root) return;
    root.innerHTML = '';
    const photo = document.createElement('div');
    photo.className = 'joint-profile-photo';
    if (profile.avatar_url) {
      const image = document.createElement('img');
      image.src = profile.avatar_url;
      image.alt = 'Profile picture';
      photo.appendChild(image);
    } else {
      photo.textContent = (profile.display_name || 'J').trim()
        .split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
    }
    root.appendChild(photo);
    const details = document.createElement('div');
    details.className = 'joint-profile-details';
    const title = document.createElement('h2');
    title.textContent = profile.display_name || 'JOINT Learner';
    const bio = document.createElement('p');
    bio.textContent = profile.bio || 'Add a short introduction to your profile.';
    const username = document.createElement('p');
    username.className = 'muted';
    username.textContent = profile.username ? '@' + profile.username : '';
    const stats = document.createElement('p');
    stats.className = 'muted';
    stats.textContent = 'Followers: loading… · Following: loading…';
    stats.id = 'joint-follow-stats';
    details.append(title, bio, username, stats);
    if (profile.interests) {
      let interestValues = profile.interests;
      if (typeof interestValues === 'string') {
        const raw = interestValues.trim();
        try {
          const parsed = JSON.parse(raw);
          interestValues = Array.isArray(parsed) ? parsed : raw.split(/[,;|]/);
        } catch (_) {
          interestValues = raw.split(/[,;|]/);
        }
      }
      if (!Array.isArray(interestValues)) interestValues = [interestValues];
      const cleanInterests = [...new Set(interestValues.map(value => String(value || '').trim()).filter(Boolean))];
      if (cleanInterests.length) {
        const interestHeading = document.createElement('p');
        interestHeading.className = 'muted';
        interestHeading.textContent = 'Interests';
        interestHeading.style.marginBottom = '8px';
        const interests = document.createElement('div');
        interests.className = 'joint-profile-interests';
        cleanInterests.forEach(value => {
          const chip = document.createElement('span');
          chip.className = 'joint-profile-interest';
          chip.textContent = value.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
          interests.appendChild(chip);
        });
        details.append(interestHeading, interests);
      }
    }
    root.appendChild(details);
    refreshFollowStats();
  }

  async function refreshFollowStats() {
    const stats = document.getElementById('joint-follow-stats');
    if (!stats) return;
    try {
      const client = await getClient();
      const [followers, following] = await Promise.all([
        client.from('joint_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_user_id', currentUser.id),
        client.from('joint_follows').select('followed_user_id', { count: 'exact', head: true }).eq('follower_id', currentUser.id)
      ]);
      if (followers.error) throw followers.error;
      if (following.error) throw following.error;
      stats.textContent = `Followers: ${followers.count ?? 0} · Following: ${following.count ?? 0}`;
    } catch (error) {
      console.error('JOINT follow counts could not load:', error);
      stats.textContent = 'Followers: unavailable · Following: unavailable';
      stats.title = 'Could not read follow counts. Check the joint_follows SELECT policy.';
    }
  }

  async function renderOwnPosts(target, profile) {
    if (!target) return;
    const previousY = window.scrollY;
    const hadContent = target.children.length > 0;
    if (!hadContent) target.innerHTML = '<div class="card muted">Loading your posts…</div>';
    try {
      const client = await getClient();
      const { data: items, error } = await client.from('joint_posts')
        .select('id, author_id, content, media_urls, created_at, updated_at')
        .eq('author_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const postIds = (items || []).map(item => item.id).filter(Boolean);
      const metrics = { likes: {}, comments: {}, saves: {} };
      if (postIds.length) {
        const [likesResult, commentsResult, savesResult] = await Promise.all([
          client.from('joint_likes').select('post_id').in('post_id', postIds),
          client.from('joint_comments').select('post_id').in('post_id', postIds),
          client.from('joint_saves').select('post_id').in('post_id', postIds)
        ]);
        if (likesResult.error) console.warn('Could not load post like counts:', likesResult.error.message);
        else (likesResult.data || []).forEach(row => metrics.likes[row.post_id] = (metrics.likes[row.post_id] || 0) + 1);
        if (commentsResult.error) console.warn('Could not load post comment counts:', commentsResult.error.message);
        else (commentsResult.data || []).forEach(row => metrics.comments[row.post_id] = (metrics.comments[row.post_id] || 0) + 1);
        // joint_saves has an owner-only read policy, so this count may represent only saves visible to this user.
        if (savesResult.error) console.warn('Could not load post save counts:', savesResult.error.message);
        else (savesResult.data || []).forEach(row => metrics.saves[row.post_id] = (metrics.saves[row.post_id] || 0) + 1);
      }
      target.innerHTML = '';
      if (!items || !items.length) {
        target.innerHTML = '<div class="card muted">No shared posts yet. Publish an update to make it available to JOINT users.</div>';
        return;
      }
      items.forEach(post => {
        const card = document.createElement('article');
        card.className = 'card joint-user-post';
        const head = document.createElement('div');
        head.className = 'joint-post-head';
        const author = document.createElement('strong');
        author.textContent = profile.display_name || 'JOINT Learner';
        const date = document.createElement('small');
        date.textContent = post.created_at ? new Date(post.created_at).toLocaleString() : '';
        head.append(author, date);
        const body = document.createElement('p');
        body.textContent = post.content || '';
        card.append(head, body);
        (Array.isArray(post.media_urls) ? post.media_urls : []).forEach(media => {
          if (!media || !media.url) return;
          if (media.type === 'video') {
            const video = document.createElement('video');
            video.className = 'joint-post-media'; video.controls = true; video.playsInline = true;
            video.preload = 'metadata'; video.src = media.url; card.appendChild(video);
          } else {
            const image = document.createElement('img');
            image.className = 'joint-post-media'; image.loading = 'lazy'; image.alt = 'Image shared in this post';
            image.src = media.url; card.appendChild(image);
          }
        });
        recordLocalPostView(post.id);
        const viewCount = localViewCount(post.id);

        // Interactive controls for the owner's profile posts. All likes, comments and saves
        // use the existing Supabase tables; share totals remain local until a shared counter exists.
        const interactionBox = document.createElement('section');
        interactionBox.className = 'joint-profile-interactions';
        interactionBox.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #eeeaf5';
        const actionRow = document.createElement('div');
        actionRow.className = 'joint-profile-action-row';
        const compact = value => { const n=Number(value)||0; if(n>=1000000)return (n/1000000).toFixed(n>=10000000?0:1).replace(/\.0$/,'')+'M+'; if(n>=1000)return (n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+'K+'; return String(n); };
        const iconSvg = name => {
          const paths={save:'<path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21z"/>',view:'<path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',share:'<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'};
          return paths[name]||'';
        };
        const makeAction = (icon, value, handler, selected=false, title='') => {
          const b=document.createElement('button'); b.type='button'; b.className='joint-profile-action'+(selected?' selected':''); b.title=title; b.setAttribute('aria-label',title||icon);
          const ico=document.createElement('span');ico.className='jp-icon';ico.setAttribute('aria-hidden','true');
          const svg=iconSvg(icon);
          if(svg){ico.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+svg+'</svg>';}else{ico.textContent=icon;}
          const count=document.createElement('span');count.className='jp-count';count.textContent=compact(value);b.append(ico,count);
          b.addEventListener('click', handler); actionRow.appendChild(b); return b;
        };
        const loadCounts = async () => {
          const c=await getClient();
          const [lr,cr,sr]=await Promise.all([
            c.from('joint_likes').select('id',{count:'exact',head:true}).eq('post_id',post.id),
            c.from('joint_comments').select('id',{count:'exact',head:true}).eq('post_id',post.id),
            c.from('joint_saves').select('id',{count:'exact',head:true}).eq('post_id',post.id)
          ]);
          return {likes:lr.count??0,comments:cr.count??0,saves:sr.count??0,errors:[lr.error,cr.error,sr.error].filter(Boolean)};
        };
        const refreshCard = async () => { await renderOwnPosts(target, profile); };
        makeAction('❤️',metrics.likes[post.id]||0,async ev=>{},false,'Like post');
        actionRow.lastElementChild.onclick = async (ev) => {
          const b=ev.currentTarget; b.disabled=true;
          try { const c=await getClient();
            const {data:existing,error:findErr}=await c.from('joint_likes').select('id').eq('post_id',post.id).eq('user_id',currentUser.id).maybeSingle();
            if(findErr) throw findErr;
            const result=existing?await c.from('joint_likes').delete().eq('id',existing.id):await c.from('joint_likes').insert({post_id:post.id,user_id:currentUser.id});
            if(result.error) throw result.error; await refreshCard();
          } catch(err){alert('Could not update like: '+err.message);b.disabled=false;}
        };
        makeAction('💬',metrics.comments[post.id]||0,()=>{},false,'Show comments');
        const shareBtn=makeAction('share',localShareCount(post.id),async()=>{},false,'Share post');
        shareBtn.onclick=async()=>{
          const link=new URL('index.html',location.href); link.searchParams.set('post',post.id);
          const payload={title:'JOINT post',text:(profile.display_name||'JOINT member')+' on JOINT: '+(post.content||''),url:link.href};
          try { if(navigator.share) await navigator.share(payload); else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(payload.url);alert('Post link copied.')} else prompt('Copy this post link:',payload.url);
            const totals=JSON.parse(localStorage.getItem('joint_social_shares_demo_v1')||'{}');totals[post.id]=Number(totals[post.id]||0)+1;localStorage.setItem('joint_social_shares_demo_v1',JSON.stringify(totals));shareBtn.querySelector('.jp-count').textContent=compact(totals[post.id]);
          } catch(err){if(err.name!=='AbortError')alert('Could not share this post.');}
        };
        const saveAction=makeAction('save',metrics.saves[post.id]||0,async ev=>{
          const b=ev.currentTarget;b.disabled=true;
          try {const c=await getClient();const {data:existing,error:findErr}=await c.from('joint_saves').select('id').eq('post_id',post.id).eq('user_id',currentUser.id).maybeSingle();if(findErr)throw findErr;const result=existing?await c.from('joint_saves').delete().eq('id',existing.id):await c.from('joint_saves').insert({post_id:post.id,user_id:currentUser.id});if(result.error)throw result.error;await refreshCard();}
          catch(err){alert('Could not update saved post: '+err.message);b.disabled=false;}
        });
        const viewsButton = makeAction('view', viewCount, () => {},false,'Views');
        viewsButton.disabled = true;
        viewsButton.style.opacity = '0.85';
        viewsButton.title = 'Views are counted on this browser only until a shared post-views table is added.';
        interactionBox.appendChild(actionRow);
        // Boost this post. A campaign is only queued for payment; this browser never charges money.
        const boostButton=document.createElement('button');boostButton.type='button';boostButton.textContent='🚀 Boost post';boostButton.style.cssText='margin-top:10px;border:0;border-radius:11px;padding:10px 15px;background:#6938d1;color:#fff;font-weight:800;cursor:pointer';
        const boostPanel=document.createElement('section');boostPanel.hidden=true;boostPanel.style.cssText='margin-top:10px;padding:13px;border:1px solid #e5deef;border-radius:13px;background:#fbf9ff';
        const boostMetrics=document.createElement('div');boostMetrics.style.cssText='display:flex;gap:8px;overflow-x:auto;margin:10px 0';
        const boostForm=document.createElement('form');boostForm.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px';
        const boostCountries=document.createElement('select');boostCountries.multiple=false;boostCountries.size=1;boostCountries.setAttribute('aria-label','Target country');boostCountries.style.cssText='grid-column:1/-1;width:100%;min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#fff';
        const boostGeo=window.JOINT_GEO_DATA||{countries:[],states:{},interests:[]};
        boostCountries.add(new Option('Select one country',''));
        (boostGeo.countries||[]).forEach(row=>{const name=Array.isArray(row)?row[1]:row.name;if(name)boostCountries.add(new Option(name,name))});
        const boostStates=document.createElement('select');boostStates.setAttribute('aria-label','Target state or region');boostStates.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#fff';
        const fillBoostStates=()=>{const selectedName=boostCountries.value;const row=(boostGeo.countries||[]).find(x=>(Array.isArray(x)?x[1]:x.name)===selectedName);const code=Array.isArray(row)?row[0]:row?.code;const states=code?(boostGeo.states?.[code]||[]):[];boostStates.replaceChildren(new Option(states.length?'All states / regions':'State list unavailable for this country',''));states.forEach(name=>boostStates.add(new Option(name,name)))};
        fillBoostStates();boostCountries.addEventListener('change',async()=>{fillBoostStates();const row=(boostGeo.countries||[]).find(x=>(Array.isArray(x)?x[1]:x.name)===boostCountries.value);const code=Array.isArray(row)?row[0]:row?.code;if(code&&!boostGeo.states?.[code]?.length&&boostGeo.getStatesForCountry){try{const rows=await boostGeo.getStatesForCountry(code);if(boostCountries.value===(Array.isArray(row)?row[1]:row.name)&&rows.length){boostGeo.states[code]=rows;fillBoostStates()}}catch(_){}}updateBoostEstimate()});
        
        const boostAge=document.createElement('select');boostAge.innerHTML='<option value="all">All eligible ages</option><option value="13-17">13–17</option><option value="18-24">18–24</option><option value="25-34">25–34</option><option value="35-44">35–44</option><option value="45+">45+</option>';boostAge.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';
        const boostGender=document.createElement('select');boostGender.innerHTML='<option value="all">All genders</option><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Non-binary</option>';boostGender.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';
        const boostInterestWrap=document.createElement('div');boostInterestWrap.style.cssText='grid-column:1/-1;min-width:0';const boostInterests=document.createElement('input');boostInterests.type='hidden';boostInterests.value='';const boostInterestToggle=document.createElement('button');boostInterestToggle.type='button';boostInterestToggle.textContent='Choose interests ▾';boostInterestToggle.style.cssText='width:100%;text-align:left;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#fff;color:#242033';const boostInterestPicker=document.createElement('div');boostInterestPicker.hidden=true;boostInterestPicker.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:7px;max-height:220px;overflow:auto;padding:10px;margin-top:6px;border:1px solid #ded7eb;border-radius:9px;background:#fff';const boostInterestOptions=(boostGeo.interests||[]).map(x=>typeof x==='string'?{value:x,label:x}:x).filter(x=>x&&x.value);boostInterestOptions.forEach(item=>{const label=document.createElement('label');label.style.cssText='display:flex;gap:7px;align-items:center;font-size:14px';const cb=document.createElement('input');cb.type='checkbox';cb.value=item.value;cb.addEventListener('change',()=>{boostInterests.value=[...boostInterestPicker.querySelectorAll('input:checked')].map(x=>x.value).join(',');const count=boostInterestPicker.querySelectorAll('input:checked').length;boostInterestToggle.textContent=(count?count+' interests selected':'Choose interests')+' ▾'});label.append(cb,document.createTextNode(item.label||item.value));boostInterestPicker.appendChild(label)});boostInterestToggle.onclick=()=>{boostInterestPicker.hidden=!boostInterestPicker.hidden;boostInterestToggle.textContent=(boostInterestPicker.hidden?'Choose interests ▾':'Hide interests ▴')};boostInterestWrap.append(boostInterestToggle,boostInterestPicker,boostInterests);
        const boostBudget=document.createElement('input');boostBudget.type='number';boostBudget.min='1';boostBudget.step='1';boostBudget.value='5000';boostBudget.placeholder='Promotion budget (NGN)';boostBudget.setAttribute('aria-label','Campaign budget in NGN');boostBudget.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';
        // Charge currency remains NGN; this read-only display follows saved JOINT Settings.
        const boostCurrency=document.createElement('div');boostCurrency.setAttribute('aria-label','Preferred display currency from JOINT Settings');boostCurrency.style.cssText='min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px;background:#f1eaff;color:#5424b5;font-weight:700;display:flex;align-items:center;grid-column:1/-1';
        const boostCurrencyHint=document.createElement('div');boostCurrencyHint.textContent='The JOINT main administrator sets the pricing currency. The estimate is converted to your saved Settings currency and includes the 2% JOINT margin. Actual checkout currency is validated separately.';boostCurrencyHint.style.cssText='grid-column:1/-1;color:#6d6578;line-height:1.45';
        const boostMethod=document.createElement('div');boostMethod.textContent='Payment methods are selected securely at Paystack checkout.';boostMethod.style.cssText='grid-column:1/-1;color:#6d6578;line-height:1.45';
        const boostEst=document.createElement('div');boostEst.style.cssText='grid-column:1/-1;font-weight:800;color:#5424b5;line-height:1.5';
        const boostPin=document.createElement('input');boostPin.type='password';boostPin.inputMode='numeric';boostPin.autocomplete='off';boostPin.maxLength=6;boostPin.pattern='[0-9]{6}';boostPin.placeholder='Six-digit Diamond Wallet PIN';boostPin.setAttribute('aria-label','Six-digit Diamond Wallet PIN');boostPin.required=true;boostPin.style.cssText='grid-column:1/-1;min-width:0;padding:10px;border:1px solid #ded7eb;border-radius:9px';const boostSubmit=document.createElement('button');boostSubmit.type='submit';boostSubmit.textContent='Pay with Diamonds';boostSubmit.style.cssText='border:0;border-radius:10px;padding:11px;background:#6938d1;color:#fff;font-weight:800';
        const boostCancel=document.createElement('button');boostCancel.type='button';boostCancel.textContent='Cancel';boostCancel.style.cssText='border:1px solid #e5deef;border-radius:10px;padding:11px;background:#fff;color:#5424b5;font-weight:800;min-height:44px;display:block';boostForm.append(boostCountries,boostStates,boostAge,boostGender,boostInterestWrap,boostBudget,boostCurrency,boostCurrencyHint,boostMethod,boostEst,boostPin,boostSubmit,boostCancel);boostPanel.appendChild(boostForm);boostButton.onclick=async()=>{boostPanel.hidden=!boostPanel.hidden;if(!boostPanel.hidden){updateBoostEstimate();}};boostCancel.onclick=()=>boostPanel.hidden=true;
        let boostEstimateRun=0;let boostPreferredCurrency='NGN';let boostGlobalCurrency='NGN';
        const loadBoostPreferredCurrency=async()=>{try{const c=await getClient();const setting=await c.from('joint_global_settings').select('default_currency').eq('id','global').maybeSingle();const v=String(setting.data?.default_currency||'').toUpperCase();if(['NGN','USD'].includes(v))boostGlobalCurrency=v}catch(_){}let saved='';try{const c=await getClient();const pref=await c.from('joint_user_preferences').select('currency_preference').eq('user_id',currentUser.id).maybeSingle();saved=String(pref.data?.currency_preference||'').toUpperCase()}catch(_){}if(!['NGN','USD'].includes(saved)){try{const local=JSON.parse(localStorage.getItem('joint_user_preferences_v2')||'{}');saved=String(local.currency||'').toUpperCase()}catch(_){}}boostPreferredCurrency=['NGN','USD'].includes(saved)?saved:'NGN';const label=v=>v==='USD'?'USD — US Dollar':'NGN — Nigerian Naira';boostCurrency.textContent='JOINT pricing: '+label(boostGlobalCurrency)+' · Your Settings: '+label(boostPreferredCurrency);boostBudget.setAttribute('aria-label','Campaign budget in '+boostGlobalCurrency+' (JOINT admin pricing currency)');return boostPreferredCurrency};
        const updateBoostEstimate=async()=>{const run=++boostEstimateRun,b=Math.max(0,Number(boostBudget.value)||0);const targetCurrency=await loadBoostPreferredCurrency();const cur=boostGlobalCurrency;if(run!==boostEstimateRun)return;let rate=null;try{const c=await getClient();const country=boostCountries.value,state=boostStates.value;const q=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country',country).eq('currency',cur);if(!q.error){rate=(q.data||[]).find(x=>String(x.state_region||'*')===String(state||'*'))||(q.data||[]).find(x=>String(x.state_region||'*')==='*')||null}if(!rate){const d=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country','*').eq('currency',cur).eq('state_region','*').maybeSingle();if(d.data)rate=d.data}}catch(_){}if(!(b>0)){boostEst.textContent='Enter a campaign budget in '+cur+' to see estimated results.';return}if(!boostCountries.value){boostEst.textContent='Select one country to load the JOINT Admin rate card.';return}if(!rate){boostEst.textContent='No active JOINT Admin rate card for '+boostCountries.value+' in '+cur+'. Boosting is unavailable until JOINT Admin configures this country.';return}const impressions=Math.floor(b/(Number(rate.cpm)||Infinity)*1000),clicks=Math.floor(b/(Number(rate.cpc)||Infinity)),views=Math.floor(b/(Number(rate.cpv)||Infinity));if(targetCurrency===cur){boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Estimated impressions '+impressions.toLocaleString()+' · clicks '+clicks.toLocaleString()+' · views '+views.toLocaleString()+'. Display currency follows your JOINT Settings (NGN). Estimate only.';return}boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Estimated impressions '+impressions.toLocaleString()+' · clicks '+clicks.toLocaleString()+' · views '+views.toLocaleString()+'. Converting to your preferred currency (USD)…';try{const c=await getClient();const q=await c.functions.invoke('joint-currency-convert',{body:{amount:b,sourceCurrency:cur,targetCurrency}});if(run!==boostEstimateRun)return;if(q.error||!q.data?.ok)throw new Error(q.data?.error||q.error?.message||'Conversion unavailable');const x=q.data,money=n=>new Intl.NumberFormat(undefined,{style:'currency',currency:targetCurrency}).format(n);boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Estimated impressions '+impressions.toLocaleString()+' · clicks '+clicks.toLocaleString()+' · views '+views.toLocaleString()+'. Your Settings currency estimate: '+money(x.convertedAmount)+' + JOINT 2% margin '+money(x.conversionMargin)+' = '+money(x.estimatedTotal)+'. Rate updated '+new Date(x.rateTimestamp).toLocaleString()+'. Display estimate only; actual checkout currency is validated separately.'}catch(e){if(run===boostEstimateRun)boostEst.textContent='JOINT pricing budget: '+cur+' '+b.toLocaleString()+'. Preferred currency: '+targetCurrency+'. Currency conversion estimate unavailable: '+(e.message||'please retry')+'. No payment has been taken.'}};boostBudget.addEventListener('input',updateBoostEstimate);boostCountries.addEventListener('change',updateBoostEstimate);
        boostForm.onsubmit=async ev=>{ev.preventDefault();if(!boostCountries.value){alert('Choose one country for this post boost. You can create another boost for a different country.');return}if(!(Number(boostBudget.value)>0)){alert('Enter a budget greater than zero.');return}boostSubmit.disabled=true;try{const c=await getClient();const budget=Number(boostBudget.value),cur=boostGlobalCurrency,country=[boostCountries.value];let rate=null;const rr=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country',country[0]).eq('currency',cur);if(!rr.error)rate=(rr.data||[]).find(x=>String(x.state_region||'*')===String(boostStates.value||'*'))||(rr.data||[]).find(x=>String(x.state_region||'*')==='*')||null;if(!rate){const fallback=await c.from('joint_promotion_rates').select('*').eq('is_active',true).eq('promotion_type','personal_post').eq('country','*').eq('state_region','*').eq('currency',cur).maybeSingle();if(fallback.data)rate=fallback.data}if(!rate)throw new Error('JOINT Admin has not configured an active rate card for '+country[0]+'.');const payload={owner_id:currentUser.id,post_id:post.id,campaign_kind:'post',name:'Boosted post · '+(profile.display_name||'JOINT member'),targets:[{kind:'post',key:'post:'+post.id,label:(post.content||'Post').slice(0,120),post_id:post.id}],targeting:{countries:country,states:boostStates.value?[boostStates.value]:[],age_range:boostAge.value,gender:boostGender.value,interests:boostInterests.value.split(',').map(x=>x.trim()).filter(Boolean)},budget,currency:'NGN',estimated_impressions:Math.floor(budget/Number(rate.cpm||Infinity)*1000),estimated_clicks:Math.floor(budget/Number(rate.cpc||Infinity)),estimated_views:Math.floor(budget/Number(rate.cpv||Infinity)),status:'pending_review',updated_at:new Date().toISOString()};const pin=boostPin.value.trim();if(!/^[0-9]{6}$/.test(pin))throw new Error('Enter your six-digit Diamond Wallet PIN.');const idempotencyKey=crypto.randomUUID?crypto.randomUUID():('boost-'+Date.now()+'-'+Math.random().toString(36).slice(2,12));const paid=await c.rpc('joint_diamond_pay_post_boost',{p_post_id:post.id,p_payload:payload,p_pin:pin,p_idempotency_key:idempotencyKey});if(paid.error)throw paid.error;if(!paid.data?.ok)throw new Error(paid.data?.message||'Diamond payment could not be completed.');boostPin.value='';alert('Paid '+Number(paid.data.diamonds||0).toLocaleString()+' Diamonds. Your post boost request is awaiting review. Reference: '+paid.data.reference);boostPanel.hidden=true;await renderOwnPosts(target,profile);}catch(err){const message=String(err?.message||'Payment could not be completed.').replace(/\s*[—-]\s*make sure the JOINT promotion migration is applied\.?/i,'').trim();alert('Could not pay for post boost: '+message)}finally{boostSubmit.disabled=false}};
        interactionBox.append(boostButton,boostPanel);
        const postPromoBox=document.createElement('div');postPromoBox.hidden=true;postPromoBox.style.cssText='display:grid;grid-template-columns:minmax(0,1fr);gap:8px;overflow:visible;margin-top:10px;padding:10px;border:1px solid #e5deef;border-radius:12px;background:#fbf9ff';
        const loadPostPromos=async()=>{try{const c=await getClient();const r=await c.from('joint_promotions').select('id,name,status,budget,currency,estimated_impressions,estimated_clicks,estimated_views,impressions_count,clicks_count,views_count,spent_amount,targeting,created_at').eq('owner_id',currentUser.id).eq('post_id',post.id).order('created_at',{ascending:false}).limit(10);postPromoBox.replaceChildren();if(r.error)throw r.error;if(!r.data?.length){postPromoBox.hidden=true;return}postPromoBox.hidden=false;r.data.forEach(async promo=>{const tile=document.createElement('div');tile.style.cssText='box-sizing:border-box;width:100%;min-width:0;padding:10px;border-radius:9px;background:#fff;border:1px solid #eee5f8;display:grid;grid-template-columns:minmax(0,1fr);gap:4px';tile.innerHTML='<strong>'+String(promo.status).replace(/[<>]/g,'')+'</strong><div style="font-size:12px;color:#6d6578">Budget '+String(promo.currency)+' '+Number(promo.budget||0).toLocaleString()+'</div><div style="font-size:12px">Est. impressions '+Number(promo.estimated_impressions||0).toLocaleString()+'</div><div style="font-size:12px">Est. clicks '+Number(promo.estimated_clicks||0).toLocaleString()+'</div><div style="font-size:12px">Est. views '+Number(promo.estimated_views||0).toLocaleString()+'</div>';const country=Array.isArray(promo.targeting?.countries)?promo.targeting.countries[0]:'Country';const live=document.createElement('div');live.style.cssText='font-size:12px;font-weight:800;color:#5424b5;margin-top:5px;line-height:1.5;overflow-wrap:anywhere';live.textContent=country+' · Actual: '+Number(promo.impressions_count||0).toLocaleString()+' impressions · '+Number(promo.clicks_count||0).toLocaleString()+' clicks · '+Number(promo.views_count||0).toLocaleString()+' views';tile.appendChild(live);const spent=document.createElement('div');spent.style.cssText='font-size:12px;color:#6d6578;margin-top:4px';spent.textContent='Spent '+String(promo.currency)+' '+Number(promo.spent_amount||0).toLocaleString();tile.appendChild(spent);postPromoBox.appendChild(tile)})}catch(err){postPromoBox.hidden=true;console.warn('Boost metrics unavailable:',err.message)}};
        card.appendChild(postPromoBox);loadPostPromos();
        const commentPanel=document.createElement('div'); commentPanel.hidden=true; commentPanel.style.cssText='margin-top:10px';
        const commentList=document.createElement('div'); commentList.style.cssText='display:grid;gap:8px;margin-bottom:10px';
        const commentInput=document.createElement('input');commentInput.type='text';commentInput.maxLength=500;commentInput.placeholder='Write a comment…';commentInput.style.cssText='width:100%;box-sizing:border-box;padding:11px;border:1px solid #e7e0f1;border-radius:10px';
        const commentForm=document.createElement('form');commentForm.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
        const sendComment=document.createElement('button');sendComment.type='submit';sendComment.textContent='Post comment';sendComment.style.cssText='border:0;border-radius:10px;padding:10px 14px;background:#6938d1;color:white;font-weight:700';
        commentForm.append(commentInput,sendComment);commentPanel.append(commentList,commentForm);interactionBox.appendChild(commentPanel);card.appendChild(interactionBox);
        const loadComments = async () => {
          commentList.replaceChildren();
          try {
            const c=await getClient();
            const {data:rows,error}=await c.from('joint_comments').select('id,user_id,content,created_at,parent_comment_id').eq('post_id',post.id).order('created_at',{ascending:true});
            if(error)throw error;
            const ids=[...new Set((rows||[]).map(x=>x.user_id).filter(Boolean))];let profiles=[];
            if(ids.length){const pr=await c.from('joint_profiles').select('id,display_name,avatar_url').in('id',ids);if(!pr.error)profiles=pr.data||[];}
            const profileMap=new Map(profiles.map(x=>[x.id,x]));
            const byParent=new Map();(rows||[]).forEach(row=>{const key=row.parent_comment_id||null;if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(row)});
            const renderRow=(row,depth=0,container=commentList)=>{
              const prof=profileMap.get(row.user_id)||{},nameText=prof.display_name||'JOINT member';
              const item=document.createElement('div');item.style.cssText=`box-sizing:border-box;width:100%;max-width:100%;min-width:0;background:${depth===0?'#f7f4fc':depth===1?'#eee7fb':'#e5dcf7'};border:1px solid ${depth===0?'#eee7f5':'#d9c9f1'};border-radius:10px;padding:10px;overflow-wrap:anywhere;word-break:break-word;overflow-x:hidden`;
              const head=document.createElement('div');head.style.cssText='display:flex;align-items:center;gap:9px';
              const avatar=document.createElement('a');avatar.href='member-profile.html?id='+encodeURIComponent(row.user_id||'');avatar.style.cssText='width:34px;height:34px;flex:0 0 34px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:#eee5ff;color:#5424b5;font-size:12px;font-weight:800;text-decoration:none';
              const initials=nameText.trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'J';avatar.textContent=initials;
              if(prof.avatar_url){const img=document.createElement('img');img.src=prof.avatar_url;img.alt=nameText+' profile picture';img.style.cssText='width:100%;height:100%;object-fit:cover';img.onerror=()=>{img.remove();avatar.textContent=initials};avatar.textContent='';avatar.appendChild(img)}
              const name=document.createElement('a');name.textContent=nameText;name.href='member-profile.html?id='+encodeURIComponent(row.user_id||'');name.style.cssText='font-weight:800;color:inherit;text-decoration:none';head.append(avatar,name);item.append(head);
              const text=document.createElement('p');text.style.cssText='margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere';text.textContent=row.content;item.append(text);
              const reply=document.createElement('button');reply.type='button';reply.textContent='Reply';reply.style.cssText='border:0;background:transparent;color:#5424b5;font-weight:700;padding:4px 0';
              const replyForm=document.createElement('form');replyForm.hidden=true;replyForm.style.cssText='display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;width:100%;max-width:100%;min-width:0;box-sizing:border-box';const replyInput=document.createElement('input');replyInput.type='text';replyInput.maxLength=500;replyInput.required=true;replyInput.placeholder='Reply to '+nameText+'…';replyInput.style.cssText='flex:1 1 150px;min-width:0;max-width:100%;box-sizing:border-box;padding:9px;border:1px solid #e7e0f1;border-radius:9px';const replySend=document.createElement('button');replySend.type='submit';replySend.textContent='Send';replySend.style.cssText='border:0;border-radius:9px;padding:8px 12px;background:#6938d1;color:white;font-weight:700';replyForm.append(replyInput,replySend);
              reply.onclick=()=>{replyForm.hidden=!replyForm.hidden;if(!replyForm.hidden)replyInput.focus()};replyForm.onsubmit=async ev=>{ev.preventDefault();const content=replyInput.value.trim();if(!content)return;replySend.disabled=true;try{const {error}=await c.from('joint_comments').insert({post_id:post.id,user_id:currentUser.id,content,parent_comment_id:row.id});if(error)throw error;await loadComments();await refreshCard()}catch(err){alert('Could not post reply: '+err.message)}finally{replySend.disabled=false}};
              item.append(reply,replyForm);container.appendChild(item);
              const children=byParent.get(row.id)||[];if(!children.length)return;const replyArea=document.createElement('div');replyArea.style.cssText=`display:grid;gap:7px;margin:7px 0 0;padding:0 0 0 9px;border-left:3px solid ${depth===0?'#d7c4fb':'#bda5e9'};width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow-x:hidden`;item.appendChild(replyArea);let visible=0;const more=document.createElement('button');more.type='button';more.textContent='View replies ('+children.length+')';more.style.cssText='justify-self:start;border:0;border-radius:999px;background:#eee5ff;color:#5424b5;padding:5px 10px;font-size:.82rem;font-weight:800;cursor:pointer';const showNext=()=>{children.slice(visible,visible+5).forEach(child=>renderRow(child,depth+1,replyArea));visible=Math.min(visible+5,children.length);if(visible<children.length)more.textContent='View more replies ('+(children.length-visible)+' remaining)';else more.remove()};more.addEventListener('click',showNext);item.appendChild(more);
            };
            (byParent.get(null)||[]).forEach(row=>renderRow(row,0,commentList));
            if(!rows?.length){const empty=document.createElement('p');empty.textContent='No comments yet. Start the conversation.';empty.style.color='#777486';commentList.appendChild(empty);}
          } catch(err){const msg=document.createElement('p');msg.textContent='Could not load comments: '+err.message;commentList.appendChild(msg);}
        };
        commentForm.onsubmit=async ev=>{ev.preventDefault();const text=commentInput.value.trim();if(!text)return;sendComment.disabled=true;try{const c=await getClient();const {error}=await c.from('joint_comments').insert({post_id:post.id,user_id:currentUser.id,content:text,parent_comment_id:null});if(error)throw error;commentInput.value='';await loadComments();await refreshCard();}catch(err){alert('Could not post comment: '+err.message);}finally{sendComment.disabled=false;}};
        // Load comment threads on demand; replies are stored against their parent comment.
        const originalCommentClick=actionRow.children[1].onclick;
        actionRow.children[1].onclick=async()=>{commentPanel.hidden=!commentPanel.hidden;if(!commentPanel.hidden){await loadComments();commentInput.focus();}};

        const menuWrap=document.createElement('div');menuWrap.className='joint-post-menu-wrap';
        const menuButton=document.createElement('button');menuButton.type='button';menuButton.className='joint-post-menu';menuButton.textContent='⋯';menuButton.setAttribute('aria-label','Post options');menuButton.setAttribute('aria-expanded','false');
        const menuPanel=document.createElement('div');menuPanel.className='joint-post-menu-popover';menuPanel.hidden=true;
        const edit=document.createElement('button');edit.type='button';edit.dataset.edit=post.id;edit.textContent='Edit post';
        const remove=document.createElement('button');remove.type='button';remove.dataset.delete=post.id;remove.textContent='Delete post';
        menuPanel.append(edit,remove);menuButton.addEventListener('click',()=>{const open=menuPanel.hidden;menuPanel.hidden=!open;menuButton.setAttribute('aria-expanded',String(open));});
        document.addEventListener('click',event=>{if(!menuWrap.contains(event.target)){menuPanel.hidden=true;menuButton.setAttribute('aria-expanded','false');}});
        menuWrap.append(menuButton,menuPanel);head.append(menuWrap);
        target.appendChild(card);
      });
      target.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('Delete this post from JOINT for everyone?')) return;
        button.disabled = true;
        try {
          const client = await getClient();
          const { error } = await client.from('joint_posts').delete()
            .eq('id', button.dataset.delete).eq('author_id', currentUser.id);
          if (error) throw error;
          await renderOwnPosts(target, profile);
          document.dispatchEvent(new Event('joint-posts-updated'));
        } catch (error) {
          alert('Could not delete post: ' + error.message);
          button.disabled = false;
        }
      }));
      target.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', async () => {
        const selectedPost = (items || []).find(item => String(item.id) === String(button.dataset.edit));
        if (!selectedPost) { alert('Could not find this post. Refresh and try again.'); return; }
        const text = prompt('Edit your shared post text:', selectedPost.content || '');
        if (text === null) return;
        if (!text.trim()) { alert('Post text cannot be empty.'); return; }
        button.disabled = true;
        try {
          const client = await getClient();
          const { error } = await client.from('joint_posts').update({
            content: text.trim(), updated_at: new Date().toISOString()
          }).eq('id', button.dataset.edit).eq('author_id', currentUser.id);
          if (error) throw error;
          await renderOwnPosts(target, profile);
          document.dispatchEvent(new Event('joint-posts-updated'));
        } catch (error) {
          alert('Could not update post: ' + error.message);
          button.disabled = false;
        }
      }));
      requestAnimationFrame(() => window.scrollTo({ top: previousY, behavior: 'instant' }));
    } catch (error) {
      console.error('JOINT shared posts load failed:', error);
      target.innerHTML = '<div class="card muted">Could not load your posts: ' + safe(error.message) + '</div>';
    }
  }

  async function uploadAvatar(client, file) {
    if (!file) return remoteProfile?.avatar_url || null;
    if (!/^image\//.test(file.type) || file.size > 3 * 1024 * 1024) {
      throw new Error('Choose an image smaller than 3 MB.');
    }
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${currentUser.id}/${Date.now()}.${extension}`;
    const { error } = await client.storage.from('joint-avatars').upload(path, file, {
      upsert: true, contentType: file.type, cacheControl: '3600'
    });
    if (error) throw error;
    const { data } = client.storage.from('joint-avatars').getPublicUrl(path);
    return data.publicUrl;
  }

  async function uploadPostMedia(client, file) {
    if (!file) return [];
    const isImage = /^image\//.test(file.type);
    const isVideo = /^video\//.test(file.type);
    if (!isImage && !isVideo) throw new Error('Choose an image or video file.');
    const maxBytes = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) throw new Error(isVideo ? 'Choose a video smaller than 50 MB.' : 'Choose an image smaller than 10 MB.');
    const extension = (file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '') || (isVideo ? 'mp4' : 'jpg');
    const path = `${currentUser.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error } = await client.storage.from('joint-post-media').upload(path, file, {
      upsert: false, contentType: file.type, cacheControl: '3600'
    });
    if (error) throw error;
    const { data } = client.storage.from('joint-post-media').getPublicUrl(path);
    return [{ url: data.publicUrl, type: isVideo ? 'video' : 'image', name: file.name }];
  }

  async function initProfilePage() {
    const form = document.getElementById('profile-form');
    const postForm = document.getElementById('joint-post-form');
    const postsTarget = document.getElementById('joint-own-posts');
    let profile;
    try {
      const client = await getClient();
      profile = await loadProfile();
      profileCard(profile);
      renderOwnPosts(postsTarget, profile);
    } catch (error) {
      console.error('JOINT profile load failed:', error);
      const status = document.getElementById('profile-success');
      if (status) {
        status.className = 'settings-status error';
        status.textContent = `Could not load your profile from Supabase: ${error.message}. Check the joint_profiles table columns and RLS policies.`;
        status.style.display = 'block';
      }
      return;
    }

    const editPanel=document.getElementById('profile-edit-panel');
    const editToggle=document.getElementById('toggle-profile-edit');
    const createPanel=document.getElementById('create-post-panel');
    const createToggle=document.getElementById('toggle-create-post');
    if(editPanel && editToggle){
      editPanel.hidden=true;
      editToggle.setAttribute('aria-expanded','false');
      editToggle.addEventListener('click',()=>{
        const opening=editPanel.hidden;
        editPanel.hidden=!opening;
        editToggle.setAttribute('aria-expanded',String(opening));
        editToggle.textContent=opening?'✕ Close profile editor':'✎ Edit profile';
        if(opening){if(createPanel)createPanel.hidden=true;if(createToggle){createToggle.setAttribute('aria-expanded','false');createToggle.textContent='＋ Create a post';}editPanel.scrollIntoView({behavior:'smooth',block:'start'});}
      });
    }
    if(createPanel && createToggle){
      createPanel.hidden=true;
      createToggle.setAttribute('aria-expanded','false');
      createToggle.addEventListener('click',()=>{
        const opening=createPanel.hidden;
        createPanel.hidden=!opening;
        createToggle.setAttribute('aria-expanded',String(opening));
        createToggle.textContent=opening?'✕ Close post editor':'＋ Create a post';
        if(opening){if(editPanel)editPanel.hidden=true;if(editToggle){editToggle.setAttribute('aria-expanded','false');editToggle.textContent='✎ Edit profile';}createPanel.scrollIntoView({behavior:'smooth',block:'start'});}
      });
    }
    if (form) {
      ['profile-name', 'profile-bio'].forEach((id, index) => {
        const input = document.getElementById(id);
        if (input) input.value = [profile.display_name, profile.bio][index] || '';
      });
      const dobInput = document.getElementById('profile-dob');
      if (dobInput) dobInput.value = profile.date_of_birth || '';
      const countryInput = document.getElementById('profile-country');
      const regionInput = document.getElementById('profile-region');
      const genderInput = document.getElementById('profile-gender');
      const interestInput = document.getElementById('profile-interests');
      const interestChips = document.getElementById('profile-interest-chips');
      const interestPicker = document.getElementById('profile-interest-picker');
      const interestAdd = document.getElementById('profile-interest-add');
      const geo = window.JOINT_GEO_DATA || {countries:[],states:{},interests:[]};
      const interestOptions = geo.interests || [];
      const interestLabel = value => {
        const found = interestOptions.find(x => x.value === String(value).toLowerCase() || x.label.toLowerCase() === String(value).toLowerCase());
        return found ? found.value : String(value).toLowerCase();
      };
      const parseInterests = value => {
        if (Array.isArray(value)) return value.map(interestLabel).filter(Boolean);
        let text = String(value || '').trim();
        try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed.map(interestLabel).filter(Boolean); } catch (_) {}
        return text.split(/[,;|]/).map(v => interestLabel(v.trim())).filter(Boolean);
      };
      let chosenInterests = [...new Set(parseInterests(profile.interests))];
      const prefKeys = ['joint_user_preferences_v2'];
      let settings = {};
      try { settings = JSON.parse(localStorage.getItem(prefKeys[0]) || '{}') || {}; } catch (_) {}
      const savedCountry = settings.country || settings.selectedCountry || settings.country_name || '';
      const profileCountry = profile.country || '';
      const countryCode = geo.countries.find(row => row[0] === savedCountry || row[1].toLowerCase() === String(savedCountry).toLowerCase() || row[1].toLowerCase() === String(profileCountry).toLowerCase())?.[0] || '';
      const settingsRegion = settings.state_region || settings.state || settings.region || settings.selectedState || profile.state_region || '';
      const fillProfileCountries = selected => {
        if (!countryInput) return;
        countryInput.replaceChildren(new Option('Select country',''));
        geo.countries.forEach(row => countryInput.add(new Option(row[1],row[0])));
        countryInput.value = selected || '';
      };
      const fillProfileStates = (code, selected) => {
        if (!regionInput) return;
        const rows = geo.states[code] || [];
        regionInput.replaceChildren(new Option(rows.length ? 'Select state / region' : 'State list unavailable for this country',''));
        rows.forEach(name => regionInput.add(new Option(name,name)));
        if (selected && !rows.includes(selected)) regionInput.add(new Option(selected + ' (saved)',selected));
        regionInput.value = selected || '';
      };
      fillProfileCountries(countryCode);
      fillProfileStates(countryCode, settingsRegion);
      const syncLocationToLocal = () => {
        const current = (() => { try { return JSON.parse(localStorage.getItem(prefKeys[0]) || '{}'); } catch (_) { return {}; } })();
        current.country = countryInput.value;
        current.state_region = regionInput.value;
        current.updatedAt = new Date().toISOString();
        try { localStorage.setItem(prefKeys[0], JSON.stringify(current)); } catch (_) {}
      };
      if (countryInput) countryInput.addEventListener('change', () => { fillProfileStates(countryInput.value, ''); syncLocationToLocal(); });
      if (regionInput) regionInput.addEventListener('change', syncLocationToLocal);
      if (genderInput) genderInput.value = profile.gender || '';
      const renderInterests = () => {
        if (interestInput) interestInput.value = JSON.stringify(chosenInterests);
        if (interestChips) interestChips.innerHTML = chosenInterests.map(v => { const item = interestOptions.find(x => x.value === v); return '<span class="choice">' + safe(item ? item.label : v) + '</span>'; }).join('') || '<span class="muted">No interests selected</span>';
        if (interestPicker) interestPicker.innerHTML = interestOptions.map(item => '<label class="choice"><input type="checkbox" value="' + safe(item.value) + '" ' + (chosenInterests.includes(item.value) ? 'checked' : '') + '> ' + safe(item.label) + '</label>').join('');
      };
      renderInterests();
      if (interestAdd && interestPicker) interestAdd.addEventListener('click', () => { interestPicker.hidden = !interestPicker.hidden; });
      if (interestPicker) interestPicker.addEventListener('change', event => {
        if (!event.target.matches('input[type="checkbox"]')) return;
        chosenInterests = Array.from(interestPicker.querySelectorAll('input:checked')).map(input => input.value);
        renderInterests();
      });
      const preview = document.getElementById('profile-picture-preview');
      if (preview && profile.avatar_url) {
        preview.src = profile.avatar_url;
        preview.style.display = 'block';
        const placeholder = document.getElementById('profile-avatar-placeholder');
        if (placeholder) placeholder.style.display = 'none';
      }
      const picture = document.getElementById('profile-picture');
      if (picture) picture.addEventListener('change', () => {
        selectedAvatarFile = picture.files?.[0] || null;
        if (!selectedAvatarFile) return;
        if (!/^image\//.test(selectedAvatarFile.type) || selectedAvatarFile.size > 3 * 1024 * 1024) {
          alert('Choose an image smaller than 3 MB.');
          picture.value = '';
          selectedAvatarFile = null;
          return;
        }
        if (preview) {
          if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
          preview.dataset.objectUrl = URL.createObjectURL(selectedAvatarFile);
          preview.src = preview.dataset.objectUrl;
          preview.style.display = 'block';
          const placeholder = document.getElementById('profile-avatar-placeholder');
          if (placeholder) placeholder.style.display = 'none';
        }
      });

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const status = document.getElementById('profile-success');
        if (button) { button.disabled = true; button.textContent = 'Saving…'; }
        if (status) { status.className = 'success'; status.textContent = ''; status.style.display = ''; }
        try {
          const client = await getClient();
          const avatarUrl = await uploadAvatar(client, selectedAvatarFile);
          const updates = {
            display_name: document.getElementById('profile-name').value.trim(),
            bio: document.getElementById('profile-bio').value.trim(),
            interests: chosenInterests,
            date_of_birth: document.getElementById('profile-dob')?.value || null,
            age: document.getElementById('profile-dob')?.value ? Math.floor((Date.now() - new Date(document.getElementById('profile-dob').value + 'T00:00:00').getTime()) / 31557600000) : null,
            country: geo.countries.find(row => row[0] === countryInput?.value)?.[1] || null,
            state_region: regionInput?.value.trim() || null,
            gender: document.getElementById('profile-gender')?.value || null,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString()
          };
          if (!updates.display_name) throw new Error('Please enter a display name.');
          if (!updates.date_of_birth) throw new Error('Please select your date of birth.');
          if (Number.isNaN(new Date(updates.date_of_birth).getTime()) || new Date(updates.date_of_birth) >= new Date()) throw new Error('Please select a valid date of birth.');
          if (!updates.age || updates.age < 13 || updates.age > 120) throw new Error('You must be between 13 and 120 years old.');
          if (!['male','female'].includes(updates.gender)) throw new Error('Please select Male or Female.');
          if (!Array.isArray(updates.interests) || updates.interests.length < 1) throw new Error('Please select at least one interest.');
          const { data, error } = await client.from('joint_profiles')
            .update(updates).eq('id', currentUser.id).select('*').single();
          if (error) throw error;
          remoteProfile = data;
          syncLocationToLocal();
          profile = fallbackProfile();
          writeLocal(STORAGE.profile, {
            name: profile.display_name, bio: profile.bio,
            interests: profile.interests, age: profile.age, date_of_birth: profile.date_of_birth, avatar: profile.avatar_url
          });
          selectedAvatarFile = null;
          if (picture) picture.value = '';
          profileCard(profile);
          if (preview) {
            if (profile.avatar_url) { preview.src = profile.avatar_url; preview.style.display = 'block'; }
            else { preview.removeAttribute('src'); preview.style.display = 'none'; }
          }
          if (status) {
            status.className = 'success';
            status.textContent = 'Profile saved to your JOINT account. It will load when you sign in on another device.';
            status.style.display = 'block';
          }
          document.dispatchEvent(new CustomEvent('joint-profile-updated', { detail: profile }));
          if(editPanel && editToggle){editPanel.hidden=true;editToggle.setAttribute('aria-expanded','false');editToggle.textContent='✎ Edit profile';}
        } catch (error) {
          console.error('JOINT profile save failed:', error);
          if (status) {
            status.className = 'settings-status error';
            status.textContent = `Could not save your profile: ${error.message}`;
            status.style.display = 'block';
          } else alert(`Could not save your profile: ${error.message}`);
        } finally {
          if (button) { button.disabled = false; button.textContent = 'Save profile'; }
        }
      });
    }

    if (postForm) {
      postForm.addEventListener('submit', async event => {
        event.preventDefault();
        const textInput = document.getElementById('joint-post-text');
        const text = textInput?.value.trim() || '';
        const file = document.getElementById('joint-post-file')?.files?.[0];
        const message = document.getElementById('joint-post-message');
        const button = postForm.querySelector('button[type="submit"]');
        if (!text && !file) {
          if (message) message.textContent = 'Write an update or choose a picture/video before publishing.';
          return;
        }
        if (button) { button.disabled = true; button.textContent = 'Publishing…'; }
        if (message) { message.textContent = ''; message.className = 'muted'; }
        try {
          const client = await getClient();
          if (message) message.textContent = file ? 'Uploading your media…' : 'Publishing your post…';
          const mediaUrls = await uploadPostMedia(client, file);
          const { error } = await client.from('joint_posts').insert({
            author_id: currentUser.id,
            content: text,
            media_urls: mediaUrls,
            visibility: 'public'
          });
          if (error) throw error;
          postForm.reset();
          await renderOwnPosts(postsTarget, profile);
          if (message) {
            message.className = 'success';
            message.textContent = 'Your post was published to JOINT and can be seen by other users allowed by the feed policies.';
          }
          document.dispatchEvent(new Event('joint-posts-updated'));
        } catch (error) {
          console.error('JOINT post publish failed:', error);
          if (message) {
            message.className = 'settings-status error';
            message.textContent = 'Could not publish your post: ' + error.message + '. Check the joint_posts columns and INSERT policy.';
          }
        } finally {
          if (button) { button.disabled = false; button.textContent = 'Publish post'; }
        }
      });
    }
  }

  function initOtherSocialControls() {
    document.querySelectorAll('[data-joint-follow]').forEach(element => {
      const id = element.dataset.jointFollow;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'joint-star';
      button.textContent = follows().includes(id) ? '⭐ Following' : '⭐ Follow';
      button.addEventListener('click', () => {
        const list = follows();
        const index = list.indexOf(id);
        if (index < 0) list.push(id); else list.splice(index, 1);
        writeLocal(STORAGE.follows, list);
        button.textContent = list.includes(id) ? '⭐ Following' : '⭐ Follow';
        document.dispatchEvent(new Event('joint-social-change'));
      });
      element.replaceWith(button);
    });
  }

  async function init() {
    initOtherSocialControls();
    if (document.getElementById('profile-form') || document.getElementById('joint-profile-summary')) {
      await initProfilePage();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.JOINTSocial = {
    posts, follows, keys: STORAGE,
    getCurrentProfile: () => remoteProfile,
    reloadProfile: loadProfile
  };
})();
