/* JOINT learning opportunities are inserted into the scrolling community feed as post-style cards. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const terms = value => String(value || '').split(/[,;|]/).map(x => x.trim().toLowerCase()).filter(Boolean);
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
        const normalized={...row,id,application_id:id,school_name:name,title:name,category:row.category||row.school_type||row.institute_type||'School / Institute',description:row.description||row.about||row.bio||'',country:row.country||'',state_region:row.state_region||row.state||row.region||'',city:row.city||'',logo_path:row.logo_path||row.logo_url||'',banner_path:row.banner_path||row.banner_url||'',__source:row.__source};
        if(!schoolMap.has(String(id))||row.__source==='public')schoolMap.set(String(id),normalized);
      }
      const schools=[...schoolMap.values()];
      const interests=terms(profile.data?.interests), items=[];
      schools.forEach(s=>items.push({kind:'School / Institute',title:s.school_name,description:s.description,category:s.category,location:[s.city,s.state_region,s.country].filter(Boolean).join(', '),host:s.school_name,logoPath:s.logo_path||'',bannerPath:s.banner_path||'',price:0,interestText:[s.school_name,s.category,s.description,s.country,s.state_region,s.city].join(' '),applicationId:s.id,href:'classes.html?schoolId='+encodeURIComponent(s.id),created:s.submitted_at||s.created_at||s.updated_at}));
      (courses.data||[]).forEach(c=>items.push({kind:c.host_type==='school'?'School course':'Course',title:c.title,description:c.description,category:c.category,location:[c.state,c.country].filter(Boolean).join(', '),host:c.host_name||'JOINT',logoPath:'',price:Number(c.price)||0,currency:c.currency||'NGN',bannerUrl:c.banner_url||c.content?.course?.banner_url||'',interestText:[c.title,c.category,c.description,c.host_name,c.country,c.state,JSON.stringify(c.content?.course?.subjects||[])].join(' '),courseId:c.id,applicationId:c.application_id,href:'classes.html?course='+encodeURIComponent(c.id),created:c.published_at||c.created_at}));
      const appMap=new Map(schools.map(a=>[String(a.id),a]));
      // If a published course/class references a school not in the first query,
      // fetch that exact public directory row so it can still be shown on Home.
      const referenced=[...new Set([...(classes.data||[]).map(c=>c.application_id),...(courses.data||[]).map(c=>c.application_id)].filter(Boolean).map(String))];
      const missing=referenced.filter(id=>!appMap.has(id));
      if(missing.length){
        try{const r=await db.from('joint_public_schools').select('*').in('id',missing);if(!r.error)(r.data||[]).forEach(row=>{const id=row.application_id||row.id,name=row.school_name||row.institute_name||row.organization_name||row.name||row.title;if(!id||!name)return;const meta=row.application_data||row.metadata||{};if(meta.joint_school_is_published===false||row.is_published===false||row.is_public===false||row.published===false||row.is_active===false)return;const n={...row,id,school_name:name,title:name,category:row.category||'School / Institute',description:row.description||'',country:row.country||'',state_region:row.state_region||row.state||'',city:row.city||'',logo_path:row.logo_path||row.logo_url||'',banner_path:row.banner_path||row.banner_url||''};appMap.set(String(id),n);if(!items.some(i=>i.kind==='School / Institute'&&String(i.applicationId)===String(id)))items.push({kind:'School / Institute',title:name,description:n.description,category:n.category,location:[n.city,n.state_region,n.country].filter(Boolean).join(', '),host:name,logoPath:n.logo_path,bannerPath:n.banner_path,price:0,interestText:[name,n.category,n.description,n.country,n.state_region,n.city].join(' '),applicationId:id,href:'classes.html?schoolId='+encodeURIComponent(id),created:n.created_at||n.updated_at});});}catch(e){console.warn('Could not load referenced public schools',e)}
      }
      (courses.data||[]).forEach(c=>{const a=appMap.get(String(c.application_id));if(!a)return;const item=items.find(x=>x.kind==='School course'||x.kind==='Course' ? x.courseId===c.id : false);if(item&&!item.logoPath)item.logoPath=a.logo_path||'';});
      (classes.data||[]).filter(c=>appMap.has(String(c.application_id))).forEach(c=>{const a=appMap.get(String(c.application_id));items.push({kind:'Class',title:c.title||c.name||'Class',description:c.description,category:c.class_type||a.category,location:[a.city,a.state_region,a.country].filter(Boolean).join(', '),host:a.school_name||a.title,logoPath:a.logo_path||'',bannerPath:a.banner_path||'',bannerUrl:c.banner_url||'',price:Number(c.price)||0,currency:c.currency||'NGN',interestText:[c.title,c.class_type,c.description,a.school_name,a.category,a.country,a.state_region].join(' '),classId:c.id,applicationId:c.application_id,href:'classes.html?class='+encodeURIComponent(c.id)+'&schoolId='+encodeURIComponent(c.application_id),created:c.created_at});});
      for(const item of items){if(item.logoPath){if(/^https?:\/\//i.test(item.logoPath))item.logoUrl=item.logoPath;else try{const r=await db.storage.from('joint-host-verification').createSignedUrl(item.logoPath,3600);if(!r.error)item.logoUrl=r.data?.signedUrl||''}catch(_){}}if(!item.bannerUrl&&item.bannerPath){if(/^https?:\/\//i.test(item.bannerPath))item.bannerUrl=item.bannerPath;else try{const r=await db.storage.from('joint-host-verification').createSignedUrl(item.bannerPath,3600);if(!r.error)item.bannerUrl=r.data?.signedUrl||''}catch(_){}}}
      const score=i=>{const text=String(i.interestText||'').toLowerCase();return interests.reduce((n,t)=>n+(text.includes(t)?1:0),0)};
      items.sort((a,b)=>score(b)-score(a)||new Date(b.created||0)-new Date(a.created||0));
      const firstSchool=items.find(x=>x.kind==='School / Institute');const chosen=firstSchool?[firstSchool,...items.filter(x=>!(x.kind==='School / Institute'&&String(x.applicationId)===String(firstSchool.applicationId)))].slice(0,6):items.slice(0,6);opportunities=chosen;scheduleInject();
    } catch(e){console.warn('Learning opportunities could not load:',e)}
  }
  function cardHTML(i){return `<article class="learning-feed-card" data-learning-feed-card="1">${i.bannerUrl?`<img src="${esc(i.bannerUrl)}" alt="${esc(i.title)} banner" loading="lazy" style="width:100%;height:150px;object-fit:cover;border-radius:12px;margin-bottom:10px" onerror="this.remove()">`:""}${i.logoUrl?`<img src="${esc(i.logoUrl)}" alt="${esc(i.host||i.title)} logo" loading="lazy" style="width:54px;height:54px;object-fit:contain;border-radius:12px;background:#fff;margin-bottom:8px" onerror="this.remove()">`:""}<span class="learning-feed-kicker">${esc(i.kind)}</span><h3>${esc(i.title)}</h3><p>${esc(i.description||'Explore this learning opportunity on JOINT.')}</p><div class="learning-feed-meta">${esc(i.host||'JOINT')}${i.category?' · '+esc(i.category):''}${i.location?' · '+esc(i.location):''}</div><div class="learning-feed-actions"><strong>${esc(money(i.price,i.currency))}</strong><a href="${esc(i.href)}">Explore ${i.kind==='School / Institute'?'school':i.kind==='Class'?'class':'course'} →</a></div></article>`}
  function scheduleInject(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;inject()})}
  function inject(){const feed=document.getElementById('feed');if(!feed||!opportunities.length)return;feed.querySelectorAll('[data-learning-feed-card]').forEach(n=>n.remove());const posts=[...feed.children].filter(n=>n.matches('.post'));if(!posts.length){opportunities.slice(0,2).forEach(item=>{const card=document.createElement('div');card.innerHTML=cardHTML(item);feed.appendChild(card.firstElementChild)});return}const positions=posts.length>=6?[2,5]:posts.length>=3?[2]:[posts.length-1];let offset=0;positions.forEach((pos,idx)=>{const item=opportunities[idx];if(!item)return;const card=document.createElement('div');card.innerHTML=cardHTML(item);const node=card.firstElementChild;const target=posts[Math.min(pos+offset,posts.length-1)];target.insertAdjacentElement('afterend',node);offset++})}
  function observe(){const feed=document.getElementById('feed');if(!feed)return;new MutationObserver(()=>scheduleInject()).observe(feed,{childList:true});scheduleInject()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{observe();load()});else{observe();load()}
})();
