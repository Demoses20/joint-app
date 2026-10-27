(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function getClient(){if(window.jointSupabaseConnection)return await window.jointSupabaseConnection;return await new Promise((resolve,reject)=>{let done=false;const finish=(fn,v)=>{if(done)return;done=true;clearInterval(check);clearTimeout(timeout);fn(v)};const check=setInterval(()=>{if(window.jointSupabaseConnection)finish(resolve,window.jointSupabaseConnection)},50);const timeout=setTimeout(()=>finish(reject,new Error('Supabase did not initialize. Check supabase.js.')),12000)})}
async function init(){
 try{
  const db=await getClient();const {data:auth,error:ae}=await db.auth.getUser();if(ae)throw ae;if(!auth.user){location.href='auth.html?next='+encodeURIComponent(location.pathname.split('/').pop()+location.search);return}
  const promotionViewId=new URLSearchParams(location.search).get('joint_promotion_view');if(promotionViewId&&/^[0-9a-f-]{36}$/i.test(promotionViewId)){const tr=await db.rpc('joint_track_school_promotion_event',{p_promotion_id:promotionViewId,p_event_type:'view',p_source:'courses',p_metadata:{placement:'promotion_destination'}});if(tr.error)console.warn('Promotion view tracking failed:',tr.error.message)}
  // Legacy Paystack course-checkout callback removed: course enrolment is Diamond-only now.
  // Clean up any old callback query parameters without invoking the retired payment function.
  const params=new URLSearchParams(location.search);if(params.has('payment_return')){params.delete('payment_return');params.delete('reference');params.delete('trxref');history.replaceState({},'',location.pathname+(params.toString()?'?'+params.toString():'')+location.hash)}
  if($('course-results'))await classes(db,auth.user.id);if($('my-course-list'))await learning(db,auth.user.id);
 }catch(e){console.error(e);const target=$('course-empty')||$('learning-error');if(target){target.hidden=false;target.textContent='Could not connect to Classes: '+(e.message||'Check your connection and Supabase setup.')}}
}
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n}
function addShareButton(actions,c){const b=node('button','⋮ Share / Copy link','btn secondary');b.type='button';b.className+=' course-share-btn';b.setAttribute('aria-label','Copy share link for '+(c.title||'this course'));b.onclick=async()=>{let path;if(c.school_entity)path='classes.html?schoolId='+encodeURIComponent(c.application_id||c.id);else if(c.class_entity)path='classes.html?class='+encodeURIComponent(c.original_class_id||String(c.id).replace(/^school-class:/,''))+'&schoolId='+encodeURIComponent(c.application_id||'');else path='classes.html?course='+encodeURIComponent(c.id);const url=new URL(path,location.href).href;try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(url);else{const t=document.createElement('textarea');t.value=url;t.readOnly=true;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();const ok=document.execCommand('copy');t.remove();if(!ok)throw new Error('copy unavailable')}b.textContent='✓ Link copied';setTimeout(()=>b.textContent='⋮ Share / Copy link',2200)}catch(e){window.prompt('Copy this sharing link:',url)}};actions.append(b)}
async function currentStudentName(db,uid){try{const r=await db.from('joint_profiles').select('*').eq('id',uid).maybeSingle();const p=r.data||{};return p.full_name||p.display_name||p.username||p.email||null}catch(e){return null}}
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
  if (modal) { pauseLessonMedia(modal); modal.hidden = true; modal.style.display = 'none'; }
}
function youtubeEmbed(value){try{const u=new URL(String(value||''));let id='';if(u.hostname==='youtu.be')id=u.pathname.split('/').filter(Boolean)[0]||'';else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname)){if(u.pathname==='/watch')id=u.searchParams.get('v')||'';else if(/^\/(embed|shorts|live)\//.test(u.pathname))id=u.pathname.split('/')[2]||'';}return /^[A-Za-z0-9_-]{11}$/.test(id)?'https://www.youtube-nocookie.com/embed/'+id+'?rel=0&playsinline=1&enablejsapi=1&origin='+encodeURIComponent(location.origin):'';}catch(e){return '';}}
function pauseLessonMedia(root){if(!root)return;root.querySelectorAll('audio,video').forEach(function(media){try{media.pause();}catch(e){}});root.querySelectorAll('iframe[data-joint-youtube-frame="1"]').forEach(function(frame){try{frame.contentWindow.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:[]}), '*');}catch(e){}});}
function pauseAllInactiveLessonMedia(box){if(!box)return;box.querySelectorAll('[data-joint-lesson-card="1"]').forEach(function(card){if(card.dataset.jointScheduleState!=='active'||card.querySelector('.joint-lesson-body')?.hidden)pauseLessonMedia(card);});}
function lessonWindowState(lesson){const now=Date.now();const start=lesson.releaseAt?new Date(lesson.releaseAt).getTime():0;const end=lesson.availableUntil?new Date(lesson.availableUntil).getTime():Infinity;if(start&&now<start)return {open:false,message:'This lesson opens '+new Date(start).toLocaleString()+'.'};if(end!==Infinity&&now>end)return {open:false,message:'This lesson closed '+new Date(end).toLocaleString()+'. Contact your teacher if you need access.'};return {open:true,message:''};}
async function openCourseCheckout(item,db,uid,enroll,saved,refresh){
 const modal=ensureDetailModal(),box=$('learning-detail-content');box.replaceChildren();
 const title=node('h2','Enroll · '+(item.title||'Course'));title.id='learning-detail-title';box.append(title);
 const currency=String(item.currency||'NGN').toUpperCase();
 box.append(node('p','Course fee: '+new Intl.NumberFormat(undefined,{style:'currency',currency}).format(Number(item.price)||0),'course-price'));
 box.append(node('p','Pay only with your JOINT Diamond Wallet. Paystack is available only when purchasing Diamonds in your wallet.','course-meta'));
 const status=node('p','');status.className='course-meta';status.setAttribute('role','status');box.append(status);
 const pinLabel=node('label','Six-digit Diamond Wallet PIN');pinLabel.style.cssText='display:block;font-weight:700;margin:12px 0 6px';
 const pin=node('input');pin.type='password';pin.inputMode='numeric';pin.autocomplete='off';pin.maxLength=6;pin.pattern='[0-9]{6}';pin.placeholder='Enter wallet PIN';pin.setAttribute('aria-label','Six-digit Diamond Wallet PIN');pin.style.cssText='display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #d8cde8;border-radius:10px;font-size:18px;letter-spacing:5px';box.append(pinLabel,pin);
 const pay=node('button','Pay with Diamonds','btn');pay.type='button';pay.style.cssText='width:100%;margin-top:10px';box.append(pay);
 pay.onclick=async()=>{const p=pin.value.trim();if(!/^\d{6}$/.test(p)){status.textContent='Enter your six-digit wallet PIN.';pin.focus();return}pay.disabled=true;status.textContent='Verifying PIN and processing Diamond payment…';try{const prior=enroll.get(item.id);if(['enrolled','completed','joined'].includes(prior)){status.textContent='You already have access to this course.';pay.disabled=false;return}const key=crypto.randomUUID?crypto.randomUUID():('course-'+item.id+'-'+Date.now()+'-'+Math.random().toString(36).slice(2));const {data,error}=await db.rpc('joint_diamond_pay_course_enrollment',{p_course_id:item.id,p_pin:p,p_idempotency_key:key});if(error)throw error;const payload=data||{};if(!payload.ok)throw new Error(payload.message||'Diamond payment could not be completed.');enroll.set(item.id,'enrolled');status.textContent=payload.already_enrolled?'You already have access to this course.':'Payment successful — '+Number(payload.diamonds||0).toLocaleString()+' Diamonds paid. You are enrolled.';try{await ensureCourseSaved(db,uid,item.id,saved)}catch(e){console.warn('Enrolment succeeded; course save was not recorded.',e)}refresh();pay.textContent='Payment successful';pay.disabled=true;pay.setAttribute('aria-live','polite');pin.value='';pin.hidden=true;pinLabel.hidden=true;status.style.cssText='font-size:1.05rem;font-weight:700;color:#21834a;background:#edf9f0;border-radius:12px;padding:14px;margin:16px 0';status.setAttribute('role','alert');const successModal=$('learning-detail-modal');if(successModal){if(successModal._jointCloseTimer)clearTimeout(successModal._jointCloseTimer);successModal._jointCloseTimer=setTimeout(()=>{successModal.hidden=true;successModal.style.display='none';pauseLessonMedia(successModal);successModal._jointCloseTimer=null},2200)}}catch(e){console.error(e);status.textContent='Diamond payment failed: '+(e.message||String(e));pay.disabled=false}finally{pin.value=''}};
 modal.hidden=false;modal.style.display='flex'
}
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
    const alreadyEnrolled = enroll.has(item.id) && enroll.get(item.id) !== 'pending_payment';
    if (!alreadyEnrolled) {
      box.append(node('p', 'Enroll and complete payment to unlock the course outline, subjects, lessons and learning materials.', 'course-meta'));
    } else if (subjects.length) {
      box.append(node('h3', 'Subjects'));
      const ul = node('ul');
      subjects.slice(0, 1).forEach(function (subject) {
        const label = typeof subject === 'string' ? subject : (subject.title || subject.name || JSON.stringify(subject));
        ul.append(node('li', label));
      });
      box.append(ul);
    }
    if (alreadyEnrolled && modules.length) {
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
          const lessonStart = lesson.releaseAt ? new Date(lesson.releaseAt).getTime() : 0;
          lessonCard.dataset.jointLessonCard = '1';
          lessonCard.dataset.start = String(Number.isFinite(lessonStart) ? lessonStart : 0);
          const lessonBody = node('div'); lessonBody.className = 'joint-lesson-body';
          const lessonScheduleMessage = node('p', ''); lessonScheduleMessage.className = 'course-meta joint-lesson-schedule-message';
          lessonCard.append(lessonScheduleMessage);
          if (lesson.content) { const intro=node('div'); intro.style.cssText='display:block;width:100%;max-width:100%;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;font-size:clamp(1.08rem,2.9vw,1.24rem);font-weight:600'; intro.textContent=lesson.content; lessonBody.append(intro); }
          (Array.isArray(lesson.contentBlocks) ? lesson.contentBlocks : []).forEach(function (block) {
            if (block.text) lessonBody.append(node('p', block.text));
            if (!block.url) return;
            if (block.type === 'image' || block.type === 'image-upload') {
              const image = node('img'); image.src = block.url; image.alt = lesson.title || 'Lesson image';
              image.loading = 'lazy'; image.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;max-height:none;object-fit:contain;border-radius:12px;margin:14px 0';
              image.onerror = function () { image.replaceWith(node('p', 'This lesson image could not be loaded.', 'course-meta')); };
              lessonBody.append(image);
            } else if (block.type === 'audio-upload' || block.type === 'audio' || block.type === 'voice-note') {
              const audio=node('audio');audio.controls=true;audio.preload='metadata';audio.src=block.url;audio.style.cssText='display:block;width:100%;max-width:100%;margin:14px 0';lessonBody.append(audio);
            } else if (block.type === 'video-upload') {
              const video = node('video'); video.controls = true; video.preload = 'metadata'; video.crossOrigin = 'anonymous'; video.src = block.url;
              video.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;max-height:none;aspect-ratio:16/9;object-fit:contain;background:#111;border-radius:12px;margin:14px 0';
              lessonBody.append(video);
            } else if (block.type === 'embed' && typeof youtubeEmbed === 'function' && youtubeEmbed(block.url)) {
              const frame = node('iframe'); frame.src = youtubeEmbed(block.url); frame.title = lesson.title || 'Lesson video';
              frame.loading = 'lazy'; frame.referrerPolicy='strict-origin-when-cross-origin'; frame.setAttribute('data-joint-youtube-frame','1'); frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true;
              frame.style.cssText = 'display:block;width:100%;max-width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin:14px 0'; lessonBody.append(frame);
            } else if (block.type === 'video' || block.type === 'video-upload') {
              const video = node('video'); video.controls = true; video.preload = 'metadata'; video.crossOrigin = 'anonymous'; video.src = block.url;
              video.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;max-height:none;aspect-ratio:16/9;object-fit:contain;background:#111;border-radius:12px;margin:14px 0'; lessonBody.append(video);
            } else {
              const link = node('a', block.type === 'file-upload' ? ('Open document: ' + (block.fileName || 'lesson file')) : 'Open learning resource');
              link.href = block.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
              link.style.cssText = 'display:block;box-sizing:border-box;width:100%;max-width:100%;padding:12px 14px;margin:12px 0;background:#f1e8ff;color:#4b2196;border:1px solid #d9c6f5;border-radius:12px;font-weight:800;text-decoration:underline;overflow-wrap:anywhere'; lessonBody.append(link);
            }
          });
          if (lesson.video) {
            const embedUrl = typeof youtubeEmbed === 'function' ? youtubeEmbed(lesson.video) : '';
            if (embedUrl) { const frame = node('iframe'); frame.src = embedUrl; frame.title = lesson.title || 'Lesson video'; frame.loading = 'lazy'; frame.referrerPolicy='strict-origin-when-cross-origin'; frame.setAttribute('data-joint-youtube-frame','1'); frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true; frame.style.cssText = 'display:block;width:100%;max-width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin:14px 0'; lessonBody.append(frame); }
            else { const link = node('a', 'Open lesson video'); link.href = lesson.video; link.target = '_blank'; link.rel = 'noopener noreferrer'; lessonBody.append(link); }
          }
          if (lesson.resource) { const link = node('a', '↗ Open learning resource'); link.href = lesson.resource; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.cssText = 'display:block;box-sizing:border-box;width:100%;max-width:100%;padding:12px 14px;margin:12px 0;background:#f1e8ff;color:#4b2196;border:1px solid #d9c6f5;border-radius:12px;font-weight:800;text-decoration:underline;overflow-wrap:anywhere'; lessonBody.append(link); }
          // AI teaching mode: uses the authenticated Supabase Edge Function; no model secret is exposed in the browser.
          if (lesson.teachingMode === 'ai') {
            // Keep lesson materials hidden until the learner starts; reveal them in the saved order as teaching progresses.
            const aiMaterialContainer = node('div');
            aiMaterialContainer.className = 'joint-ai-staged-material';
            aiMaterialContainer.style.cssText = 'display:none;gap:10px;margin-top:14px';
            while (lessonBody.firstChild) aiMaterialContainer.append(lessonBody.firstChild);
            Array.from(aiMaterialContainer.children).forEach(el => { el.hidden = true; });
            aiMaterialContainer.hidden = true;
            let aiMaterialCursor = 0;
            const revealAiMaterial = (count = 2, revealAll = false) => {
              aiMaterialContainer.hidden = false; aiMaterialContainer.style.display = 'grid';
              const children = Array.from(aiMaterialContainer.children);
              const end = revealAll ? children.length : Math.min(children.length, aiMaterialCursor + count);
              for (; aiMaterialCursor < end; aiMaterialCursor++) {
                const child = children[aiMaterialCursor];
                child.hidden = false;
                child.style.opacity = '0';
                child.style.transition = 'opacity .25s ease';
                requestAnimationFrame(() => { child.style.opacity = '1'; });
              }
            };
            const aiPanel = node('section');
            aiPanel.className = 'joint-ai-teaching-panel';
            aiPanel.style.cssText = 'margin:18px 0;padding:16px;border:1px solid #d8c6f5;border-radius:16px;background:linear-gradient(145deg,#fbf8ff,#fff);font-size:1rem;font-weight:500;line-height:1.65';
            const aiHead = node('h4', '🤖 AI interactive teaching');
            aiHead.style.cssText = 'margin:0 0 8px;color:#5424b5;font-size:1.15rem';
            aiPanel.append(aiHead);
            const aiIntro = node('p', 'Start your AI lesson. It will use the chapter notes and available learning media, follow the host’s teaching instructions, ask questions, and give feedback.');
            aiIntro.style.margin = '0 0 12px'; aiPanel.append(aiIntro);
            const aiVoiceLabel = node('label');
            aiVoiceLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin:10px 0;font-weight:700';
            const aiVoice = document.createElement('input'); aiVoice.type = 'checkbox'; aiVoice.checked = true; aiVoice.style.width = '18px'; aiVoice.style.height = '18px';
            aiVoiceLabel.append(aiVoice, document.createTextNode('Read AI teaching aloud')); aiPanel.append(aiVoiceLabel);
            const aiTranscript = node('div'); aiTranscript.setAttribute('aria-live','polite');
            aiTranscript.style.cssText = 'display:grid;gap:10px;margin:12px 0'; aiPanel.append(aiTranscript);
            const aiStatus = node('p','AI tutor is ready.'); aiStatus.className='course-meta'; aiStatus.style.margin='8px 0'; aiPanel.append(aiStatus);
            const aiStart = node('button','▶ Start AI lesson','btn'); aiStart.type='button'; aiStart.style.cssText='width:100%;margin:8px 0'; aiPanel.append(aiStart);
            const aiReplyWrap = node('div'); aiReplyWrap.hidden = true;
            const aiReply = document.createElement('textarea'); aiReply.maxLength=8000; aiReply.placeholder='Ask the tutor a question or type your answer…'; aiReply.setAttribute('aria-label','Answer or ask the AI tutor');
            aiReply.style.cssText='display:block;width:100%;min-height:90px;padding:12px;border:1px solid #dcd3eb;border-radius:11px;font:inherit;box-sizing:border-box;background:#fff';
            const aiMic = node('button','🎙️ Answer by voice','btn secondary'); aiMic.type='button'; aiMic.style.cssText='width:100%;margin-top:8px';
            const aiImageLabel=node('label','🖼️ Upload an answer image from your phone'); aiImageLabel.style.cssText='display:block;margin:12px 0 6px;font-weight:750';
            const aiImageInput=document.createElement('input'); aiImageInput.type='file'; aiImageInput.accept='image/*'; aiImageInput.setAttribute('aria-label','Choose an existing answer image from your phone'); aiImageInput.style.cssText='display:block;width:100%;padding:10px;border:1px solid #dcd3eb;border-radius:10px;background:#fff;box-sizing:border-box';
            const aiCameraButton=node('button','📷 Take a new photo','btn secondary'); aiCameraButton.type='button'; aiCameraButton.style.cssText='width:100%;margin-top:8px';
            const aiCameraInput=document.createElement('input'); aiCameraInput.type='file'; aiCameraInput.accept='image/*'; aiCameraInput.setAttribute('capture','environment'); aiCameraInput.setAttribute('aria-label','Take a new photo of your answer'); aiCameraInput.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none'; aiCameraInput.tabIndex=-1;
            const aiImagePreview=document.createElement('img'); aiImagePreview.alt='Preview of your uploaded answer'; aiImagePreview.hidden=true; aiImagePreview.style.cssText='display:none;max-width:100%;max-height:280px;object-fit:contain;border-radius:10px;margin-top:10px;border:1px solid #e8e0f3';
            const aiImageRemove=node('button','Remove photo','btn secondary'); aiImageRemove.type='button'; aiImageRemove.hidden=true; aiImageRemove.style.cssText='width:100%;margin-top:6px';
            let aiImageDataUrl=''; let aiVoiceStartedAt=0; let aiLastVoiceSeconds=0;
            const readStudentImage=async(file,input)=>{aiImageDataUrl='';if(!file){return}if(!file.type.startsWith('image/')){aiStatus.textContent='Please choose an image file.';input.value='';return}if(file.size>12*1024*1024){aiStatus.textContent='Please choose a photo smaller than 12 MB.';input.value='';return}try{let blob=file;try{if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(file);const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Image conversion failed')),'image/jpeg',0.88));}}catch(convertError){if(!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type)){throw new Error('This photo format is not supported by your browser. Please choose a JPG or PNG image.')}}const reader=new FileReader();reader.onload=()=>{const dataUrl=String(reader.result||'');if(!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(dataUrl)){aiStatus.textContent='Could not prepare this image. Please choose a JPG or PNG photo.';return}aiImageDataUrl=dataUrl;aiImagePreview.onload=()=>{aiImagePreview.hidden=false;aiImagePreview.style.display='block';aiImageRemove.hidden=false;aiStatus.textContent='Photo ready. You can send it with text or by itself.'};aiImagePreview.onerror=()=>{aiImageDataUrl='';aiImagePreview.hidden=true;aiImagePreview.style.display='none';aiStatus.textContent='The selected photo could not be previewed. Please choose a JPG or PNG image.'};aiImagePreview.src=dataUrl};reader.onerror=()=>{aiStatus.textContent='Could not read that photo. Please try again.'};reader.readAsDataURL(blob)}catch(error){aiStatus.textContent=error?.message||'Could not read that photo. Please try a JPG or PNG image.';input.value=''}};
            aiImageInput.addEventListener('change',()=>readStudentImage(aiImageInput.files&&aiImageInput.files[0],aiImageInput));
            aiCameraInput.addEventListener('change',()=>readStudentImage(aiCameraInput.files&&aiCameraInput.files[0],aiCameraInput));
            aiCameraButton.addEventListener('click',()=>aiCameraInput.click());
            aiImageRemove.addEventListener('click',()=>{aiImageDataUrl='';aiImageInput.value='';aiCameraInput.value='';aiImagePreview.removeAttribute('src');aiImagePreview.hidden=true;aiImagePreview.style.display='none';aiImageRemove.hidden=true;aiStatus.textContent='Photo removed.'});
            const aiSend = node('button','Send answer','btn'); aiSend.type='button'; aiSend.style.cssText='width:100%;margin-top:8px'; aiReplyWrap.append(aiReply,aiMic,aiImageLabel,aiImageInput,aiCameraButton,aiCameraInput,aiImagePreview,aiImageRemove,aiSend); aiPanel.append(aiReplyWrap);
            lessonBody.append(aiPanel, aiMaterialContainer);
            const aiMemoryKey = 'joint-ai-memory:' + String(uid || 'learner') + ':' + String(item.id) + ':' + String(lesson.id);
            const aiHistory=[]; let aiBusy=false; let aiStarted=false; let aiSpeechRecognition=null; let aiDeadlineTimer=null;
            const addAiBubble=(role,text)=>{const b=node('div');b.style.cssText='padding:12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;'+(role==='student'?'background:#eee6ff;border:1px solid #d8c6f5':'background:#fff;border:1px solid #e8e0f3');b.append(node('strong',role==='student'?'You':'AI tutor'));b.append(node('div',String(text||'')));aiTranscript.append(b);return b};
            try {
              const saved = JSON.parse(localStorage.getItem(aiMemoryKey) || '{}');
              if (Array.isArray(saved.history)) saved.history.slice(-12).forEach(m => {
                if (m && ['user','assistant'].includes(m.role) && typeof m.content === 'string') {
                  aiHistory.push({role:m.role,content:m.content.slice(0,3000)});
                  addAiBubble(m.role === 'user' ? 'student' : 'assistant', m.content);
                }
              });
              if (saved.progress) { const note=node('div','📚 Previous progress: ' + String(saved.progress)); note.style.cssText='padding:10px;border-radius:10px;background:#f1eaff;color:#4b2196';aiTranscript.prepend(note); }
            } catch (e) { console.warn('AI lesson memory could not be restored',e); }

            const playAiVoice=async(text,audioBase64,audioMime)=>{if(!aiVoice.checked||!text)return;try{if(audioBase64){const raw=atob(audioBase64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const blob=new Blob([bytes],{type:audioMime||'audio/mpeg'});const audio=new Audio(URL.createObjectURL(blob));audio.addEventListener('ended',()=>URL.revokeObjectURL(audio.src),{once:true});await audio.play();return}}catch(e){console.warn('AI generated audio could not play; using browser voice.',e)}try{if('speechSynthesis'in window){window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='en-NG';window.speechSynthesis.speak(u)}}catch(e){console.warn('Browser voice unavailable',e)}};
            const renderAiQuestion=(q)=>{if(!q||!q.prompt)return;const card=node('div');card.style.cssText='padding:13px;border:1px solid #d8c6f5;border-radius:12px;background:#f7f1ff';card.append(node('strong',q.type==='multiple_choice'?'📝 Quick quiz':'💬 Your turn'));card.append(node('p',q.prompt));if(Array.isArray(q.options)&&q.options.length){const group=node('div');q.options.forEach((opt,i)=>{const label=node('label');label.style.cssText='display:flex;gap:8px;align-items:flex-start;margin:8px 0';const radio=document.createElement('input');radio.type='radio';radio.name='joint-ai-'+lesson.id+'-'+aiHistory.length;radio.value=String(i);radio.style.marginTop='5px';label.append(radio,document.createTextNode(String.fromCharCode(65+i)+'. '+opt));group.append(label)});const use=node('button','Use selected answer','btn secondary');use.type='button';use.style.marginTop='8px';use.onclick=()=>{const selected=group.querySelector('input:checked');if(!selected){aiStatus.textContent='Choose an option first.';return}aiReply.value=String.fromCharCode(65+Number(selected.value))+'. '+q.options[Number(selected.value)];aiReply.focus();};card.append(group,use)}aiTranscript.append(card)};
            const sampleAiVideoFrames=async()=>{const frames=[];const videos=Array.from(aiMaterialContainer.querySelectorAll('video')).slice(0,2);for(const video of videos){try{if(!Number.isFinite(video.duration)||video.duration<=0){if(video.readyState<1)await Promise.race([new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true})),new Promise(resolve=>setTimeout(resolve,1800))]);}if(!Number.isFinite(video.duration)||video.duration<=0)continue;const oldTime=video.currentTime;const wasPaused=video.paused;for(const fraction of [0.15,0.5,0.85]){if(frames.length>=6)break;const target=Math.min(Math.max(0,video.duration-0.15),video.duration*fraction);await Promise.race([new Promise(resolve=>{const done=()=>resolve();video.addEventListener('seeked',done,{once:true});try{video.currentTime=target}catch(e){resolve()}}),new Promise(resolve=>setTimeout(resolve,1200))]);try{const canvas=document.createElement('canvas');const scale=Math.min(1,512/Math.max(video.videoWidth||512,video.videoHeight||288));canvas.width=Math.max(1,Math.round((video.videoWidth||512)*scale));canvas.height=Math.max(1,Math.round((video.videoHeight||288)*scale));const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',0.62);if(data.startsWith('data:image/jpeg;base64,')&&data.length<450000)frames.push(data)}catch(frameError){console.warn('A lesson video frame could not be sampled (the video host may block canvas access).',frameError);break}}try{video.currentTime=oldTime;if(!wasPaused)video.play().catch(()=>{})}catch(e){}}catch(e){console.warn('Lesson video frame sampling skipped.',e)}}return frames;};
            const callAi=async(action,responseText='',imageDataUrl='')=>{if(aiBusy)return;aiBusy=true;aiStart.disabled=true;aiSend.disabled=true;aiStatus.textContent=action==='start'?'Preparing your AI lesson…':'AI tutor is thinking…';try{const savedMemory = (()=>{try{return JSON.parse(localStorage.getItem(aiMemoryKey)||'{}')}catch(e){return {}}})();
            const videoFrames=action==='start'?await sampleAiVideoFrames():[];const requestId=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():('joint-'+Date.now()+'-'+Math.random().toString(36).slice(2));const result=await db.functions.invoke('joint-ai-teach-',{body:{action,courseId:item.id,lessonId:lesson.id,requestId,studentResponse:responseText,studentImageDataUrl:imageDataUrl,videoFrames,voiceNoteSeconds:action==='answer'?aiLastVoiceSeconds:0,history:aiHistory.slice(-12),memory:savedMemory.progress||'',voice:!!aiVoice.checked}});aiLastVoiceSeconds=0;if(result.error){let detail=result.error.message||'AI service request failed.';try{const body=result.error.context&&await result.error.context.json();if(body&&body.error)detail=body.error}catch(e){}throw new Error(detail)}const payload=result.data||{};if(!payload.ok)throw new Error(payload.error||'AI teaching service is not configured.');if(responseText||imageDataUrl){const studentMessage=responseText||(imageDataUrl?'[Student submitted a photo for the AI teacher to read.]':'');aiHistory.push({role:'user',content:studentMessage});addAiBubble('student',studentMessage);if(imageDataUrl){const sentPhoto=node('img');sentPhoto.src=imageDataUrl;sentPhoto.alt='Photo submitted to the AI teacher';sentPhoto.style.cssText='display:block;max-width:100%;max-height:260px;object-fit:contain;border-radius:10px;margin-top:8px';aiTranscript.lastElementChild?.append(sentPhoto);}aiReply.value='';aiImageDataUrl='';aiImageInput.value='';aiCameraInput.value='';aiImagePreview.removeAttribute('src');aiImagePreview.hidden=true;aiImagePreview.style.display='none';aiImageRemove.hidden=true;}const reply=String(payload.message||'Let’s continue with the lesson.');aiStatus.style.color='';aiHistory.push({role:'assistant',content:reply});addAiBubble('assistant',reply);if(Number.isFinite(Number(payload.pointsCharged))){const billingNote=node('small','AI Points charged: '+Number(payload.pointsCharged)+' · wallet balance: '+Number(payload.balance||0));billingNote.style.cssText='display:block;margin:0 0 12px;padding:8px 10px;border-radius:9px;background:#f0e8ff;color:#5424b5;font-weight:800';aiTranscript.append(billingNote);}
            try { localStorage.setItem(aiMemoryKey, JSON.stringify({history:aiHistory.slice(-12),progress:String(payload.progressSummary||reply).slice(0,1200),updatedAt:new Date().toISOString()})); } catch(e) { console.warn('AI lesson memory could not be saved',e); }
            if(action==='start') revealAiMaterial(2); else revealAiMaterial(2, !!payload.finished);if(payload.question)renderAiQuestion(payload.question);if(payload.assignment){const assignment=node('div');assignment.style.cssText='padding:12px;border:1px solid #e7d9b8;border-radius:12px;background:#fff8e8';const assignmentTitle=String(payload.assignment.title||'Practice task');const assignmentInstructions=String(payload.assignment.instructions||'');assignment.append(node('strong','📚 Practice assignment'),node('p',assignmentTitle),node('p',assignmentInstructions));aiTranscript.append(assignment);aiHistory.push({role:'assistant',content:'Practice assignment: '+assignmentTitle+' — '+assignmentInstructions})}if(payload.media&&Array.isArray(payload.media)){payload.media.forEach(m=>{if(!m||!m.url)return;let el;if(m.type==='image'){el=node('img');el.src=m.url;el.alt=m.label||'Learning image';el.style.cssText='max-width:100%;height:auto;border-radius:10px'}else if(m.type==='video'){el=node('a','▶ '+(m.label||'Open learning video'));el.href=m.url;el.target='_blank';el.rel='noopener noreferrer'}else if(m.type==='audio'){el=node('audio');el.controls=true;el.src=m.url;el.style.width='100%'}else return;aiTranscript.append(el)})}await playAiVoice(reply,payload.audioBase64,payload.audioMime);if(action==='start'){aiStarted=true;aiReplyWrap.hidden=false;aiStart.textContent='✓ AI lesson started';aiStart.disabled=true;
              const deadline = lesson.availableUntil ? new Date(lesson.availableUntil).getTime() : 0;
              if (deadline > Date.now()) {
                const updateDeadline = () => {
                  const left = deadline - Date.now();
                  if (left <= 0) {
                    aiReply.disabled = true; aiSend.disabled = true; aiMic.disabled = true;
                    aiStatus.textContent = 'This class has ended. Your progress is saved on this device; the next scheduled class can now begin.';
                    if (aiSpeechRecognition) try { aiSpeechRecognition.stop(); } catch(e) {}
                    if (aiDeadlineTimer) clearInterval(aiDeadlineTimer);
                    return;
                  }
                  const mins = Math.floor(left / 60000), secs = Math.floor((left % 60000) / 1000);
                  aiStatus.textContent = 'Class time remaining: ' + mins + 'm ' + secs + 's. Finish your current question before class ends.';
                };
                updateDeadline(); aiDeadlineTimer = setInterval(updateDeadline, 15000);
              }
            }aiStatus.textContent=payload.finished?'Lesson section complete. You can still ask a follow-up question.':(aiDeadlineTimer?'Class is in progress. Ask a question or submit your answer to continue.':'Ask a question or submit your answer to continue.');if(typeof payload.score==='number'){const score=Math.max(0,Math.min(100,Math.round(payload.score)));try{const record={course_id:item.id,lesson_id:lesson.id||null,assignment_id:'ai-'+String(lesson.id||'lesson'),assignment_title:String(lesson.title||'AI lesson')+' · AI practice',submission_type:['quiz','assignment','question_answer'].includes(String(payload.activityType||''))?String(payload.activityType):'question_answer',student_id:uid,student_name_snapshot:await currentStudentName(db,uid),submission_text:responseText||null,answers_json:{feedback:reply,history:aiHistory.slice(-8)},score,max_score:100,passed:score>=Number(lesson.progression?.passScore??70),submitted_at:new Date().toISOString(),ai_graded:true};const saved=await db.from('joint_course_assignment_submissions').insert(record);if(saved.error)console.warn('AI score could not be saved to submissions',saved.error)}catch(saveErr){console.warn('AI score persistence failed',saveErr)}}aiTranscript.scrollTop=aiTranscript.scrollHeight;}catch(err){console.error('JOINT AI teaching error',err);aiStatus.textContent='AI teaching could not start: '+(err.message||'Check the Edge Function deployment and OPENAI_API_KEY secret.');aiStatus.style.color='#a52222';}finally{aiBusy=false;if(!aiStarted)aiStart.disabled=false;aiSend.disabled=false;}};
            aiStart.addEventListener('click',()=>callAi('start'));
            aiSend.addEventListener('click',()=>{const text=aiReply.value.trim();if(!text&&!aiImageDataUrl){aiStatus.textContent='Write an answer, ask a question, or attach a photo first.';return}callAi('answer',text,aiImageDataUrl)});
            aiMic.addEventListener('click',()=>{
              const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
              if (!SpeechRecognition) { aiStatus.textContent='Voice input is not supported in this browser. Try the latest Chrome or type your answer.'; return; }
              if (aiSpeechRecognition) { try { aiSpeechRecognition.stop(); } catch(e) {} }
              aiSpeechRecognition = new SpeechRecognition(); aiSpeechRecognition.lang='en-NG'; aiSpeechRecognition.interimResults=true; aiSpeechRecognition.continuous=false;
              aiVoiceStartedAt=Date.now(); aiMic.disabled=true; aiMic.textContent='🎙️ Listening…'; aiStatus.textContent='Speak now. Your words will appear in the text box so you can review them before sending.';
              aiSpeechRecognition.onresult=(event)=>{let transcript='';for(let i=event.resultIndex;i<event.results.length;i++)transcript+=event.results[i][0].transcript;aiReply.value=transcript;};
              aiSpeechRecognition.onerror=(event)=>{aiStatus.textContent='Voice input stopped ('+(event.error||'unavailable')+'). You can try again or type.';};
              aiSpeechRecognition.onend=()=>{aiLastVoiceSeconds=Math.max(0,Math.ceil((Date.now()-(aiVoiceStartedAt||Date.now()))/1000));aiVoiceStartedAt=0;aiMic.disabled=false;aiMic.textContent='🎙️ Answer by voice';if(aiReply.value.trim())aiStatus.textContent='Voice captured. Review your words, then tap Send answer.';};
              try { aiSpeechRecognition.start(); } catch(e) { aiMic.disabled=false;aiMic.textContent='🎙️ Answer by voice';aiStatus.textContent='Could not start the microphone. Check browser microphone permission.'; }
            });
            aiReply.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();aiSend.click()}});
          }
          // Host-authored questions/answers and quizzes are rendered as scheduled activities.
          const human = lesson.humanSettings || {};
          const addScheduledActivity = function(kind, entry, activityIndex) {
            const startValue = entry.opensAt || '';
            const endValue = entry.closesAt || entry.deadline || '';
            const activity = node('article');
            activity.className = 'joint-scheduled-activity';
            activity.dataset.jointScheduledCard = '1';
            activity.dataset.start = startValue ? String(new Date(startValue).getTime()) : '0';
            activity.dataset.end = endValue ? String(new Date(endValue).getTime()) : '';
            activity.style.cssText = 'padding:12px;margin:12px 0;border:1px solid #e4d8f5;border-radius:12px;background:#fcfaff;overflow-wrap:anywhere';
            const body = node('div'); body.className = 'joint-scheduled-body';
            const heading = kind === 'question' ? 'Question & answer' : 'Quiz';
            const title = entry.question || (heading + ' ' + (activityIndex + 1));
            body.append(node('h4', title));
            const message = node('p',''); message.className='course-meta joint-scheduled-message';
            const setMessage=(text,error)=>{message.textContent=text;message.style.color=error?'#a52222':'#51416b'};
            const submitRecord=async function(payload,button,answerControls,successText){
              button.disabled=true;setMessage('Submitting…');
              try{
                const record={course_id:item.id,lesson_id:lesson.id||null,assignment_id:String(entry.id||kind+'-'+activityIndex),assignment_title:String(title),submission_type:kind==='question'?'question_answer':'quiz',student_id:uid,student_name_snapshot:await currentStudentName(db,uid),submission_text:payload.text||null,answers_json:payload.answers||null,score:payload.score,max_score:100,passed:payload.passed,quiz_correct:payload.correct??null,quiz_total:payload.total??null,submitted_at:new Date().toISOString(),ai_graded:false};
                const saved=await db.from('joint_course_assignment_submissions').insert(record);
                if(saved.error)throw saved.error;
                answerControls.forEach(function(control){control.disabled=true});
                button.textContent='✓ Submitted';
                setMessage(successText,false);
              }catch(err){console.error(err);setMessage('Could not submit. Please try again. '+(err.message||''),true);button.disabled=false}
            };
            if (kind === 'question') {
              const answer=document.createElement('textarea');answer.placeholder='Type your answer here…';answer.maxLength=5000;answer.autocomplete='off';answer.setAttribute('aria-label','Answer: '+title);answer.style.cssText='display:block;width:100%;min-height:110px;padding:12px;border:1px solid #dcd3eb;border-radius:10px;font:inherit;margin:10px 0;box-sizing:border-box';
              const submit=node('button','Submit answer','btn');submit.type='button';submit.style.cssText='margin-top:6px';
              submit.addEventListener('click',function(){if(!answer.value.trim()){setMessage('Type your answer before submitting.',true);return}submitRecord({text:answer.value.trim(),score:null,passed:null},submit,[answer],'Answer submitted to your teacher for review.')});
              body.append(answer,submit);
            } else {
              const type = entry.type || 'multiple_choice';
              if (type === 'multiple_choice' && Array.isArray(entry.options)) {
                const choices = node('div');
                entry.options.forEach(function(option, optionIndex) {
                  if (!String(option || '').trim()) return;
                  const label = node('label'); label.style.cssText = 'display:flex;gap:9px;align-items:flex-start;margin:10px 0;font-weight:600';
                  const radio = document.createElement('input'); radio.type='radio'; radio.name='joint-quiz-'+(entry.id || lesson.id || lessonIndex)+'-'+activityIndex; radio.value=String(optionIndex); radio.style.marginTop='7px';
                  label.append(radio, document.createTextNode(String.fromCharCode(65+optionIndex)+'. '+option)); choices.append(label);
                });
                const submit=node('button','Submit quiz answer','btn');submit.type='button';submit.style.cssText='margin-top:8px';
                submit.addEventListener('click',function(){const chosen=body.querySelector('input[type="radio"]:checked');if(!chosen){setMessage('Choose an answer first.',true);return}const correct=Number(chosen.value)===Number(entry.answerIndex);const correctOption=Array.isArray(entry.options)?entry.options[Number(entry.answerIndex)]:'Not available';submitRecord({text:String(chosen.value),answers:{selected_index:Number(chosen.value),selected_option:entry.options[Number(chosen.value)]||'',correct_answer:correctOption},score:correct?100:0,passed:correct,correct:correct?1:0,total:1},submit,Array.from(choices.querySelectorAll('input[type="radio"]')),(correct?'Passed — your answer is correct. ':'Not passed — the correct answer is: ')+(correct?'':String(correctOption||'Not available')+'.') )});
                body.append(choices,submit);
              } else {
                const answer=document.createElement('textarea');answer.placeholder='Write your answer…';answer.maxLength=5000;answer.style.cssText='display:block;width:100%;min-height:90px;padding:10px;border:1px solid #dcd3eb;border-radius:10px;font:inherit;box-sizing:border-box';
                const submit=node('button','Submit quiz answer','btn');submit.type='button';submit.style.cssText='margin-top:8px';
                submit.addEventListener('click',function(){if(!answer.value.trim()){setMessage('Write your answer before submitting.',true);return}const expected=String(entry.answer||'').trim();if(expected){const norm=v=>String(v||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');const correct=norm(answer.value)===norm(expected);submitRecord({text:answer.value.trim(),answers:{response:answer.value.trim(),correct_answer:expected},score:correct?100:0,passed:correct,correct:correct?1:0,total:1},submit,[answer],correct?'Passed — your answer matches the answer key.':'Not passed — the expected answer is: '+expected+'.')}else{submitRecord({text:answer.value.trim(),answers:{response:answer.value.trim()},score:null,passed:null},submit,[answer],'Answer submitted to your teacher for review because this quiz has no answer key.') }});body.append(answer,submit);
              }
            }
            activity.append(message, body); lessonBody.append(activity);
          };
          (Array.isArray(human.questions) ? human.questions : []).forEach((q, i) => addScheduledActivity('question', q, i));
          (Array.isArray(human.quizzes) ? human.quizzes : []).forEach((q, i) => addScheduledActivity('quiz', q, i));
          lessonCard.append(lessonBody);
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
        const card=node('article');card.className='joint-scheduled-activity';card.dataset.jointScheduledCard='1';
        card.dataset.start=a.opensAt?String(new Date(a.opensAt).getTime()):'0';
        const endValue=a.deadline||a.closesAt||'';card.dataset.end=endValue?String(new Date(endValue).getTime()):'';
        card.style.cssText='padding:12px;margin:10px 0;border:1px solid #e9e2f2;border-radius:12px;background:#fcfaff';
        card.append(node('h4',a.title||('Assignment '+(index+1))));if(a.instructions)card.append(node('p',a.instructions));
        const scheduleMessage=node('p','');scheduleMessage.className='course-meta joint-scheduled-message';card.append(scheduleMessage);
        const controls=node('div');controls.className='joint-scheduled-body';
        const answer=document.createElement('textarea');answer.maxLength=12000;answer.placeholder='Write your answer or submission notes (optional)';answer.setAttribute('aria-label','Answer for '+(a.title||'assignment'));answer.style.cssText='display:block;width:100%;min-height:90px;padding:10px;border:1px solid #dcd3eb;border-radius:10px;font:inherit;margin:8px 0';controls.append(answer);
        const file=document.createElement('input');file.type='file';file.accept='image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv';file.style.cssText='display:block;width:100%;padding:10px;margin:8px 0';file.setAttribute('aria-label','Upload assignment file');controls.append(file);
        const status=node('p','');status.className='course-meta';controls.append(status);
        const submit=node('button','＋ Submit assignment','btn');submit.type='button';submit.style.cssText='width:100%;margin-top:8px';
        submit.addEventListener('click',async function(){
          submit.disabled=true;status.textContent='Submitting…';
          try{
            let fileUrl=null,fileName=null;
            const picked=file.files&&file.files[0];
            if(picked){if(picked.size>50*1024*1024)throw new Error('Please choose a file smaller than 50 MB.');if(/\.(zip|rar|7z)$/i.test(picked.name)||picked.type==='application/zip')throw new Error('ZIP archives are not accepted. Upload your actual work file instead.');const key=uid+'/assignment-submissions/'+item.id+'/'+(a.id||('assignment-'+index))+'/'+Date.now()+'-'+picked.name.replace(/[^a-zA-Z0-9._-]/g,'_');const uploaded=await db.storage.from('joint-learning-media').upload(key,picked,{upsert:false,contentType:picked.type||'application/octet-stream'});if(uploaded.error)throw uploaded.error;fileUrl=db.storage.from('joint-learning-media').getPublicUrl(key).data.publicUrl;fileName=picked.name;}
            if(!answer.value.trim()&&!picked)throw new Error('Write an answer or choose a file before submitting.');
            const result=await db.from('joint_course_assignment_submissions').insert({course_id:item.id,lesson_id:a._lessonId,assignment_id:String(a.id||('assignment-'+index)),assignment_title:String(a.title||('Assignment '+(index+1))),submission_type:'assignment',student_id:uid,student_name_snapshot:await currentStudentName(db,uid),submission_text:answer.value.trim()||null,file_url:fileUrl,file_name:fileName,submitted_at:new Date().toISOString(),score:null,max_score:100,passed:null,ai_graded:false});
            if(result.error)throw result.error;status.textContent='Assignment submitted successfully. Your teacher can review it.';submit.textContent='✓ Submitted';file.disabled=true;answer.disabled=true;
          }catch(err){console.error(err);status.textContent='Could not submit: '+(err.message||'Please try again. If this mentions joint_course_assignment_submissions, apply the included SQL setup file in Supabase first.');submit.disabled=false;}
        });controls.append(submit);card.append(controls);submissionPanel.append(card);
      });
      // Update release windows live while the learner keeps this card open. No page refresh is needed.
      const updateScheduledActivities = function(){
        if(!modal.isConnected || modal.hidden || modal.style.display==='none') return;
        const now=Date.now();
        const focused=box.contains(document.activeElement)&&document.activeElement&&(/^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName)||document.activeElement.isContentEditable);
        box.querySelectorAll('#joint-course-learning-content > section').forEach(function(moduleSection){
          const lessons=Array.from(moduleSection.querySelectorAll(':scope > [data-joint-lesson-card="1"]'));
          if(!lessons.length)return;
          const hasScheduled=lessons.some(card=>(Number(card.dataset.start)||0)>0);
          const started=lessons.filter(card=>(Number(card.dataset.start)||0)<=now).sort((a,b)=>(Number(b.dataset.start)||0)-(Number(a.dataset.start)||0));
          const activeLesson=hasScheduled?(started[0]||null):null;
          lessons.forEach(function(card){
            const start=Number(card.dataset.start)||0;const body=card.querySelector('.joint-lesson-body');const message=card.querySelector('.joint-lesson-schedule-message');
            const active=!hasScheduled||card===activeLesson; if(body)body.hidden=!active;
            if(message){message.hidden=active;if(now<start)message.textContent='This lesson opens '+new Date(start).toLocaleString()+'.';else message.textContent='A newer lesson is now active. This lesson remains in your course history.';}
            card.dataset.jointScheduleState=active?'active':(now<start?'upcoming':'ended');if(!active)pauseLessonMedia(card);
          });
          const ordered=lessons.slice().sort((a,b)=>{const rank=x=>x.dataset.jointScheduleState==='active'?0:x.dataset.jointScheduleState==='upcoming'?1:2;return rank(a)-rank(b)||(Number(b.dataset.start)||0)-(Number(a.dataset.start)||0)});
          const currentLessonOrder=Array.from(moduleSection.querySelectorAll(':scope > [data-joint-lesson-card="1"]'));
          if(!focused&&ordered.some((card,index)=>currentLessonOrder[index]!==card)){ordered.forEach(card=>moduleSection.appendChild(card));}
        });
        box.querySelectorAll('[data-joint-scheduled-card="1"]').forEach(function(card){
          const start=Number(card.dataset.start)||0;const end=card.dataset.end===''?Infinity:Number(card.dataset.end);
          const body=card.querySelector('.joint-scheduled-body');const message=card.querySelector('.joint-scheduled-message');
          const active=now>=start&&now<=end;
          if(body)body.hidden=!active;
          if(message){message.hidden=active;if(now<start)message.textContent='This activity opens '+new Date(start).toLocaleString()+'.';else if(end!==Infinity&&now>end)message.textContent='This activity has ended. It remains in your course history.';else message.textContent='This activity is not available yet.';}
          card.dataset.jointScheduleState=active?'active':(now<start?'upcoming':'ended');
        });
        // Keep currently running activities above upcoming and completed ones in each panel.
        box.querySelectorAll('#joint-course-learning-content .lesson-card-placeholder, #joint-assignment-submissions').forEach(function(){});
        box.querySelectorAll('#joint-assignment-submissions').forEach(function(panel){
          const cards=Array.from(panel.querySelectorAll(':scope > [data-joint-scheduled-card="1"]'));
          cards.sort((a,b)=>{const rank=x=>x.dataset.jointScheduleState==='active'?0:x.dataset.jointScheduleState==='upcoming'?1:2;return rank(a)-rank(b)||(Number(b.dataset.start)||0)-(Number(a.dataset.start)||0)});
          const currentAssignmentOrder=Array.from(panel.querySelectorAll(':scope > [data-joint-scheduled-card="1"]'));
          if(!focused&&cards.some((card,index)=>currentAssignmentOrder[index]!==card)){cards.forEach(card=>panel.appendChild(card));}
        });
        box.querySelectorAll('.joint-scheduled-activity').forEach(function(card){if(card.parentElement&&card.parentElement.id!=='joint-assignment-submissions'){const siblings=Array.from(card.parentElement.querySelectorAll(':scope > .joint-scheduled-activity'));siblings.sort((a,b)=>{const rank=x=>x.dataset.jointScheduleState==='active'?0:x.dataset.jointScheduleState==='upcoming'?1:2;return rank(a)-rank(b)||(Number(b.dataset.start)||0)-(Number(a.dataset.start)||0)});const currentActivityOrder=Array.from(card.parentElement.querySelectorAll(':scope > .joint-scheduled-activity'));if(!focused&&siblings.some((x,index)=>currentActivityOrder[index]!==x)){siblings.forEach(x=>card.parentElement.appendChild(x));}}});
      };
      if(window.__jointScheduledActivityTimer)clearInterval(window.__jointScheduledActivityTimer);
      updateScheduledActivities();pauseAllInactiveLessonMedia(box);window.__jointScheduledActivityTimer=setInterval(updateScheduledActivities,1000);
      box.append(submissionPanel);
    } else if (alreadyEnrolled && !subjects.length) {
      box.append(node('p', 'Course details are available from the host. The course outline will appear here when the host publishes lessons.', 'course-meta'));
    }
    const actionLabel = alreadyEnrolled ? 'Continue learning' : (Number(item.price) > 0 ? 'Enroll' : 'Join');
    const action = node('button', actionLabel, 'btn');
    action.type = 'button'; action.style.cssText = 'width:100%;margin-top:14px';
    if (alreadyEnrolled) action.style.background = '#6938d1';
    if (enroll.get(item.id)==='pending_payment' && !alreadyEnrolled) { action.textContent = 'Payment pending'; }
    action.onclick = async function () {
      if (alreadyEnrolled) {
        const learningContent = box.querySelector('#joint-course-learning-content');
        if (learningContent) learningContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        return;
      }
      if (Number(item.price)>0) { closeDetail(); await openCourseCheckout(item,db,uid,enroll,saved,refresh); return; }
      if(enroll.get(item.id)==='pending_payment'){closeDetail();await openCourseCheckout(item,db,uid,enroll,saved,refresh);return;}
      action.disabled = true;
      try {
        const result = await db.from('joint_course_enrollments').insert({ user_id: uid, course_id: item.id, status: 'joined' });
        if (result.error) throw result.error;
        enroll.set(item.id, 'joined');
        alert('You joined this course.');
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
async function ensureCourseSaved(db,uid,courseId,saved){
 if(saved.has(courseId))return;
 const result=await db.from('joint_course_saves').insert({user_id:uid,course_id:courseId});
 if(result.error){const msg=String(result.error.message||'').toLowerCase();if(!msg.includes('duplicate')&&!msg.includes('already exists')&&result.error.code!=='23505')throw result.error;}
 saved.add(courseId);
}
async function getPreferredDisplayCurrency(db,uid){
 let code='NGN';
 try{const r=await db.from('joint_user_preferences').select('currency_preference').eq('user_id',uid).maybeSingle();if(!r.error&&['NGN','USD'].includes(String(r.data?.currency_preference||'').toUpperCase()))code=String(r.data.currency_preference).toUpperCase();else{const p=JSON.parse(localStorage.getItem('joint_user_preferences_v2')||'{}');if(['NGN','USD'].includes(String(p.currency||'').toUpperCase()))code=String(p.currency).toUpperCase();}}catch(_){try{const p=JSON.parse(localStorage.getItem('joint_user_preferences_v2')||'{}');if(['NGN','USD'].includes(String(p.currency||'').toUpperCase()))code=String(p.currency).toUpperCase();}catch(__){}}
 return code;
}
function formatMoney(amount,currency){try{return new Intl.NumberFormat(undefined,{style:'currency',currency}).format(Number(amount)||0)}catch(_){return currency+' '+(Number(amount)||0).toFixed(2)}}
async function addCourseCurrencyEstimate(priceNode,course,db,targetCurrency){
 const amount=Number(course.price)||0;if(amount<=0)return;
 const sourceCurrency=String(course.currency||'NGN').toUpperCase();
 if(!/^[A-Z]{3}$/.test(sourceCurrency)){priceNode.textContent='Paid · '+String(course.price)+' '+sourceCurrency;return;}
 if(sourceCurrency===targetCurrency){priceNode.textContent='Paid · '+formatMoney(amount,sourceCurrency);return;}
 priceNode.textContent='Original price: '+formatMoney(amount,sourceCurrency)+' · Loading '+targetCurrency+' estimate…';
 try{const {data,error}=await db.functions.invoke('joint-currency-convert',{body:{amount,sourceCurrency,targetCurrency}});if(error)throw error;const q=data?.data||data;if(!q?.ok||q.quoteType!=='display_estimate_only')throw new Error(q?.error||'No conversion quote');
 priceNode.replaceChildren();priceNode.append(document.createTextNode('Original price: '+formatMoney(amount,sourceCurrency)));
 const estimate=node('span','Estimated total: '+formatMoney(q.estimatedTotal,targetCurrency),'course-price-estimate');estimate.style.cssText='display:block;margin-top:4px;color:#5424b5;font-weight:800';priceNode.append(estimate);
 const detail=node('small','Converted: '+formatMoney(q.convertedAmount,targetCurrency)+' + JOINT 2% margin: '+formatMoney(q.conversionMargin,targetCurrency)+' · Rate updated '+new Date(q.rateTimestamp).toLocaleString()+' · Estimate only; checkout currency may differ.','course-meta');detail.style.cssText='display:block;margin-top:4px;font-weight:400';priceNode.append(detail);
 }catch(e){console.warn('Currency estimate unavailable for course '+course.id,e);priceNode.textContent='Paid · '+formatMoney(amount,sourceCurrency)+' (conversion estimate unavailable)';}
}
async function classes(db,uid){
 let all=[],saved=new Set(),enroll=new Map(),view='discover';
 const preferredCurrency=await getPreferredDisplayCurrency(db,uid);
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
 const [s,e]=await Promise.all([db.from('joint_course_saves').select('course_id').eq('user_id',uid),db.from('joint_course_enrollments').select('course_id,status').eq('user_id',uid)]);if(s.error)throw s.error;if(e.error)throw e.error;saved=new Set((s.data||[]).map(x=>x.course_id));enroll=new Map((e.data||[]).map(x=>[x.course_id,x.status]));for(const [courseId,status] of enroll){if(['joined','enrolled','completed'].includes(status)&&!saved.has(courseId)){try{await ensureCourseSaved(db,uid,courseId,saved)}catch(saveError){console.warn('Automatic course save skipped for '+courseId,saveError)}}}
 let interestTerms=[];const profileResult=await db.from('joint_profiles').select('interests').eq('id',uid).maybeSingle();if(!profileResult.error&&profileResult.data?.interests)interestTerms=String(profileResult.data.interests).split(/[,;|]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 const interestScore=c=>{const text=[c.title,c.description,c.category,c.host_name,c.country,c.state,...(((c.content||{}).course||{}).subjects||[])].join(' ').toLowerCase();return interestTerms.reduce((score,term)=>score+(text.includes(term)?1:0),0)};
 const filter=()=>{const q=$('class-search').value.trim().toLowerCase(),country=$('filter-country').value,state=$('filter-state').value.trim().toLowerCase();let list=all.filter(c=>[c.title,c.description,c.category,c.host_name,c.city,c.state,c.country,c.host_type,...(((c.content||{}).course||{}).subjects||[])].join(' ').toLowerCase().includes(q));if(country)list=list.filter(c=>c.country===country);if(state)list=list.filter(c=>(c.state||'').toLowerCase().includes(state));if(view==='saved')list=list.filter(c=>!c.school_entity&&!c.class_entity&&saved.has(c.id));if(view==='joined')list=list.filter(c=>!c.school_entity&&!c.class_entity&&['joined','enrolled','completed'].includes(enroll.get(c.id)));if(view==='enrolled')list=list.filter(c=>!c.school_entity&&!c.class_entity&&['pending_payment','enrolled','completed'].includes(enroll.get(c.id)));if(view==='host')list=list.filter(c=>!c.school_entity&&!c.class_entity&&c.owner_id===uid);if(view==='discover')list.sort((a,b)=>(a.school_entity===b.school_entity?interestScore(b)-interestScore(a):a.school_entity?-1:1)||new Date(b.created_at||0)-new Date(a.created_at||0));return list};
 async function render(){const box=$('course-results');box.replaceChildren();$('results-heading').textContent=({discover:'Available courses and schools',saved:'Your saved courses',enrolled:'Your paid course enrolments',joined:'Your joined courses',host:'Your published courses'})[view];const list=filter();$('saved-count').textContent=saved.size+' saved';$('enrolled-count').textContent=[...enroll.values()].filter(x=>['pending_payment','enrolled','completed'].includes(x)).length+' paid';$('joined-count').textContent=[...enroll.values()].filter(x=>['joined','enrolled','completed'].includes(x)).length+' joined';$('course-empty').hidden=!!list.length;$('course-empty').textContent=view==='host'?'You have no published courses yet.':'No courses or schools match your search.';document.querySelectorAll('.library-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===view));for(const c of list){const card=node('article',undefined,'course-card');card.dataset.learningEngagement='1';card.dataset.engagementType=c.school_entity?'school':(c.class_entity?'class':'course');card.dataset.engagementId=String(c.school_entity?c.application_id:(c.class_entity?(c.original_class_id||String(c.id).replace(/^school-class:/,'')):c.id));card.dataset.engagementOwner=String(c.owner_id||c.ownerId||'');const imageUrl=c.banner_url||c.banner_display_url||'';if(c.school_entity){const media=node('div',undefined,'school-brand-media');media.style.cssText='display:flex;align-items:center;gap:12px;width:100%;margin:0 0 12px;min-width:0';if(c.logo_display_url){const logo=node('img');logo.src=c.logo_display_url;logo.alt=(c.host_name||c.title||'School')+' logo';logo.loading='lazy';logo.style.cssText='width:76px;height:76px;flex:0 0 76px;object-fit:contain;border-radius:14px;background:#fff;border:1px solid #eee5fb;padding:5px';logo.onerror=()=>logo.remove();media.append(logo)}if(imageUrl){const banner=node('img');banner.src=imageUrl;banner.alt=(c.title||'School / institute')+' banner';banner.loading='lazy';banner.style.cssText='display:block;width:calc(100% - 88px);height:100px;min-width:0;flex:1;object-fit:cover;border-radius:12px';banner.onerror=()=>banner.remove();media.append(banner)}if(media.childElementCount)card.append(media)}else{if(imageUrl){const banner=node('img');banner.src=imageUrl;banner.alt=(c.title||'Learning opportunity')+' banner';banner.loading='lazy';banner.style.cssText='width:100%;height:150px;object-fit:cover;border-radius:11px;margin-bottom:5px';banner.onerror=()=>banner.remove();card.append(banner)}if(c.logo_display_url){const logo=node('img');logo.src=c.logo_display_url;logo.alt=(c.host_name||'School')+' logo';logo.loading='lazy';logo.style.cssText='width:56px;height:56px;object-fit:contain;border-radius:12px;background:#fff';logo.onerror=()=>logo.remove();card.append(logo)}}card.append(node('span',c.school_entity?'SCHOOL / INSTITUTE':c.class_entity?'SCHOOL CLASS':c.category||'COURSE','course-badge'));const title=node('h3',c.title);title.style.cssText='display:flex;align-items:center;flex-wrap:wrap;gap:7px';if(c.verified_organization){const badge=node('span','✓ Verified','joint-verified-badge');badge.title='Approved organization';badge.setAttribute('aria-label','Verified organization');badge.style.cssText='display:inline-flex;align-items:center;white-space:nowrap;padding:4px 8px;border-radius:999px;background:#e8f7ee;color:#137a3f;font-size:12px;font-weight:800;border:1px solid #bce7cb';title.append(badge)}card.append(title);card.append(node('p',c.description||''));card.append(node('p',(c.host_name||'JOINT host')+' · '+(c.country||'')+(c.state?', '+c.state:''),'course-meta'));if(c.school_entity||c.class_entity){card.append(node('p',[c.city,c.state,c.country].filter(Boolean).join(', '),'course-meta'));const actions=node('div',undefined,'course-buttons');addShareButton(actions,c);const browse=node('button',c.school_entity?'Explore school / institute':'View class','btn');browse.type='button';browse.onclick=()=>openDetail(c,db,uid,enroll,saved,render);actions.append(browse);if(c.owner_id&&c.owner_id!==uid){const msg=node('a','Message admin','btn secondary');msg.href='conversation.html?user='+encodeURIComponent(c.owner_id);msg.style.cssText='font-size:.82rem;padding:8px 11px;min-height:0;display:inline-flex;align-items:center;justify-content:center;text-decoration:none';actions.append(msg)}card.append(actions);box.append(card);continue}const priceDisplay=node('p',Number(c.price)>0?'Paid · '+formatMoney(c.price,c.currency||'NGN'):'Free to join','course-price');card.append(priceDisplay);if(Number(c.price)>0)addCourseCurrencyEstimate(priceDisplay,c,db,preferredCurrency);const actions=node('div',undefined,'course-buttons');addShareButton(actions,c);const sb=node('button',saved.has(c.id)?'★ Saved':'☆ Save','btn secondary');sb.type='button';sb.onclick=async()=>{sb.disabled=true;try{if(saved.has(c.id)){const r=await db.from('joint_course_saves').delete().eq('user_id',uid).eq('course_id',c.id);if(r.error)throw r.error;saved.delete(c.id)}else{const r=await db.from('joint_course_saves').insert({user_id:uid,course_id:c.id});if(r.error)throw r.error;saved.add(c.id)}render()}catch(err){alert('Could not update saved course: '+err.message);sb.disabled=false}};actions.append(sb);const status=enroll.get(c.id);const activeEnrollment=['joined','enrolled','completed'].includes(status);const actionLabel=activeEnrollment?'Continue learning':status==='pending_payment'?'Payment pending':(Number(c.price)>0?'Enroll':'Join');const join=node('button',actionLabel,'btn');join.type='button';join.style.cssText='width:100%;';if(status==='pending_payment')join.disabled=true;join.onclick=async()=>{if(activeEnrollment){openDetail(c,db,uid,enroll,saved,render);return}if(status==='pending_payment')return;if(Number(c.price)>0){await openCourseCheckout(c,db,uid,enroll,saved,render);return}join.disabled=true;try{const r=await db.from('joint_course_enrollments').insert({user_id:uid,course_id:c.id,status:'joined'});if(r.error)throw r.error;enroll.set(c.id,'joined');try{await ensureCourseSaved(db,uid,c.id,saved)}catch(saveError){console.warn('Course joined but automatic save could not be recorded:',saveError)}render()}catch(err){alert('Could not join: '+err.message);join.disabled=false}};actions.append(join);if(c.owner_id&&c.owner_id!==uid){const msg=node('a','Message admin','btn secondary');msg.href='conversation.html?user='+encodeURIComponent(c.owner_id);msg.style.cssText='font-size:.82rem;padding:8px 11px;min-height:0;display:inline-flex;align-items:center;justify-content:center;text-decoration:none';actions.append(msg)}card.append(actions);box.append(card)}
 if(view==='discover'){
   try{
     const pr=await db.rpc('joint_get_eligible_school_promotions',{p_source:'courses'});
     if(!pr.error){
       for(const promo of (pr.data||[]).slice(0,4)){
         if(!promo||!promo.id)continue;
         const targets=Array.isArray(promo.targets)?promo.targets:[];
         const t=targets.find(x=>x&&typeof x==='object')||{};
         const kind=String(t.kind||'').toLowerCase();
         const courseId=t.course_id||((kind==='course')?t.key:null);
         const schoolId=t.application_id||((kind.includes('school')||kind.includes('institute'))?t.key:null);
         const baseHref=courseId?'classes.html?course='+encodeURIComponent(courseId):schoolId?'classes.html?schoolId='+encodeURIComponent(schoolId):'classes.html';const href=baseHref+(baseHref.includes('?')?'&':'?')+'joint_promotion_view='+encodeURIComponent(promo.id);
         const card=node('article',undefined,'course-card');card.style.border='2px solid #d7c4fb';card.style.background='linear-gradient(135deg,#fff,#fbf8ff)';card.dataset.paidCoursePromo=String(promo.id);
         const targetItem=courseId?all.find(x=>!x.school_entity&&!x.class_entity&&String(x.id)===String(courseId)):schoolId?all.find(x=>x.school_entity&&String(x.application_id)===String(schoolId)):null;
         const schoolForCourse=targetItem?.application_id?all.find(x=>x.school_entity&&String(x.application_id)===String(targetItem.application_id)):null;
         const promoBanner=targetItem?.banner_display_url||targetItem?.banner_url||targetItem?.banner_path||schoolForCourse?.banner_display_url||schoolForCourse?.banner_url||'';
         const promoLogo=targetItem?.logo_display_url||schoolForCourse?.logo_display_url||'';
         if(promoBanner){const im=node('img');im.src=promoBanner;im.alt=(targetItem?.title||promo.name||'Promotion')+' banner';im.loading='lazy';im.style.cssText='display:block;width:100%;max-height:200px;object-fit:cover;border-radius:12px;margin:0 0 10px';im.onerror=()=>im.remove();card.append(im)}
         if(promoLogo){const im=node('img');im.src=promoLogo;im.alt=(targetItem?.host_name||targetItem?.title||'School')+' profile';im.loading='lazy';im.style.cssText='width:58px;height:58px;object-fit:contain;border-radius:13px;background:#fff;border:1px solid #eee5fb;padding:4px;margin:0 0 8px';im.onerror=()=>im.remove();card.append(im)}
         card.append(node('span','SPONSORED','course-badge'));card.append(node('h3',targetItem?.title||promo.name||'Promoted school / course'));card.append(node('p',targetItem?.description||'Sponsored school, institute or course selected for an eligible audience.'));card.append(node('p',(promo.targeting?.countries||[]).join(', ')||'Selected audience','course-meta'));
         const link=node('a','Explore promotion →','btn');link.href=href;link.style.textAlign='center';link.addEventListener('click',async ev=>{ev.preventDefault();if(link.dataset.tracking==='1')return;link.dataset.tracking='1';link.setAttribute('aria-disabled','true');const destination=link.href;try{const r=await db.rpc('joint_track_school_promotion_event',{p_promotion_id:promo.id,p_event_type:'click',p_source:'courses',p_metadata:{placement:'courses_feed'}});if(r.error)console.warn('Promotion click tracking failed:',r.error.message)}catch(trackError){console.warn('Promotion click tracking failed:',trackError)}finally{location.href=destination}});card.append(link);box.append(card);
         if('IntersectionObserver' in window&&!paidCoursePromoImpressions.has(String(promo.id))){const io=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){paidCoursePromoImpressions.add(String(promo.id));db.rpc('joint_track_school_promotion_event',{p_promotion_id:promo.id,p_event_type:'impression',p_source:'courses',p_metadata:{placement:'courses_feed'}}).then(r=>{if(r.error)console.warn('Promotion impression tracking failed:',r.error.message)});io.disconnect()}})},{threshold:.35});io.observe(card)}
       }
     }else console.warn('Sponsored courses unavailable; apply joint-school-promotion-delivery.sql:',pr.error.message);
   }catch(promoError){console.warn('Sponsored courses unavailable:',promoError)}
 }
 }
 $('class-search-form').addEventListener('submit',e=>{e.preventDefault();render()});['class-search','filter-country','filter-state'].forEach(id=>$(id).addEventListener('input',render));const params=new URLSearchParams(location.search);if(params.get('school'))$('class-search').value=params.get('school');if(params.get('q'))$('class-search').value=params.get('q');$('library-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;render()}});await render();const courseId=params.get('course'),schoolId=params.get('schoolId'),classId=params.get('class');if(courseId){const found=all.find(x=>!x.school_entity&&!x.class_entity&&String(x.id)===courseId);if(found)openDetail(found,db,uid,enroll,saved,render)}else if(classId){const found=all.find(x=>x.class_entity&&String(x.original_class_id)===classId);if(found)openDetail(found,db,uid,enroll,saved,render)}else if(schoolId){const found=all.find(x=>x.school_entity&&String(x.application_id)===schoolId);if(found)openDetail(found,db,uid,enroll,saved,render);else{$('class-search').value=schoolId;render()}}
}
async function learning(db,uid){const {data:en,error}=await db.from('joint_course_enrollments').select('course_id,status,created_at').eq('user_id',uid).in('status',['joined','enrolled','completed','pending_payment']).order('created_at',{ascending:false});if(error)throw error;const ids=(en||[]).map(x=>x.course_id);let courses=[];if(ids.length){const r=await db.from('joint_courses').select('id,title,category,level,description,content,price,currency').in('id',ids);if(r.error)throw r.error;courses=r.data||[]}const p=await db.from('joint_course_progress').select('course_id,completed_lesson_ids').eq('user_id',uid);if(p.error)throw p.error;const progress=new Map((p.data||[]).map(x=>[x.course_id,Array.isArray(x.completed_lesson_ids)?x.completed_lesson_ids:[]]));let totalDone=0,totalLessons=0;const box=$('my-course-list');box.replaceChildren();for(const c of courses){const content=c.content||{},mods=content.modules||[],lessons=mods.flatMap(m=>m.lessons||[]),done=new Set(progress.get(c.id)||[]),valid=lessons.filter(l=>l.id&&done.has(l.id)).length;totalDone+=valid;totalLessons+=lessons.length;const pct=lessons.length?Math.round(valid/lessons.length*100):0;const card=node('article',undefined,'course-card');card.append(node('span',c.category||'Learning','pill'));card.append(node('h3',c.title));card.append(node('p',c.description||''));card.append(node('p',valid+' of '+lessons.length+' lessons completed','course-meta'));const track=node('div',undefined,'progress-track'),fill=node('div',undefined,'progress-fill');fill.style.width=pct+'%';track.append(fill);card.append(track);card.append(node('strong',pct+'% complete'));if(en.find(x=>x.course_id===c.id)?.status==='pending_payment')card.append(node('p','Payment required before course access.','course-meta'));const btn=node('a','View course','learning-button');btn.href='classes.html?course='+encodeURIComponent(c.id);card.append(btn);box.append(card)}$('enrolled-count').textContent=courses.length;$('completed-count').textContent=totalDone;$('overall-progress').textContent=totalLessons?Math.round(totalDone/totalLessons*100)+'%':'0%';$('empty-learning').style.display=courses.length?'none':'block';$('learning-error').hidden=true}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
