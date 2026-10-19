(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function getClient(){if(window.jointSupabaseConnection)return await window.jointSupabaseConnection;return await new Promise((resolve,reject)=>{let done=false;const finish=(fn,v)=>{if(done)return;done=true;clearInterval(check);clearTimeout(timeout);fn(v)};const check=setInterval(()=>{if(window.jointSupabaseConnection)finish(resolve,window.jointSupabaseConnection)},50);const timeout=setTimeout(()=>finish(reject,new Error('Supabase did not initialize. Check supabase.js.')),12000)})}
async function init(){
 try{
  const db=await getClient();const {data:auth,error:ae}=await db.auth.getUser();if(ae)throw ae;if(!auth.user){location.href='auth.html?next='+encodeURIComponent(location.pathname.split('/').pop()+location.search);return}
  if($('course-results'))await classes(db,auth.user.id);if($('my-course-list'))await learning(db,auth.user.id);
 }catch(e){console.error(e);const target=$('course-empty')||$('learning-error');if(target){target.hidden=false;target.textContent='Could not connect to Classes: '+(e.message||'Check your connection and Supabase setup.')}}
}
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n}
function ensureDetailModal() {
  let modal = $('learning-detail-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'learning-detail-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'learning-detail-title');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(24,18,38,.62);padding:8px;overflow:auto;display:none;align-items:flex-start;justify-content:center';
  modal.innerHTML = '<section style="position:relative;background:#fff;color:#211b2b;border-radius:20px;padding:clamp(12px,2.5vw,28px);width:min(100%,1180px);max-width:100%;max-height:98vh;overflow:auto;box-shadow:0 20px 70px rgba(0,0,0,.25)"><button type="button" id="learning-detail-close" aria-label="Close details" style="float:right;border:0;border-radius:10px;padding:8px 12px;background:#f0e8ff;color:#5424b5;font-size:1.1rem">✕</button><div id="learning-detail-content"></div></section>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function (event) { if (event.target === modal) closeDetail(); });
  modal.querySelector('#learning-detail-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeDetail(); });
  return modal;
}
function closeDetail() {
  const modal = $('learning-detail-modal');
  if (modal) { modal.hidden = true; modal.style.display = 'none'; }
}
function youtubeEmbed(value){try{const u=new URL(String(value||''));let id='';if(u.hostname==='youtu.be')id=u.pathname.split('/').filter(Boolean)[0]||'';else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname)){if(u.pathname==='/watch')id=u.searchParams.get('v')||'';else if(/^\/(embed|shorts|live)\//.test(u.pathname))id=u.pathname.split('/')[2]||'';}return /^[A-Za-z0-9_-]{11}$/.test(id)?'https://www.youtube.com/embed/'+id+'?rel=0&playsinline=1':'';}catch(e){return '';}}
function lessonWindowState(lesson){const now=Date.now();const start=lesson.releaseAt?new Date(lesson.releaseAt).getTime():0;const end=lesson.availableUntil?new Date(lesson.availableUntil).getTime():Infinity;if(start&&now<start)return {open:false,message:'This lesson opens '+new Date(start).toLocaleString()+'.'};if(end!==Infinity&&now>end)return {open:false,message:'This lesson closed '+new Date(end).toLocaleString()+'. Contact your teacher if you need access.'};return {open:true,message:''};}
function openDetail(item, db, uid, enroll, saved, refresh) {
  const modal = ensureDetailModal();
  const box = $('learning-detail-content');
  box.replaceChildren();
  const title = node('h2', item.title || 'Learning opportunity');
  title.id = 'learning-detail-title';
  title.style.cssText = 'font-size:clamp(1.4rem,5vw,2rem);margin:8px 42px 12px 0';
  box.append(title);
  if(item.verified_organization){const badge=node('span','✓ Verified organization','joint-verified-badge');badge.setAttribute('aria-label','Approved organization');badge.style.cssText='display:inline-flex;align-items:center;white-space:nowrap;margin:0 0 10px;padding:5px 9px;border-radius:999px;background:#e8f7ee;color:#137a3f;font-size:12px;font-weight:800;border:1px solid #bce7cb';box.append(badge)}
  const bannerUrl = item.banner_url || item.banner_display_url || '';
  if (item.school_entity && (item.logo_display_url || bannerUrl)) {
    const media = node('div');
    media.style.cssText = 'display:flex;align-items:center;gap:12px;margin:8px 0 14px;min-width:0';
    if (item.logo_display_url) {
      const logo = node('img'); logo.src = item.logo_display_url; logo.alt = (item.host_name || item.title || 'School') + ' logo';
      logo.style.cssText = 'width:78px;height:78px;flex:0 0 78px;object-fit:contain;border-radius:14px;background:#fff;border:1px solid #eee5fb;padding:5px';
      logo.onerror = function () { logo.remove(); }; media.append(logo);
    }
    if (bannerUrl) {
      const img = node('img'); img.src = bannerUrl; img.alt = (item.title || '') + ' banner';
      img.style.cssText = 'width:calc(100% - 90px);height:110px;min-width:0;flex:1;object-fit:cover;border-radius:13px';
      img.onerror = function () { img.remove(); }; media.append(img);
    }
    box.append(media);
  } else if (bannerUrl) {
    const img = node('img');
    img.src = bannerUrl; img.alt = (item.title || '') + ' banner';
    img.style.cssText = 'width:100%;max-height:260px;object-fit:cover;border-radius:13px;margin-bottom:12px';
    img.onerror = function () { img.remove(); };
    box.append(img);
  }
  box.append(node('span', item.school_entity ? 'School / Institute' : (item.class_entity ? 'School class' : (item.category || 'Course')), 'course-badge'));
  if (item.description) box.append(node('p', item.description));
  box.append(node('p', [item.host_name, item.city, item.state, item.country].filter(Boolean).join(' · '), 'course-meta'));

  if (item.school_entity) {
    const list = node('div');
    const related = (window.__jointLearningItems || []).filter(function (entry) { return entry.application_id === item.application_id && !entry.school_entity; });
    list.append(node('h3', 'Available classes and courses'));
    if (!related.length) list.append(node('p', 'No published classes or courses are currently listed for this school.'));
    related.forEach(function (entry) {
      const row = node('article', undefined, 'course-card');
      row.style.margin = '10px 0';
      row.append(node('h4', entry.title));
      row.append(node('p', entry.description || ''));
      row.append(node('p', Number(entry.price) > 0 ? 'Paid · ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: entry.currency || 'NGN' }).format(entry.price) : 'Free to join', 'course-meta'));
      const button = node('button', 'View details', 'btn');
      button.type = 'button';
      button.onclick = function () { openDetail(entry, db, uid, enroll, saved, refresh); };
      row.append(button); list.append(row);
    });
    box.append(list);
    const schoolLink = node('a', 'Browse this school in Classes', 'btn secondary');
    schoolLink.href = 'classes.html?schoolId=' + encodeURIComponent(item.application_id);
    schoolLink.style.marginTop = '12px'; box.append(schoolLink);
  } else if (item.class_entity) {
    box.append(node('p', Number(item.price) > 0 ? 'Access price: ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency || 'NGN' }).format(item.price) : 'Free to join', 'course-price'));
    box.append(node('p', 'This class is provided by ' + (item.host_name || 'the school') + '. Open the school page to see other published learning opportunities.'));
    const schoolLink = node('a', 'View school & available courses', 'btn');
    schoolLink.href = 'classes.html?schoolId=' + encodeURIComponent(item.application_id || '');
    schoolLink.style.marginTop = '12px'; box.append(schoolLink);
  } else {
    box.append(node('p', Number(item.price) > 0 ? 'Price: ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency || 'NGN' }).format(item.price) : 'Free to join', 'course-price'));
    const content = item.content || {};
    const course = content.course || {};
    const modules = content.modules || course.modules || [];
    const subjects = course.subjects || [];
    if (subjects.length) {
      box.append(node('h3', 'Subjects'));
      const ul = node('ul');
      subjects.slice(0, 1).forEach(function (subject) {
        const label = typeof subject === 'string' ? subject : (subject.title || subject.name || JSON.stringify(subject));
        ul.append(node('li', label));
      });
      box.append(ul);
    }
    if (modules.length) {
      const learningSection = node('section');
      learningSection.id = 'joint-course-learning-content';
      learningSection.style.cssText = 'margin:18px 0 0;scroll-margin-top:18px;width:100%;max-width:100%;min-width:0;font-size:1.08rem;font-weight:600;line-height:1.75';
      learningSection.append(node('h3', 'Course outline'));
      modules.forEach(function (module, index) {
        const section = node('section');
        section.style.cssText = 'box-sizing:border-box;width:100%;max-width:100%;min-width:0;padding:clamp(12px,2.5vw,24px);margin:12px 0;background:#faf7ff;border:1px solid #eee5fb;border-radius:14px';
        section.append(node('h4', module.title || module.name || ('Module ' + (index + 1))));
        if (module.description) section.append(node('p', module.description));
        const lessons = Array.isArray(module.lessons) ? module.lessons : [];
        if (!lessons.length) section.append(node('p', 'Lessons will appear here when added by the host.', 'course-meta'));
        lessons.forEach(function (lesson, lessonIndex) {
          const lessonCard = node('article');
          lessonCard.style.cssText = 'box-sizing:border-box;width:100%;max-width:100%;min-width:0;padding:clamp(12px,2.5vw,24px);margin:12px 0;background:#fff;border:1px solid #e9e2f2;border-radius:14px;font-size:clamp(1.05rem,2.8vw,1.22rem);font-weight:600;line-height:1.8;overflow-wrap:anywhere';
          lessonCard.append(node('h5', (lessonIndex + 1) + '. ' + (lesson.title || lesson.name || 'Lesson')));
          const windowState = lessonWindowState(lesson);
          if (!windowState.open) { lessonCard.append(node('p', windowState.message, 'course-meta')); section.append(lessonCard); return; }
          if (lesson.content) { const intro=node('div'); intro.style.cssText='display:block;width:100%;max-width:100%;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;font-size:clamp(1.08rem,2.9vw,1.24rem);font-weight:600'; intro.textContent=lesson.content; lessonCard.append(intro); }
          (Array.isArray(lesson.contentBlocks) ? lesson.contentBlocks : []).forEach(function (block) {
            if (block.text) lessonCard.append(node('p', block.text));
            if (!block.url) return;
            if (block.type === 'image' || block.type === 'image-upload') {
              const image = node('img'); image.src = block.url; image.alt = lesson.title || 'Lesson image';
              image.loading = 'lazy'; image.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;max-height:none;object-fit:contain;border-radius:12px;margin:14px 0';
              image.onerror = function () { image.replaceWith(node('p', 'This lesson image could not be loaded.', 'course-meta')); };
              lessonCard.append(image);
            } else if (block.type === 'video-upload') {
              const video = node('video'); video.controls = true; video.preload = 'metadata'; video.src = block.url;
              video.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;max-height:none;aspect-ratio:16/9;object-fit:contain;background:#111;border-radius:12px;margin:14px 0';
              lessonCard.append(video);
            } else if (block.type === 'embed' && typeof youtubeEmbed === 'function' && youtubeEmbed(block.url)) {
              const frame = node('iframe'); frame.src = youtubeEmbed(block.url); frame.title = lesson.title || 'Lesson video';
              frame.loading = 'lazy'; frame.referrerPolicy='strict-origin-when-cross-origin'; frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true;
              frame.style.cssText = 'display:block;width:100%;max-width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin:14px 0'; lessonCard.append(frame);
            } else if (block.type === 'video' || block.type === 'video-upload') {
              const video = node('video'); video.controls = true; video.preload = 'metadata'; video.src = block.url;
              video.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;max-height:none;aspect-ratio:16/9;object-fit:contain;background:#111;border-radius:12px;margin:14px 0'; lessonCard.append(video);
            } else {
              const link = node('a', block.type === 'file-upload' ? ('Open document: ' + (block.fileName || 'lesson file')) : 'Open learning resource');
              link.href = block.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
              link.style.cssText = 'display:inline-block;margin:6px 0;overflow-wrap:anywhere'; lessonCard.append(link);
            }
          });
          if (lesson.video) {
            const embedUrl = typeof youtubeEmbed === 'function' ? youtubeEmbed(lesson.video) : '';
            if (embedUrl) { const frame = node('iframe'); frame.src = embedUrl; frame.title = lesson.title || 'Lesson video'; frame.loading = 'lazy'; frame.referrerPolicy='strict-origin-when-cross-origin'; frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true; frame.style.cssText = 'display:block;width:100%;max-width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin:14px 0'; lessonCard.append(frame); }
            else { const link = node('a', 'Open lesson video'); link.href = lesson.video; link.target = '_blank'; link.rel = 'noopener noreferrer'; lessonCard.append(link); }
          }
          if (lesson.resource) { const link = node('a', 'Open learning material'); link.href = lesson.resource; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.cssText = 'display:inline-block;margin:6px 0'; lessonCard.append(link); }
          section.append(lessonCard);
        });
        learningSection.append(section);
      });
      box.append(learningSection);
      // Assignment submission panel: students can type an answer or upload work.
      const submissionPanel=node('section'); submissionPanel.id='joint-assignment-submissions';
      submissionPanel.style.cssText='margin-top:20px;padding:14px;border:1px solid #dfd2f5;border-radius:14px;background:#fff';
      submissionPanel.append(node('h3','＋ Assignments & submissions'));
      const assignmentItems=[];
      (Array.isArray(content.assignments)?content.assignments:[]).forEach(function(a){assignmentItems.push({...a,_lessonId:null,_source:'course'});});
      modules.forEach(function(mod){(mod.lessons||[]).forEach(function(lesson){const hs=lesson.humanSettings||{};(Array.isArray(hs.assignments)?hs.assignments:[]).forEach(function(a){assignmentItems.push({...a,_lessonId:lesson.id,_lesson:lesson,_source:'lesson'});});});});
      if(!assignmentItems.length)submissionPanel.append(node('p','Your teacher has not added any assignments yet.','course-meta'));
      assignmentItems.forEach(function(a,index){
        const card=node('article');card.style.cssText='padding:12px;margin:10px 0;border:1px solid #e9e2f2;border-radius:12px;background:#fcfaff';
        card.append(node('h4',a.title||('Assignment '+(index+1))));if(a.instructions)card.append(node('p',a.instructions));
        const start=a.opensAt?new Date(a.opensAt).getTime():0;const end=(a.deadline||a.closesAt)?new Date(a.deadline||a.closesAt).getTime():Infinity;const now=Date.now();
        if(start&&now<start){card.append(node('p','This assignment opens '+new Date(start).toLocaleString()+'.','course-meta'));submissionPanel.append(card);return;}
        if(end!==Infinity&&now>end){card.append(node('p','The submission deadline has passed ('+new Date(end).toLocaleString()+').','course-meta'));submissionPanel.append(card);return;}
        const answer=document.createElement('textarea');answer.maxLength=12000;answer.placeholder='Write your answer or submission notes (optional)';answer.setAttribute('aria-label','Answer for '+(a.title||'assignment'));answer.style.cssText='display:block;width:100%;min-height:90px;padding:10px;border:1px solid #dcd3eb;border-radius:10px;font:inherit;margin:8px 0';card.append(answer);
        const file=document.createElement('input');file.type='file';file.accept='image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv';file.style.cssText='display:block;width:100%;padding:10px;margin:8px 0';file.setAttribute('aria-label','Upload assignment file');card.append(file);
        const status=node('p','');status.className='course-meta';card.append(status);
        const submit=node('button','＋ Submit assignment','btn');submit.type='button';submit.style.cssText='width:100%;margin-top:8px';
        submit.addEventListener('click',async function(){
          submit.disabled=true;status.textContent='Submitting…';
          try{
            let fileUrl=null,fileName=null;
            const picked=file.files&&file.files[0];
            if(picked){if(picked.size>50*1024*1024)throw new Error('Please choose a file smaller than 50 MB.');if(/\.(zip|rar|7z)$/i.test(picked.name)||picked.type==='application/zip')throw new Error('ZIP archives are not accepted. Upload your actual work file instead.');const key=uid+'/assignment-submissions/'+item.id+'/'+(a.id||('assignment-'+index))+'/'+Date.now()+'-'+picked.name.replace(/[^a-zA-Z0-9._-]/g,'_');const uploaded=await db.storage.from('joint-learning-media').upload(key,picked,{upsert:false,contentType:picked.type||'application/octet-stream'});if(uploaded.error)throw uploaded.error;fileUrl=db.storage.from('joint-learning-media').getPublicUrl(key).data.publicUrl;fileName=picked.name;}
            if(!answer.value.trim()&&!picked)throw new Error('Write an answer or choose a file before submitting.');
            const result=await db.from('joint_course_assignment_submissions').insert({course_id:item.id,lesson_id:a._lessonId,assignment_id:String(a.id||('assignment-'+index)),student_id:uid,submission_text:answer.value.trim()||null,file_url:fileUrl,file_name:fileName,submitted_at:new Date().toISOString()});
            if(result.error)throw result.error;status.textContent='Assignment submitted successfully. Your teacher can review it.';submit.textContent='✓ Submitted';file.disabled=true;answer.disabled=true;
          }catch(err){console.error(err);status.textContent='Could not submit: '+(err.message||'Please try again. If this mentions joint_course_assignment_submissions, apply the included SQL setup file in Supabase first.');submit.disabled=false;}
        });card.append(submit);submissionPanel.append(card);
      });
      box.append(submissionPanel);
    } else if (!subjects.length) {
      box.append(node('p', 'Course details are available from the host. The course outline will appear here when the host publishes lessons.', 'course-meta'));
    }
    const alreadyEnrolled = enroll.has(item.id) && enroll.get(item.id) !== 'pending_payment';
    const actionLabel = alreadyEnrolled ? 'Open learning' : (Number(item.price) > 0 ? 'Enrol in course' : 'Join free course');
    const action = node('button', actionLabel, 'btn');
    action.type = 'button'; action.style.cssText = 'width:100%;margin-top:14px';
    if (alreadyEnrolled) action.style.background = '#6938d1';
    if (enroll.has(item.id) && !alreadyEnrolled) { action.textContent = 'Payment required before course access'; action.disabled = true; action.style.opacity = '.8'; }
    action.onclick = async function () {
      if (alreadyEnrolled) {
        const learningContent = box.querySelector('#joint-course-learning-content');
        if (learningContent) learningContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        return;
      }
      action.disabled = true;
      try {
        const result = await db.from('joint_course_enrollments').insert({ user_id: uid, course_id: item.id, status: Number(item.price) > 0 ? 'pending_payment' : 'joined' });
        if (result.error) throw result.error;
        enroll.set(item.id, Number(item.price) > 0 ? 'pending_payment' : 'joined');
        alert(Number(item.price) > 0 ? 'Your enrolment is pending payment. No payment has been charged.' : 'You joined this course.');
        closeDetail(); refresh();
      } catch (error) { alert('Could not enrol: ' + (error.message || String(error))); action.disabled = false; }
    };
    box.append(action);
  }
  modal.hidden = false; modal.style.display = 'flex';
}
function isApprovedOrganizationSchool(row){const meta=row?.application_data||row?.metadata||{};const owner=String(row?.owner_type||row?.host_type||row?.hosting_type||meta.owner_type||meta.host_type||'').trim().toLowerCase();const organization=['organization','organisation','org','institution','company'].includes(owner);const approved=String(row?.status||'').toLowerCase()==='approved'||row?.__source==='public';return organization&&approved&&row?.is_approved!==false&&row?.approved!==false;}
async function readPublicSchools(db) {
  const out=[];
  // The public directory is the intended source for schools visible to all members.
  try {
    const r=await db.from('joint_public_schools').select('*').limit(300);
    if(!r.error && Array.isArray(r.data)) out.push(...r.data.map(row=>({...row,__source:'public'})));
    else if(r.error) console.warn('Public school directory unavailable; trying approved host applications.',r.error.message);
  } catch(e) { console.warn('Public school directory unavailable.',e); }
  // Older deployments may still expose approved applications directly. Merge them
  // as a fallback without making the whole Classes page fail if RLS blocks this table.
  try {
    const r=await db.from('joint_school_host_applications').select('*').eq('status','approved').limit(300);
    if(!r.error && Array.isArray(r.data)) out.push(...r.data.map(row=>({...row,__source:'application'})));
    else if(r.error) console.warn('Approved school application fallback unavailable.',r.error.message);
  } catch(e) { console.warn('Approved school application fallback unavailable.',e); }
  const map=new Map();
  for(const row of out){
    const id=row.application_id||row.host_application_id||row.id;
    const title=row.school_name||row.institute_name||row.organization_name||row.name||row.title;
    if(!id||!title) continue;
    if(row.status && row.__source==='application' && row.status!=='approved') continue;
    const meta=row.application_data||row.metadata||{};
    if(meta.joint_school_is_published===false || row.is_published===false || row.is_public===false || row.published===false || row.is_active===false) continue;
    const previous=map.get(String(id))||{};
    const logoPath=row.logo_path||row.logo_url||row.school_logo_url||row.institute_logo_url||row.logo_storage_path||meta.logo_path||meta.logo_url||previous.logo_path||'';
    const bannerPath=row.banner_path||row.banner_url||row.banner_image_url||row.school_banner_url||row.institute_banner_url||row.cover_image_url||row.cover_path||row.school_banner_path||row.institute_banner_path||meta.banner_path||meta.banner_url||meta.school_banner_url||meta.cover_image_url||meta.cover_path||previous.banner_path||'';
    const normalized={...previous,...row,id:String(id),application_id:String(id),school_name:title,title,category:row.category||row.school_type||row.institute_type||previous.category||'School / Institute',description:row.description||row.about||row.bio||previous.description||'',country:row.country||previous.country||'',state_region:row.state_region||row.state||row.region||previous.state_region||'',state:row.state||row.state_region||row.region||previous.state||'',city:row.city||previous.city||'',owner_type:row.owner_type||row.host_type||row.hosting_type||meta.owner_type||meta.host_type||previous.owner_type||'',logo_path:logoPath,banner_path:bannerPath,host_name:title,__source:row.__source||previous.__source}; normalized.verified_organization=isApprovedOrganizationSchool(normalized);
    // Merge the public directory and approved application records: the public row may omit uploaded media paths.
    map.set(String(id),normalized);
  }
  const schools=[...map.values()];
  // Resolve verification separately from the public directory row. That view may omit
  // owner_type, and RLS may prevent non-owners from reading host application records.
  try {
    const ids=schools.map(x=>String(x.id)).filter(Boolean);
    if(ids.length){
      const verification=await db.rpc('joint_get_public_school_verification',{p_application_ids:ids});
      if(!verification.error){
        const verified=new Map((verification.data||[]).map(x=>[String(x.application_id),x.verified_organization===true]));
        for(const school of schools) school.verified_organization=verified.get(String(school.id))===true;
      } else console.warn('Public school verification lookup unavailable; run joint-school-public-verification.sql:',verification.error.message);
    }
  } catch(e){console.warn('Public school verification lookup failed:',e)}
  // The public directory view may intentionally omit banner_path. Fetch only approved,
  // published schools' public media paths through the narrow SECURITY DEFINER RPC.
  try {
    const ids=schools.map(x=>x.id).filter(Boolean);
    if(ids.length){
      const media=await db.rpc('joint_get_public_school_assets',{p_application_ids:ids});
      if(!media.error) for(const asset of (media.data||[])){
        const target=map.get(String(asset.application_id));
        if(target){target.logo_path=target.logo_path||asset.logo_path||'';target.banner_path=target.banner_path||asset.banner_path||'';}
      }
      else console.warn('Public school banner paths unavailable; run joint-school-public-assets.sql:',media.error.message);
    }
  } catch(e){console.warn('Public school asset lookup failed:',e)}
  return schools;
}
async function classes(db,uid){
 let all=[],saved=new Set(),enroll=new Map(),view='discover';
 const {data:rows,error}=await db.from('joint_courses').select('id,application_id,owner_id,title,category,level,description,language,price,currency,country,state,host_name,host_type,status,content,published_at,created_at').eq('status','published').order('published_at',{ascending:false}).limit(300);
 if(error)throw error;
 const visibleSchools=await readPublicSchools(db);
 const appMap=new Map(visibleSchools.map(a=>[String(a.id),a]));
 const courseItems=(rows||[]).map(c=>{const school=appMap.get(String(c.application_id));return {...c,verified_organization:Boolean(school?.verified_organization),banner_url:c.banner_url||c.content?.course?.banner_url||'',logo_path:school?.logo_path||'',host_name:c.host_name||school?.school_name||'JOINT',created_at:c.published_at||c.created_at||''}});
 const schoolEntities=visibleSchools.map(a=>({id:'school-entity:'+a.id,school_entity:true,verified_organization:Boolean(a.verified_organization),application_id:a.id,title:a.school_name,category:a.category,description:a.description,price:0,currency:'NGN',country:a.country,state:a.state_region,city:a.city,host_name:a.school_name,host_type:'school',owner_id:a.owner_id||a.created_by||'',status:'published',created_at:a.submitted_at||a.updated_at||a.created_at||'',logo_path:a.logo_path||'',banner_path:a.banner_path||''}));
 let classEntities=[];
 try {
  const cr=await db.from('joint_school_classes').select('*').eq('is_active',true).order('created_at',{ascending:false}).limit(200);
  if(!cr.error) classEntities=(cr.data||[]).filter(c=>appMap.has(String(c.application_id))).map(c=>{const a=appMap.get(String(c.application_id));return {...c,id:'school-class:'+c.id,original_class_id:c.id,class_entity:true,verified_organization:Boolean(a.verified_organization),application_id:c.application_id,title:c.title||c.name||'Class',category:c.class_type||a.category||'Class',description:c.description||'',price:Number(c.price)||0,currency:c.currency||'NGN',country:c.country||a.country||'',state:c.state||a.state_region||'',city:c.city||a.city||'',host_name:a.school_name,host_type:'school',owner_id:a.owner_id||a.created_by||'',logo_path:a.logo_path||'',created_at:c.created_at||''}});
  else console.warn('School classes could not be loaded',cr.error.message);
 } catch(e){console.warn('School classes could not be loaded',e)}
 all=[...schoolEntities,...courseItems,...classEntities];window.__jointLearningItems=all;
 async function resolveSchoolMedia(value){if(!value)return '';const raw=String(value).trim();if(/^https?:\/\//i.test(raw)||raw.startsWith('data:'))return raw;const bucket='joint-host-verification';let path=raw.replace(/^\/+/, '').replace(/^storage\/v1\/object\/(?:public|sign)\//i,'');path=path.replace(/^joint-host-verification\//i,'');const candidates=[...new Set([path,decodeURIComponentSafe(path),raw.replace(/^\/+/, '')].filter(Boolean))];for(const candidate of candidates){try{const r=await db.storage.from(bucket).createSignedUrl(candidate,3600);if(!r.error&&r.data?.signedUrl)return r.data.signedUrl;}catch(_){}}for(const candidate of candidates){try{const r=db.storage.from(bucket).getPublicUrl(candidate);if(r.data?.publicUrl)return r.data.publicUrl;}catch(_){}}return '';}
 function decodeURIComponentSafe(value){try{return decodeURIComponent(value)}catch(_){return value}}
 for(const item of all){item.logo_display_url=await resolveSchoolMedia(item.logo_path);const directBanner=item.banner_url||item.banner_display_url||'';item.banner_display_url=directBanner&&/^https?:\/\//i.test(directBanner)?directBanner:await resolveSchoolMedia(directBanner||item.banner_path);if(item.school_entity&&item.banner_display_url)item.banner_url=item.banner_display_url;}
 const [s,e]=await Promise.all([db.from('joint_course_saves').select('course_id').eq('user_id',uid),db.from('joint_course_enrollments').select('course_id,status').eq('user_id',uid)]);if(s.error)throw s.error;if(e.error)throw e.error;saved=new Set((s.data||[]).map(x=>x.course_id));enroll=new Map((e.data||[]).map(x=>[x.course_id,x.status]));
 let interestTerms=[];const profileResult=await db.from('joint_profiles').select('interests').eq('id',uid).maybeSingle();if(!profileResult.error&&profileResult.data?.interests)interestTerms=String(profileResult.data.interests).split(/[,;|]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 const interestScore=c=>{const text=[c.title,c.description,c.category,c.host_name,c.country,c.state,...(((c.content||{}).course||{}).subjects||[])].join(' ').toLowerCase();return interestTerms.reduce((score,term)=>score+(text.includes(term)?1:0),0)};
 const filter=()=>{const q=$('class-search').value.trim().toLowerCase(),country=$('filter-country').value,state=$('filter-state').value.trim().toLowerCase();let list=all.filter(c=>[c.title,c.description,c.category,c.host_name,c.city,c.state,c.country,c.host_type,...(((c.content||{}).course||{}).subjects||[])].join(' ').toLowerCase().includes(q));if(country)list=list.filter(c=>c.country===country);if(state)list=list.filter(c=>(c.state||'').toLowerCase().includes(state));if(view==='saved')list=list.filter(c=>!c.school_entity&&!c.class_entity&&saved.has(c.id));if(view==='joined')list=list.filter(c=>!c.school_entity&&!c.class_entity&&['joined','enrolled','completed'].includes(enroll.get(c.id)));if(view==='enrolled')list=list.filter(c=>!c.school_entity&&!c.class_entity&&['pending_payment','enrolled','completed'].includes(enroll.get(c.id)));if(view==='host')list=list.filter(c=>!c.school_entity&&!c.class_entity&&c.owner_id===uid);if(view==='discover')list.sort((a,b)=>(a.school_entity===b.school_entity?interestScore(b)-interestScore(a):a.school_entity?-1:1)||new Date(b.created_at||0)-new Date(a.created_at||0));return list};
 async function render(){const box=$('course-results');box.replaceChildren();$('results-heading').textContent=({discover:'Available courses and schools',saved:'Your saved courses',enrolled:'Your paid course enrolments',joined:'Your joined courses',host:'Your published courses'})[view];const list=filter();$('saved-count').textContent=saved.size+' saved';$('enrolled-count').textContent=[...enroll.values()].filter(x=>['pending_payment','enrolled','completed'].includes(x)).length+' paid';$('joined-count').textContent=[...enroll.values()].filter(x=>['joined','enrolled','completed'].includes(x)).length+' joined';$('course-empty').hidden=!!list.length;$('course-empty').textContent=view==='host'?'You have no published courses yet.':'No courses or schools match your search.';document.querySelectorAll('.library-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===view));for(const c of list){const card=node('article',undefined,'course-card');card.dataset.learningEngagement='1';card.dataset.engagementType=c.school_entity?'school':(c.class_entity?'class':'course');card.dataset.engagementId=String(c.school_entity?c.application_id:(c.class_entity?(c.original_class_id||String(c.id).replace(/^school-class:/,'')):c.id));card.dataset.engagementOwner=String(c.owner_id||c.ownerId||'');const imageUrl=c.banner_url||c.banner_display_url||'';if(c.school_entity){const media=node('div',undefined,'school-brand-media');media.style.cssText='display:flex;align-items:center;gap:12px;width:100%;margin:0 0 12px;min-width:0';if(c.logo_display_url){const logo=node('img');logo.src=c.logo_display_url;logo.alt=(c.host_name||c.title||'School')+' logo';logo.loading='lazy';logo.style.cssText='width:76px;height:76px;flex:0 0 76px;object-fit:contain;border-radius:14px;background:#fff;border:1px solid #eee5fb;padding:5px';logo.onerror=()=>logo.remove();media.append(logo)}if(imageUrl){const banner=node('img');banner.src=imageUrl;banner.alt=(c.title||'School / institute')+' banner';banner.loading='lazy';banner.style.cssText='display:block;width:calc(100% - 88px);height:100px;min-width:0;flex:1;object-fit:cover;border-radius:12px';banner.onerror=()=>banner.remove();media.append(banner)}if(media.childElementCount)card.append(media)}else{if(imageUrl){const banner=node('img');banner.src=imageUrl;banner.alt=(c.title||'Learning opportunity')+' banner';banner.loading='lazy';banner.style.cssText='width:100%;height:150px;object-fit:cover;border-radius:11px;margin-bottom:5px';banner.onerror=()=>banner.remove();card.append(banner)}if(c.logo_display_url){const logo=node('img');logo.src=c.logo_display_url;logo.alt=(c.host_name||'School')+' logo';logo.loading='lazy';logo.style.cssText='width:56px;height:56px;object-fit:contain;border-radius:12px;background:#fff';logo.onerror=()=>logo.remove();card.append(logo)}}card.append(node('span',c.school_entity?'SCHOOL / INSTITUTE':c.class_entity?'SCHOOL CLASS':c.category||'COURSE','course-badge'));const title=node('h3',c.title);title.style.cssText='display:flex;align-items:center;flex-wrap:wrap;gap:7px';if(c.verified_organization){const badge=node('span','✓ Verified','joint-verified-badge');badge.title='Approved organization';badge.setAttribute('aria-label','Verified organization');badge.style.cssText='display:inline-flex;align-items:center;white-space:nowrap;padding:4px 8px;border-radius:999px;background:#e8f7ee;color:#137a3f;font-size:12px;font-weight:800;border:1px solid #bce7cb';title.append(badge)}card.append(title);card.append(node('p',c.description||''));card.append(node('p',(c.host_name||'JOINT host')+' · '+(c.country||'')+(c.state?', '+c.state:''),'course-meta'));if(c.school_entity||c.class_entity){card.append(node('p',[c.city,c.state,c.country].filter(Boolean).join(', '),'course-meta'));const actions=node('div',undefined,'course-buttons');const browse=node('button',c.school_entity?'Explore school / institute':'View class','btn');browse.type='button';browse.onclick=()=>openDetail(c,db,uid,enroll,saved,render);actions.append(browse);card.append(actions);box.append(card);continue}card.append(node('p',Number(c.price)>0?'Paid · '+new Intl.NumberFormat(undefined,{style:'currency',currency:c.currency||'NGN'}).format(c.price):'Free to join','course-price'));const actions=node('div',undefined,'course-buttons');const detail=node('button','View course','btn secondary');detail.type='button';detail.onclick=()=>openDetail(c,db,uid,enroll,saved,render);actions.append(detail);const sb=node('button',saved.has(c.id)?'★ Saved':'☆ Save','btn secondary');sb.type='button';sb.onclick=async()=>{sb.disabled=true;try{if(saved.has(c.id)){const r=await db.from('joint_course_saves').delete().eq('user_id',uid).eq('course_id',c.id);if(r.error)throw r.error;saved.delete(c.id)}else{const r=await db.from('joint_course_saves').insert({user_id:uid,course_id:c.id});if(r.error)throw r.error;saved.add(c.id)}render()}catch(err){alert('Could not update saved course: '+err.message);sb.disabled=false}};actions.append(sb);const status=enroll.get(c.id);const join=node('button',status?'Open learning':Number(c.price)>0?'Enrol':'Join free course','btn');join.type='button';join.onclick=async()=>{if(status){openDetail(c,db,uid,enroll,saved,render);return}try{const r=await db.from('joint_course_enrollments').insert({user_id:uid,course_id:c.id,status:Number(c.price)>0?'pending_payment':'joined'});if(r.error)throw r.error;if(Number(c.price)>0)alert('Your enrolment is pending payment. No payment has been charged.');else alert('You joined this course.');enroll.set(c.id,Number(c.price)>0?'pending_payment':'joined');render()}catch(err){alert('Could not enrol: '+err.message)}};actions.append(join);card.append(actions);box.append(card)}}
 $('class-search-form').addEventListener('submit',e=>{e.preventDefault();render()});['class-search','filter-country','filter-state'].forEach(id=>$(id).addEventListener('input',render));const params=new URLSearchParams(location.search);if(params.get('school'))$('class-search').value=params.get('school');if(params.get('q'))$('class-search').value=params.get('q');$('library-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;render()}});await render();const courseId=params.get('course'),schoolId=params.get('schoolId'),classId=params.get('class');if(courseId){const found=all.find(x=>!x.school_entity&&!x.class_entity&&String(x.id)===courseId);if(found)openDetail(found,db,uid,enroll,saved,render)}else if(classId){const found=all.find(x=>x.class_entity&&String(x.original_class_id)===classId);if(found)openDetail(found,db,uid,enroll,saved,render)}else if(schoolId){const found=all.find(x=>x.school_entity&&String(x.application_id)===schoolId);if(found)openDetail(found,db,uid,enroll,saved,render);else{$('class-search').value=schoolId;render()}}
}
async function learning(db,uid){const {data:en,error}=await db.from('joint_course_enrollments').select('course_id,status,created_at').eq('user_id',uid).in('status',['joined','enrolled','completed','pending_payment']).order('created_at',{ascending:false});if(error)throw error;const ids=(en||[]).map(x=>x.course_id);let courses=[];if(ids.length){const r=await db.from('joint_courses').select('id,title,category,level,description,content,price,currency').in('id',ids);if(r.error)throw r.error;courses=r.data||[]}const p=await db.from('joint_course_progress').select('course_id,completed_lesson_ids').eq('user_id',uid);if(p.error)throw p.error;const progress=new Map((p.data||[]).map(x=>[x.course_id,Array.isArray(x.completed_lesson_ids)?x.completed_lesson_ids:[]]));let totalDone=0,totalLessons=0;const box=$('my-course-list');box.replaceChildren();for(const c of courses){const content=c.content||{},mods=content.modules||[],lessons=mods.flatMap(m=>m.lessons||[]),done=new Set(progress.get(c.id)||[]),valid=lessons.filter(l=>l.id&&done.has(l.id)).length;totalDone+=valid;totalLessons+=lessons.length;const pct=lessons.length?Math.round(valid/lessons.length*100):0;const card=node('article',undefined,'course-card');card.append(node('span',c.category||'Learning','pill'));card.append(node('h3',c.title));card.append(node('p',c.description||''));card.append(node('p',valid+' of '+lessons.length+' lessons completed','course-meta'));const track=node('div',undefined,'progress-track'),fill=node('div',undefined,'progress-fill');fill.style.width=pct+'%';track.append(fill);card.append(track);card.append(node('strong',pct+'% complete'));if(en.find(x=>x.course_id===c.id)?.status==='pending_payment')card.append(node('p','Payment required before course access.','course-meta'));const btn=node('a','View course','learning-button');btn.href='classes.html?course='+encodeURIComponent(c.id);card.append(btn);box.append(card)}$('enrolled-count').textContent=courses.length;$('completed-count').textContent=totalDone;$('overall-progress').textContent=totalLessons?Math.round(totalDone/totalLessons*100)+'%':'0%';$('empty-learning').style.display=courses.length?'none':'block';$('learning-error').hidden=true}
document.addEventListener('DOMContentLoaded',init);
})();
