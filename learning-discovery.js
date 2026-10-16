/* JOINT learning discovery cards for Home and Classes. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const terms = value => String(value || '').split(/[,;|]/).map(x => x.trim().toLowerCase()).filter(Boolean);
  async function init() {
    const root = document.getElementById('learning-discovery');
    if (!root || !window.jointSupabaseConnection) return;
    try {
      const db = await window.jointSupabaseConnection;
      const { data: auth } = await db.auth.getUser();
      if (!auth?.user) { root.innerHTML = '<p class="learning-discovery-empty">Sign in to discover schools, courses and classes selected for you.</p>'; return; }
      const [profile, schools, courses, classes] = await Promise.all([
        db.from('joint_profiles').select('interests').eq('id', auth.user.id).maybeSingle(),
        db.from('joint_school_host_applications').select('id,school_name,category,description,country,state_region,city,logo_path,status,submitted_at').eq('status','approved').limit(80),
        db.from('joint_courses').select('id,title,category,description,country,state,host_name,host_type,price,currency,status,published_at,content').eq('status','published').order('published_at',{ascending:false}).limit(80),
        db.from('joint_school_classes').select('id,application_id,title,class_type,description,price,is_active,created_at').eq('is_active',true).order('created_at',{ascending:false}).limit(100)
      ]);
      const interests = terms(profile.data?.interests);
      const items = [];
      (schools.data || []).forEach(s => items.push({kind:'School / Institute',title:s.school_name,category:s.category,description:s.description,location:[s.city,s.state_region,s.country].filter(Boolean).join(', '),host:s.school_name,price:0,interestText:[s.school_name,s.category,s.description,s.country,s.state_region].join(' '),href:'classes.html?school='+encodeURIComponent(s.school_name),created:s.submitted_at}));
      (courses.data || []).forEach(c => items.push({kind:c.host_type==='school'?'School course':'Course',title:c.title,category:c.category,description:c.description,location:[c.state,c.country].filter(Boolean).join(', '),host:c.host_name,price:Number(c.price)||0,currency:c.currency||'NGN',interestText:[c.title,c.category,c.description,c.host_name,c.country,c.state,JSON.stringify(c.content?.course?.subjects||[])].join(' '),href:'classes.html?q='+encodeURIComponent(c.title),created:c.published_at}));
      const appIds = [...new Set((classes.data||[]).map(c=>c.application_id).filter(Boolean))];
      let appMap = new Map();
      if(appIds.length){const ar=await db.from('joint_school_host_applications').select('id,school_name,category,country,state_region,city,status,description').in('id',appIds).eq('status','approved');if(!ar.error)appMap=new Map((ar.data||[]).map(a=>[a.id,a]));}
      (classes.data||[]).filter(c=>appMap.has(c.application_id)).forEach(c=>{const a=appMap.get(c.application_id);items.push({kind:'Class',title:c.title,category:c.class_type||a.category,description:c.description,location:[a.city,a.state_region,a.country].filter(Boolean).join(', '),host:a.school_name,price:Number(c.price)||0,currency:'NGN',interestText:[c.title,c.class_type,c.description,a.school_name,a.category,a.country,a.state_region].join(' '),href:'classes.html?q='+encodeURIComponent(c.title),created:c.created_at});});
      const score = item => {const t=item.interestText.toLowerCase();return interests.reduce((n,term)=>n+(t.includes(term)?1:0),0)};
      items.sort((a,b)=>score(b)-score(a)||new Date(b.created||0)-new Date(a.created||0));
      const selected = items.slice(0,6);
      root.innerHTML = `<div class="learning-discovery-head"><div><h2>Learning picked for you</h2><p>Schools, courses and classes based on your interests.</p></div><a href="classes.html">Explore all</a></div>` +
        (selected.length ? `<div class="learning-discovery-grid">${selected.map(i=>`<article class="learning-discovery-card"><span class="learning-discovery-tag">${esc(i.kind)}</span><h3>${esc(i.title)}</h3><p>${esc(i.description||'Discover learning opportunities on JOINT.')}</p><div class="learning-discovery-meta">${esc(i.host||'JOINT')} ${i.location?'· '+esc(i.location):''}</div><div class="learning-discovery-bottom"><strong>${i.price>0?'Paid · '+esc(new Intl.NumberFormat(undefined,{style:'currency',currency:i.currency||'NGN'}).format(i.price)):'Free to explore'}</strong><a href="${i.href}">View details →</a></div></article>`).join('')}</div>` : '<p class="learning-discovery-empty">No published learning opportunities are available yet. Check back as schools and teachers publish their offerings.</p>');
    } catch (e) {
      console.warn('Learning discovery could not load:', e);
      root.innerHTML = '<p class="learning-discovery-empty">Learning recommendations could not load right now. You can still search all schools, courses and classes.</p>';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
