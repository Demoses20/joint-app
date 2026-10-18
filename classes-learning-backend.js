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
function appendCourseOutline(box, text, fallback) {
  const raw = String(text || fallback || '').trim();
  const card = node('div');
  card.style.cssText = 'margin:10px 0 14px;padding:14px 15px;background:#faf7ff;border:1px solid #e7dcf7;border-left:4px solid #7540cf;border-radius:13px;color:#393047;font-size:1.02rem;font-weight:600;line-height:1.7;overflow-wrap:anywhere';
  if (!raw) {
    const p = node('p', 'The host will provide a course outline. Detailed learning studios become available after you join or enrol.');
    p.style.cssText = 'margin:0;font-weight:500;line-height:1.65'; card.append(p); box.append(card); return;
  }
  let entries = raw.split(/\n+|[,;•]+/).map(x => x.trim()).filter(Boolean);
  // Short, space-separated subject lists (e.g. "English Maths Physics") are
  // presented as tidy chips. Longer prose remains intact and readable.
  if (entries.length === 1 && !/[.!?]/.test(raw) && raw.split(/\s+/).length >= 2 && raw.split(/\s+/).length <= 12) {
    entries = raw.split(/\s+/).filter(Boolean);
  }
  if (entries.length > 1) {
    const list = node('div');
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:0';
    entries.forEach(value => {
      const chip = node('span', value);
      chip.style.cssText = 'display:inline-flex;align-items:center;padding:7px 11px;background:#eee5ff;border:1px solid #ddcafa;border-radius:10px;color:#4d278e;font-size:.98rem;font-weight:700;line-height:1.35;max-width:100%;overflow-wrap:anywhere';
      list.append(chip);
    });
    card.append(list);
  } else {
    raw.split(/\n+/).filter(Boolean).forEach(line => {
      const p = node('p', line.trim()); p.style.cssText = 'margin:0 0 8px;font-weight:600;line-height:1.7;white-space:pre-wrap'; card.append(p);
    });
  }
  box.append(card);
}
// Public course previews should show top-level paths, not continuation paths.
// Legacy records sometimes stored a continuation (for example "English") as a
// separate module without a parent ID, so detect explicit parent markers and
// obvious shorter-title duplicates ("English" under "English language").
function outlineTitle(entry){return String(typeof entry==='string'?entry:(entry?.title||entry?.name||'')).trim()}
function hasParentPath(entry){
  if(!entry||typeof entry!=='object')return false;
  if(entry.isContinuation===true||entry.is_continuation===true||entry.continuation===true||entry.continuation_path===true)return true;
  return ['parentId','parent_id','parentPathId','parent_path_id','parentModuleId','parent_module_id','parentPath','parent_path','continuationOf','continuation_of','parentTitle','parent_title'].some(k=>entry[k]!==undefined&&entry[k]!==null&&String(entry[k]).trim()!=='');
}
function isContinuationPath(entry,allEntries){
  if(hasParentPath(entry))return true;
  const title=outlineTitle(entry).toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  if(!title)return false;
  const words=title.split(/\s+/).filter(Boolean);
  return allEntries.some(other=>{
    if(other===entry)return false;
    const otherTitle=outlineTitle(other).toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if(!otherTitle||otherTitle===title)return false;
    const otherWords=otherTitle.split(/\s+/).filter(Boolean);
    return words.length<otherWords.length&&words.every(word=>otherWords.includes(word));
  });
}
function publicOutlineEntries(entries,isEnrolled){
  const list=Array.isArray(entries)?entries:[];
  return isEnrolled?list:list.filter(entry=>!isContinuationPath(entry,list));
}
function ensureDetailModal() {
  let modal = $('learning-detail-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'learning-detail-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'learning-detail-title');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(24,18,38,.72);padding:clamp(4px,1.5vw,12px);overflow:hidden;display:none;align-items:center;justify-content:center';
  modal.innerHTML = '<section style="position:relative;background:#fff;color:#211b2b;border-radius:18px;padding:clamp(12px,3vw,22px);width:min(100%,900px);height:min(96dvh,100%);max-height:96dvh;overflow:auto;overscroll-behavior:contain;box-shadow:0 20px 70px rgba(0,0,0,.25)"><button type="button" id="learning-detail-close" aria-label="Close details" style="position:sticky;top:0;float:right;z-index:5;border:0;border-radius:10px;padding:8px 12px;background:#f0e8ff;color:#5424b5;font-size:1.1rem">✕</button><div id="learning-detail-content" style="font-size:clamp(1rem,2.8vw,1.2rem);line-height:1.7;overflow-wrap:anywhere"></div></section>';
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
    // A paid enrolment that is still pending must not unlock the learning studios.
    const enrollmentStatus = enroll.get(item.id);
    const enrolledAlready = ['joined', 'enrolled', 'completed'].includes(String(enrollmentStatus || '').toLowerCase());
    const paymentPending = String(enrollmentStatus || '').toLowerCase() === 'pending_payment';
    const publicOutline = String(course.publicOutline || course.public_outline || '').trim();
    box.append(node('h3', 'Course outline'));
    if (!enrolledAlready) {
      // Public preview intentionally shows only the host-authored course overview.
      // Do not leak path names, lesson titles, chapter schedules, quizzes or assignments.
      appendCourseOutline(box, publicOutline, course.description || item.description);
      const availabilityNote = node('p', 'Individual subjects and scheduled lessons are revealed after enrolment as they become available.', 'course-meta'); availabilityNote.style.cssText = 'font-size:.98rem;line-height:1.65;font-weight:500;margin-top:10px'; box.append(availabilityNote);
    } else {
      appendCourseOutline(box, publicOutline, course.description || item.description || 'Your learning studios are listed below.');
      const now = Date.now();
      let visibleLessonCount = 0;
      modules.forEach(function (module, moduleIndex) {
        const availableLessons = (module.lessons || []).filter(function (lesson) {
          const startValue = lesson.releaseAt || lesson.startsAt || lesson.startAt || lesson.start_date || lesson.startDate || lesson.opensAt || '';
          const endValue = lesson.availableUntil || lesson.endsAt || lesson.endAt || lesson.end_date || lesson.endDate || lesson.closesAt || '';
          const start = startValue ? new Date(startValue).getTime() : NaN;
          const end = endValue ? new Date(endValue).getTime() : NaN;
          if (Number.isFinite(start) && now < start) return false;
          if (Number.isFinite(end) && now > end) return false;
          return true;
        });
        if (!availableLessons.length) return;
        visibleLessonCount += availableLessons.length;
        const section = node('section');
        section.style.cssText = 'padding:12px;margin:8px 0;background:#faf7ff;border:1px solid #eee5fb;border-radius:10px';
        section.append(node('strong', module.title || module.name || ('Learning path ' + (moduleIndex + 1))));
        availableLessons.forEach(function (lesson, lessonIndex) {
          const lessonCard = node('article');
          lessonCard.style.cssText = 'margin:12px 0 0;padding:clamp(12px,3vw,20px);background:#fff;border:1px solid #e5d8f7;border-left:5px solid #7540cf;border-radius:16px;box-shadow:0 5px 18px rgba(60,30,100,.06);width:100%;box-sizing:border-box';
          const lessonTitle = node('h3', (lessonIndex + 1) + '. ' + (lesson.title || lesson.name || 'Lesson'));
          lessonTitle.style.cssText = 'font-size:clamp(1.2rem,4vw,1.6rem);line-height:1.35;margin:0 0 10px;color:#38215e';
          lessonCard.append(lessonTitle);
          if (lesson.content) { const intro = node('p', lesson.content); intro.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:1.05em;line-height:1.8;margin:8px 0 14px'; lessonCard.append(intro); }
          const blocks = Array.isArray(lesson.contentBlocks) ? lesson.contentBlocks : [];
          blocks.forEach(function (block, blockIndex) {
            const content = node('div'); content.style.cssText = 'margin:14px 0;padding:12px;background:#fbf9ff;border:1px solid #eee5fb;border-radius:12px;overflow-wrap:anywhere';
            if (block.text) { const textBlock = node('p', block.text); textBlock.style.cssText = 'white-space:pre-wrap;font-size:1.04em;line-height:1.85;margin:0'; content.append(textBlock); }
            const url = String(block.url || '').trim();
            if (url && /^https?:\/\//i.test(url)) {
              if (block.type === 'image' || block.type === 'image-upload') {
                const image = node('img'); image.src = url; image.alt = lesson.title + ' learning image'; image.loading = 'lazy'; image.style.cssText = 'display:block;width:100%;max-height:65vh;object-fit:contain;border-radius:10px'; image.onerror = function(){ image.remove(); }; content.append(image);
              } else if (block.type === 'embed' && /(?:youtube\.com|youtu\.be)/i.test(url)) {
                let videoId = ''; try { const u = new URL(url); videoId = u.hostname.includes('youtu.be') ? u.pathname.slice(1) : (u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop()); } catch(e) {}
                if (videoId) { const frame = node('iframe'); frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId); frame.title = lesson.title + ' embedded video'; frame.loading = 'lazy'; frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true; frame.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:12px'; content.append(frame); }
                const link = node('a', 'Open YouTube video'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.cssText = 'display:inline-flex;margin-top:8px;color:#5d2fba;font-weight:800;overflow-wrap:anywhere'; content.append(link);
              } else if (block.type === 'video' || block.type === 'video-upload') {
                const video = node('video'); video.controls = true; video.preload = 'metadata'; video.playsInline = true; video.src = url; video.style.cssText = 'display:block;width:100%;max-height:65vh;background:#111;border-radius:12px'; content.append(video);
                const link = node('a', 'Open video in a new tab'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.cssText = 'display:inline-flex;margin-top:8px;color:#5d2fba;font-weight:800'; content.append(link);
              } else {
                const link = node('a', block.type === 'file-upload' ? ('Open file' + (block.fileName ? ': ' + block.fileName : '')) : (block.type === 'link' ? 'Open learning link' : 'Open learning resource'));
                link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 14px;background:#eee5ff;border-radius:10px;color:#5126a5;font-weight:800;overflow-wrap:anywhere;word-break:break-word'; link.textContent += ' ↗'; content.append(link);
                const urlText = node('p', url); urlText.style.cssText = 'font-size:.82em;color:#716a7c;overflow-wrap:anywhere;word-break:break-all;margin:8px 0 0'; content.append(urlText);
              }
            }
            if (content.childNodes.length) lessonCard.append(content);
          });
          const primaryVideo = String(lesson.video || '').trim();
          if (primaryVideo) { let videoId=''; try { const u=new URL(primaryVideo); videoId=u.hostname.includes('youtu.be')?u.pathname.slice(1):(u.searchParams.get('v')||''); } catch(e){} if(videoId){const frame=node('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(videoId);frame.title=lesson.title||'Lesson video';frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';frame.allowFullscreen=true;frame.style.cssText='display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin:12px 0';lessonCard.append(frame);} }
          if (lesson.resource && /^https?:\/\//i.test(lesson.resource)) { const resourceLink = node('a', 'Open learning material ↗'); resourceLink.href=lesson.resource; resourceLink.target='_blank'; resourceLink.rel='noopener noreferrer'; resourceLink.style.cssText='display:flex;padding:12px 14px;background:#eee5ff;border-radius:10px;color:#5126a5;font-weight:800;overflow-wrap:anywhere;margin:12px 0';lessonCard.append(resourceLink); }
          const hs = lesson.humanSettings || {};
          const assignmentItems = Array.isArray(hs.assignments) ? hs.assignments.filter(function(a){ const opens=a.opensAt?new Date(a.opensAt).getTime():NaN; const closes=a.deadline?new Date(a.deadline).getTime():NaN; const current=Date.now(); return (!Number.isFinite(opens)||current>=opens)&&(!Number.isFinite(closes)||current<=closes); }) : [];
          const aiAssignment = lesson.teachingMode === 'ai' && lesson.aiSettings && lesson.aiSettings.assignmentType && lesson.aiSettings.assignmentType !== 'none';
          if (assignmentItems.length || aiAssignment) {
            const assignmentPanel=node('section');assignmentPanel.style.cssText='margin-top:16px;padding:14px;background:#f3edff;border:1px solid #ddcafa;border-radius:14px';
            assignmentPanel.append(node('h4','＋ Assignment submission'));assignmentPanel.append(node('p',assignmentItems.length?'Upload your work for the assignment below. You can submit text, photos, videos or documents.':('This studio includes an assignment ('+String(lesson.aiSettings.assignmentType).replace(/_/g,' ')+'). Upload your work below.'),'course-meta'));
            (assignmentItems.length?assignmentItems:[{title:'Lesson assignment',instructions:'Submit your work for this lesson.'}]).forEach(function(assignment,assignmentIndex){
              const form=node('form');form.style.cssText='margin-top:12px;padding:12px;background:#fff;border:1px solid #e4d8f5;border-radius:12px';
              form.append(node('strong',assignment.title||('Assignment '+(assignmentIndex+1))));if(assignment.instructions)form.append(node('p',assignment.instructions));
              const answer=node('textarea');answer.placeholder='Write your answer or explain your work (optional)';answer.maxLength=20000;answer.style.cssText='width:100%;min-height:100px;box-sizing:border-box;padding:12px;border:1px solid #d9cfe9;border-radius:10px;font:inherit;margin:8px 0';form.append(answer);
              const fileInput=node('input');fileInput.type='file';fileInput.multiple=true;fileInput.accept='image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip';fileInput.style.cssText='display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #d9cfe9;border-radius:10px;background:#fff;margin:8px 0';form.append(fileInput);
              const status=node('p','Choose any photos, videos or files for this assignment.','course-meta');form.append(status);
              const submit=node('button','＋ Submit assignment','btn');submit.type='submit';submit.style.cssText='width:100%;margin-top:8px';form.append(submit);
              fileInput.addEventListener('change',function(){status.textContent=Array.from(fileInput.files||[]).map(function(f){return f.name+' ('+(f.size/1024/1024).toFixed(2)+' MB)'}).join(' · ')||'No files selected.';});
              form.addEventListener('submit',async function(ev){ev.preventDefault();const files=Array.from(fileInput.files||[]);if(!answer.value.trim()&&!files.length){status.textContent='Write an answer or attach at least one file before submitting.';return;}submit.disabled=true;submit.textContent='Uploading submission…';try{const authResult=await db.auth.getUser();if(authResult.error)throw authResult.error;if(!authResult.data.user)throw new Error('Please sign in again before submitting.');const urls=[];for(const file of files){if(file.size>100*1024*1024)throw new Error(file.name+' exceeds the 100 MB per-file limit.');const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const key=authResult.data.user.id+'/course-submissions/'+item.id+'/'+lesson.id+'/'+Date.now()+'-'+crypto.randomUUID()+'-'+safe;const upload=await db.storage.from('joint-learning-media').upload(key,file,{upsert:false,contentType:file.type||'application/octet-stream'});if(upload.error)throw upload.error;urls.push({name:file.name,url:db.storage.from('joint-learning-media').getPublicUrl(key).data.publicUrl});}const insert=await db.from('joint_course_submissions').insert({course_id:item.id,lesson_id:lesson.id,user_id:authResult.data.user.id,assignment_title:assignment.title||'Lesson assignment',answer_text:answer.value.trim(),file_urls:urls,status:'submitted',submitted_at:new Date().toISOString()});if(insert.error)throw insert.error;status.textContent='Assignment submitted successfully. Your host can review your submission.';form.reset();}catch(err){console.error(err);status.textContent='Could not submit assignment: '+(err.message||'Please check your connection and try again.');}finally{submit.disabled=false;submit.textContent='＋ Submit assignment';}});
              assignmentPanel.append(form);
            });
            lessonCard.append(assignmentPanel);
          }
          section.append(lessonCard);
        });
        box.append(section);
      });
      if (!visibleLessonCount) box.append(node('p', 'You are enrolled. Your next learning studio will appear here when its scheduled start time arrives.', 'course-meta'));
    }
    const actionLabel = enrolledAlready ? 'You are enrolled in this course' : (paymentPending ? 'Payment pending' : (Number(item.price) > 0 ? 'Enrol in course' : 'Join free course'));
    const action = node('button', actionLabel, 'btn');
    action.type = 'button'; action.style.cssText = 'width:100%;margin-top:14px';
    if (enrolledAlready || paymentPending) { action.disabled = true; action.style.opacity = '.8'; }
    action.onclick = async function () {
      if (enroll.has(item.id)) return;
      action.disabled = true;
      try {
        const result = await db.from('joint_course_enrollments').insert({ user_id: uid, course_id: item.id, status: Number(item.price) > 0 ? 'pending_payment' : 'joined' });
        if (result.error) throw result.error;
        enroll.set(item.id, Number(item.price) > 0 ? 'pending_payment' : 'joined');
        alert(Number(item.price) > 0 ? 'Your enrolment is pending payment. No payment has been charged.' : 'You joined this course.');
        closeDetail(); refresh();
        if (Number(item.price) === 0) openDetail(item, db, uid, enroll, saved, refresh);
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
