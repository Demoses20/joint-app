/* JOINT learning opportunities are inserted into the scrolling community feed as post-style cards. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(!document.getElementById('joint-verified-badge-style')){const st=document.createElement('style');st.id='joint-verified-badge-style';st.textContent='.joint-verified-badge{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;margin-left:5px;padding:3px 7px;border-radius:999px;background:#e8f7ee;color:#137a3f;font-size:.68em;font-weight:800;vertical-align:middle;border:1px solid #bce7cb}.learning-title-with-badge{display:flex;align-items:center;flex-wrap:wrap;gap:5px}';document.head.appendChild(st)}
  const terms = value => String(value || '').split(/[,;|]/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const isApprovedOrganization = row => { const meta=row?.application_data||row?.metadata||{}; const owner=String(row?.owner_type||row?.host_type||row?.hosting_type||meta.owner_type||meta.host_type||'').trim().toLowerCase(); const organization=['organization','organisation','org','institution','company'].includes(owner); const approval=row?.__approvedApplication===true||String(row?.status||'').toLowerCase()==='approved'||row?.__source==='public'; return organization&&approval&&row?.is_approved!==false&&row?.approved!==false; };
  const money = (value,currency='NGN') => { const n=Number(value)||0; if(n<=0)return 'Free to explore'; try{return new Intl.NumberFormat(undefined,{style:'currency',currency:currency||'NGN',notation:'compact',maximumFractionDigits:1}).format(n)}catch(_){return currency+' '+n.toLocaleString()} };
  let opportunities=[], inserted=false, scheduled=false;
  async function load() {
    if (!window.jointSupabaseConnection) return;
    try {
      const db = await window.jointSupabaseConnection;
      const {data: auth} = await db.auth.getUser();
      if (!auth?.user) return;
      const [profile, courses, classes] = await Promise.all([
        db.from('joint_profiles').select('interests').eq('id',auth.user.id).maybeSingle(),
        db.from('joint_courses').select('*').eq('status','published').limit(300),
        db.from('joint_school_classes').select('*').eq('is_active',true).limit(300)
      ]);
      // Prefer the public directory: host applications can be private under RLS,
      // while the public school table is intended for Home and Classes discovery.
      const schoolRows=[];
      try { const r=await db.from('joint_public_schools').select('*').limit(300); if(!r.error)schoolRows.push(...(r.data||[]).map(x=>({...x,__source:'public'}))); else console.warn('Public school directory unavailable:',r.error.message); }
      catch(e){console.warn('Public school directory unavailable:',e)}
      try { const r=await db.from('joint_school_host_applications').select('*').eq('status','approved').limit(300); if(!r.error)schoolRows.push(...(r.data||[]).map(x=>({...x,__source:'application'}))); else console.warn('Approved school fallback unavailable:',r.error.message); }
      catch(e){console.warn('Approved school fallback unavailable:',e)}
      const schoolMap=new Map();
      for(const row of schoolRows){
        const id=row.application_id||row.host_application_id||row.id;
        const name=row.school_name||row.institute_name||row.organization_name||row.name||row.title;
        if(!id||!name)continue;
        if(row.__source==='application'&&row.status!=='approved')continue;
        const meta=row.application_data||row.metadata||{};
        if(meta.joint_school_is_published===false||row.is_published===false||row.is_public===false||row.published===false||row.is_active===false)continue;
        const previous=schoolMap.get(String(id))||{};
        const logoPath=row.logo_path||row.logo_url||row.school_logo_url||row.institute_logo_url||row.logo_storage_path||meta.logo_path||meta.logo_url||previous.logo_path||'';
        const bannerPath=row.banner_path||row.banner_url||row.banner_image_url||row.school_banner_url||row.institute_banner_url||row.school_banner_path||row.institute_banner_path||row.cover_image_url||row.cover_path||meta.banner_path||meta.banner_url||meta.school_banner_url||meta.cover_image_url||meta.cover_path||previous.banner_path||'';
        const normalized={...previous,...row,id:String(id),application_id:String(id),school_name:name,title:name,category:row.category||row.school_type||row.institute_type||previous.category||'School / Institute',description:row.description||row.about||row.bio||previous.description||'',country:row.country||previous.country||'',state_region:row.state_region||row.state||row.region||previous.state_region||'',city:row.city||previous.city||'',logo_path:logoPath,banner_path:bannerPath,owner_type:row.owner_type||row.host_type||row.hosting_type||meta.owner_type||meta.host_type||previous.owner_type||'',__source:row.__source||previous.__source,__approvedApplication:(row.__source==='application'&&String(row.status||'').toLowerCase()==='approved')||previous.__approvedApplication===true};
        normalized.verifiedOrganization=isApprovedOrganization(normalized);
        // Preserve uploaded banner/logo paths when the public directory omits those columns.
        schoolMap.set(String(id),normalized);
      }
      const schools=[...schoolMap.values()];
      // The public directory can omit banner_path. Resolve public media paths through
      // a narrow RPC that returns paths only for approved, published schools.
      try {
        const ids=schools.map(s=>s.id).filter(Boolean);
        if(ids.length){
          const media=await db.rpc('joint_get_public_school_assets',{p_application_ids:ids});
          if(!media.error) for(const asset of (media.data||[])){
            const target=schoolMap.get(String(asset.application_id));
            if(target){target.logo_path=target.logo_path||asset.logo_path||'';target.banner_path=target.banner_path||asset.banner_path||'';}
          }
          else console.warn('Public school banner paths unavailable; run joint-school-public-assets.sql:',media.error.message);
        }
      } catch(e){console.warn('Public school asset lookup failed:',e)}
      const interests=terms(profile.data?.interests), items=[];
      schools.forEach(s=>items.push({kind:'School / Institute',title:s.school_name,description:s.description,category:s.category,location:[s.city,s.state_region,s.country].filter(Boolean).join(', '),host:s.school_name,logoPath:s.logo_path||'',bannerPath:s.banner_path||'',verifiedOrganization:Boolean(s.verifiedOrganization),price:0,interestText:[s.school_name,s.category,s.description,s.country,s.state_region,s.city].join(' '),applicationId:s.id,href:'classes.html?schoolId='+encodeURIComponent(s.id),created:s.submitted_at||s.created_at||s.updated_at}));
      (courses.data||[]).forEach(c=>items.push({kind:c.host_type==='school'?'School course':'Course',title:c.title,description:c.description,category:c.category,location:[c.state,c.country].filter(Boolean).join(', '),host:c.host_name||'JOINT',logoPath:'',verifiedOrganization:false,price:Number(c.price)||0,currency:c.currency||'NGN',bannerUrl:c.banner_url||c.content?.course?.banner_url||'',interestText:[c.title,c.category,c.description,c.host_name,c.country,c.state,JSON.stringify(c.content?.course?.subjects||[])].join(' '),courseId:c.id,applicationId:c.application_id,href:'classes.html?course='+encodeURIComponent(c.id),created:c.published_at||c.created_at}));
      const appMap=new Map(schools.map(a=>[String(a.id),a]));
      // If a published course/class references a school not in the first query,
      // fetch that exact public directory row so it can still be shown on Home.
      const referenced=[...new Set([...(classes.data||[]).map(c=>c.application_id),...(courses.data||[]).map(c=>c.application_id)].filter(Boolean).map(String))];
      const missing=referenced.filter(id=>!appMap.has(id));
      if(missing.length){
        try{const r=await db.from('joint_public_schools').select('*').in('id',missing);if(!r.error)(r.data||[]).forEach(row=>{const id=row.application_id||row.id,name=row.school_name||row.institute_name||row.organization_name||row.name||row.title;if(!id||!name)return;const meta=row.application_data||row.metadata||{};if(meta.joint_school_is_published===false||row.is_published===false||row.is_public===false||row.published===false||row.is_active===false)return;const n={...row,id,school_name:name,title:name,category:row.category||'School / Institute',description:row.description||meta.description||'',country:row.country||'',state_region:row.state_region||row.state||'',city:row.city||'',owner_type:row.owner_type||row.host_type||row.hosting_type||meta.owner_type||meta.host_type||'',__source:'public',logo_path:row.logo_path||row.logo_url||row.school_logo_url||row.institute_logo_url||row.logo_storage_path||meta.logo_path||meta.logo_url||'',banner_path:row.banner_path||row.banner_url||row.banner_image_url||row.school_banner_url||row.institute_banner_url||row.school_banner_path||row.institute_banner_path||row.cover_image_url||row.cover_path||meta.banner_path||meta.banner_url||meta.school_banner_url||meta.cover_image_url||meta.cover_path||''};n.verifiedOrganization=isApprovedOrganization(n);appMap.set(String(id),n);if(!items.some(i=>i.kind==='School / Institute'&&String(i.applicationId)===String(id)))items.push({kind:'School / Institute',title:name,description:n.description,category:n.category,location:[n.city,n.state_region,n.country].filter(Boolean).join(', '),host:name,logoPath:n.logo_path,bannerPath:n.banner_path,price:0,interestText:[name,n.category,n.description,n.country,n.state_region,n.city].join(' '),applicationId:id,verifiedOrganization:Boolean(n.verifiedOrganization),href:'classes.html?schoolId='+encodeURIComponent(id),created:n.created_at||n.updated_at});});}catch(e){console.warn('Could not load referenced public schools',e)}
      }
      (courses.data||[]).forEach(c=>{const a=appMap.get(String(c.application_id));if(!a)return;const item=items.find(x=>x.kind==='School course'||x.kind==='Course' ? x.courseId===c.id : false);if(item&&!item.logoPath)item.logoPath=a.logo_path||'';});
      (classes.data||[]).filter(c=>appMap.has(String(c.application_id))).forEach(c=>{const a=appMap.get(String(c.application_id));items.push({kind:'Class',title:c.title||c.name||'Class',description:c.description,category:c.class_type||a.category,location:[a.city,a.state_region,a.country].filter(Boolean).join(', '),host:a.school_name||a.title,logoPath:a.logo_path||'',bannerPath:a.banner_path||'',bannerUrl:c.banner_url||'',price:Number(c.price)||0,currency:c.currency||'NGN',interestText:[c.title,c.class_type,c.description,a.school_name,a.category,a.country,a.state_region].join(' '),classId:c.id,applicationId:c.application_id,href:'classes.html?class='+encodeURIComponent(c.id)+'&schoolId='+encodeURIComponent(c.application_id),created:c.created_at});});
      // Public directory entries represent approved/published schools; only linked opportunities inherit the organization's verification.
      for(const item of items){const school=item.applicationId?appMap.get(String(item.applicationId)):null;item.verifiedOrganization=Boolean(school?.verifiedOrganization);}
      async function resolveMedia(value){if(!value)return '';const raw=String(value).trim();if(/^https?:\/\//i.test(raw)||raw.startsWith('data:'))return raw;const bucket='joint-host-verification';let path=raw.replace(/^\/+/, '').replace(/^storage\/v1\/object\/(?:public|sign)\//i,'').replace(/^joint-host-verification\//i,'');let decoded=path;try{decoded=decodeURIComponent(path)}catch(_){}const candidates=[...new Set([path,decoded,raw.replace(/^\/+/, '')].filter(Boolean))];for(const candidate of candidates){try{const r=await db.storage.from(bucket).createSignedUrl(candidate,3600);if(!r.error&&r.data?.signedUrl)return r.data.signedUrl}catch(_){}}for(const candidate of candidates){try{const r=db.storage.from(bucket).getPublicUrl(candidate);if(r.data?.publicUrl)return r.data.publicUrl}catch(_){}}return '';}
      for(const item of items){item.logoUrl=await resolveMedia(item.logoPath);if(!item.bannerUrl)item.bannerUrl=await resolveMedia(item.bannerPath);}
      const score=i=>{const text=String(i.interestText||'').toLowerCase();return interests.reduce((n,t)=>n+(text.includes(t)?1:0),0)};
      items.sort((a,b)=>score(b)-score(a)||new Date(b.created||0)-new Date(a.created||0));
      const firstSchool=items.find(x=>x.kind==='School / Institute');const chosen=firstSchool?[firstSchool,...items.filter(x=>!(x.kind==='School / Institute'&&String(x.applicationId)===String(firstSchool.applicationId)))].slice(0,6):items.slice(0,6);opportunities=chosen;scheduleInject();
    } catch(e){console.warn('Learning opportunities could not load:',e)}
  }
  function cardHTML(i){
    const isSchool=i.kind==='School / Institute';
    const media=isSchool
      ? `<div class="learning-school-media" style="display:flex;align-items:center;gap:12px;margin:0 0 12px;min-width:0">${i.logoUrl?`<img src="${esc(i.logoUrl)}" alt="${esc(i.host||i.title)} logo" loading="lazy" style="width:76px;height:76px;flex:0 0 76px;object-fit:contain;border-radius:14px;background:#fff;border:1px solid #eee5fb;padding:5px" onerror="this.remove()">`:''}${i.bannerUrl?`<img src="${esc(i.bannerUrl)}" alt="${esc(i.title)} banner" loading="lazy" style="display:block;width:calc(100% - 88px);height:100px;min-width:0;flex:1;object-fit:cover;border-radius:12px" onerror="this.remove()">`:`<div aria-label="No school banner uploaded" style="display:flex;align-items:center;justify-content:center;flex:1;min-width:0;height:100px;border-radius:12px;background:linear-gradient(135deg,#f1e8ff,#ddd0ff);color:#5e35b1;font-weight:700;text-align:center;padding:8px">SCHOOL / INSTITUTE</div>`}</div>`
      : `${i.bannerUrl?`<img src="${esc(i.bannerUrl)}" alt="${esc(i.title)} banner" loading="lazy" style="width:100%;height:150px;object-fit:cover;border-radius:12px;margin-bottom:10px" onerror="this.remove()">`:''}${i.logoUrl?`<img src="${esc(i.logoUrl)}" alt="${esc(i.host||i.title)} logo" loading="lazy" style="width:54px;height:54px;object-fit:contain;border-radius:12px;background:#fff;margin-bottom:8px" onerror="this.remove()">`:''}`;
    return `<article class="learning-feed-card" data-learning-feed-card="1">${media}<span class="learning-feed-kicker">${esc(i.kind)}</span><h3 class="learning-title-with-badge">${esc(i.title)} ${i.verifiedOrganization?'<span class="joint-verified-badge" title="Approved organization" aria-label="Verified organization">✓ Verified</span>':''}</h3><p>${esc(i.description||'Explore this learning opportunity on JOINT.')}</p><div class="learning-feed-meta">${esc(i.host||'JOINT')}${i.category?' · '+esc(i.category):''}${i.location?' · '+esc(i.location):''}</div><div class="learning-feed-actions"><strong>${esc(money(i.price,i.currency))}</strong><a href="${esc(i.href)}">Explore ${isSchool?'school':i.kind==='Class'?'class':'course'} →</a></div></article>`;
  }
  function scheduleInject(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;inject()})}
  function inject(){const feed=document.getElementById('feed');if(!feed||!opportunities.length)return;feed.querySelectorAll('[data-learning-feed-card]').forEach(n=>n.remove());const posts=[...feed.children].filter(n=>n.matches('.post'));if(!posts.length){opportunities.slice(0,2).forEach(item=>{const card=document.createElement('div');card.innerHTML=cardHTML(item);feed.appendChild(card.firstElementChild)});return}const positions=posts.length>=6?[2,5]:posts.length>=3?[2]:[posts.length-1];let offset=0;positions.forEach((pos,idx)=>{const item=opportunities[idx];if(!item)return;const card=document.createElement('div');card.innerHTML=cardHTML(item);const node=card.firstElementChild;const target=posts[Math.min(pos+offset,posts.length-1)];target.insertAdjacentElement('afterend',node);offset++})}
  function observe(){const feed=document.getElementById('feed');if(!feed)return;new MutationObserver(()=>scheduleInject()).observe(feed,{childList:true});scheduleInject()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{observe();load()});else{observe();load()}
})();
