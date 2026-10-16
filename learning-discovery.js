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
      const [profile, schools, courses, classes] = await Promise.all([
        db.from('joint_profiles').select('interests').eq('id',auth.user.id).maybeSingle(),
        db.from('joint_school_host_applications').select('id,school_name,category,description,country,state_region,city,status,submitted_at,application_data').eq('status','approved').limit(80),
        db.from('joint_courses').select('id,title,category,description,country,state,host_name,host_type,price,currency,status,published_at,content').eq('status','published').order('published_at',{ascending:false}).limit(80),
        db.from('joint_school_classes').select('id,application_id,title,class_type,description,price,is_active,created_at').eq('is_active',true).order('created_at',{ascending:false}).limit(100)
      ]);
      const interests=terms(profile.data?.interests), items=[];
      (schools.data||[]).filter(s=>s.application_data?.joint_school_is_published!==false).forEach(s=>items.push({kind:'School / Institute',title:s.school_name,description:s.description,category:s.category,location:[s.city,s.state_region,s.country].filter(Boolean).join(', '),host:s.school_name,price:0,interestText:[s.school_name,s.category,s.description,s.country,s.state_region,s.city].join(' '),href:'classes.html?school='+encodeURIComponent(s.school_name),created:s.submitted_at}));
      (courses.data||[]).forEach(c=>items.push({kind:c.host_type==='school'?'School course':'Course',title:c.title,description:c.description,category:c.category,location:[c.state,c.country].filter(Boolean).join(', '),host:c.host_name||'JOINT',price:Number(c.price)||0,currency:c.currency||'NGN',interestText:[c.title,c.category,c.description,c.host_name,c.country,c.state,JSON.stringify(c.content?.course?.subjects||[])].join(' '),href:'classes.html?q='+encodeURIComponent(c.title),created:c.published_at}));
      const appIds=[...new Set((classes.data||[]).map(c=>c.application_id).filter(Boolean))];let appMap=new Map();
      if(appIds.length){const ar=await db.from('joint_school_host_applications').select('id,school_name,category,country,state_region,city,status,description,application_data').in('id',appIds).eq('status','approved');if(!ar.error)appMap=new Map((ar.data||[]).filter(a=>a.application_data?.joint_school_is_published!==false).map(a=>[a.id,a]));}
      (classes.data||[]).filter(c=>appMap.has(c.application_id)).forEach(c=>{const a=appMap.get(c.application_id);items.push({kind:'Class',title:c.title,description:c.description,category:c.class_type||a.category,location:[a.city,a.state_region,a.country].filter(Boolean).join(', '),host:a.school_name,price:Number(c.price)||0,currency:'NGN',interestText:[c.title,c.class_type,c.description,a.school_name,a.category,a.country,a.state_region].join(' '),href:'class-details.html?class='+encodeURIComponent(c.id)+'&application='+encodeURIComponent(c.application_id),created:c.created_at});});
      const score=i=>{const text=i.interestText.toLowerCase();return interests.reduce((n,t)=>n+(text.includes(t)?1:0),0)};
      items.sort((a,b)=>score(b)-score(a)||new Date(b.created||0)-new Date(a.created||0));
      opportunities=items.slice(0,6);scheduleInject();
    } catch(e){console.warn('Learning opportunities could not load:',e)}
  }
  function cardHTML(i){return `<article class="learning-feed-card" data-learning-feed-card="1"><span class="learning-feed-kicker">${esc(i.kind)}</span><h3>${esc(i.title)}</h3><p>${esc(i.description||'Explore this learning opportunity on JOINT.')}</p><div class="learning-feed-meta">${esc(i.host||'JOINT')}${i.category?' · '+esc(i.category):''}${i.location?' · '+esc(i.location):''}</div><div class="learning-feed-actions"><strong>${esc(money(i.price,i.currency))}</strong><a href="${esc(i.href)}">Explore ${i.kind==='School / Institute'?'school':i.kind==='Class'?'class':'course'} →</a></div></article>`}
  function scheduleInject(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;inject()})}
  function inject(){const feed=document.getElementById('feed');if(!feed||!opportunities.length)return;feed.querySelectorAll('[data-learning-feed-card]').forEach(n=>n.remove());const posts=[...feed.children].filter(n=>n.matches('.post'));if(!posts.length)return;const positions=posts.length>=6?[2,5]:posts.length>=3?[2]:[posts.length-1];let offset=0;positions.forEach((pos,idx)=>{const item=opportunities[idx];if(!item)return;const card=document.createElement('div');card.innerHTML=cardHTML(item);const node=card.firstElementChild;const target=posts[Math.min(pos+offset,posts.length-1)];target.insertAdjacentElement('afterend',node);offset++})}
  function observe(){const feed=document.getElementById('feed');if(!feed)return;new MutationObserver(()=>scheduleInject()).observe(feed,{childList:true});scheduleInject()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{observe();load()});else{observe();load()}
})();
