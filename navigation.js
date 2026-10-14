
document.addEventListener('DOMContentLoaded', () => {
  // Make the account avatar a real, accessible link to the profile page.
  // The profile details remain browser-local in this prototype unless the
  // authenticated profile backend is connected.
  document.querySelectorAll('.top-actions .avatar').forEach((avatar) => {
    let profileLink = avatar;
    if (avatar.tagName.toLowerCase() !== 'a') {
      profileLink = document.createElement('a');
      profileLink.className = avatar.className;
      profileLink.innerHTML = avatar.innerHTML;
      for (const attr of avatar.attributes) {
        if (attr.name !== 'class') profileLink.setAttribute(attr.name, attr.value);
      }
      avatar.replaceWith(profileLink);
    }
    profileLink.href = 'profile.html';
    profileLink.title = 'Open your profile';
    profileLink.setAttribute('aria-label', 'Open your profile');
    profileLink.style.cursor = 'pointer';

    try {
      const saved = JSON.parse(localStorage.getItem('joint_profile_demo_v2') || '{}');
      const name = String(saved.name || '').trim();
      if (name) {
        const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
        if (initials) profileLink.textContent = initials;
      }
      if (saved.avatar) {
        profileLink.style.backgroundImage = 'url("' + String(saved.avatar).replace(/"/g, '') + '")';
        profileLink.style.backgroundSize = 'cover';
        profileLink.style.backgroundPosition = 'center';
        profileLink.style.color = 'transparent';
      }
    } catch (_) {
      // Keep the default avatar if browser storage is unavailable.
    }
  });

  const showMessage = (text, target) => {
    if (target) { target.textContent = text; target.style.display = 'block'; }
    else {
      let notice = document.getElementById('demo-toast');
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'demo-toast';
        notice.style.cssText = 'position:fixed;left:50%;bottom:85px;transform:translateX(-50%);background:#24163d;color:#fff;padding:13px 18px;border-radius:12px;z-index:100;box-shadow:0 8px 28px #0002;max-width:90vw;text-align:center';
        document.body.appendChild(notice);
      }
      notice.textContent = text; notice.style.display = 'block';
      clearTimeout(window.jointToastTimer);
      window.jointToastTimer = setTimeout(() => notice.style.display = 'none', 2600);
    }
  };
  document.querySelectorAll('[data-demo]').forEach(el => el.addEventListener('click', () => showMessage(el.dataset.demo, document.getElementById('room-message'))));
  const formMessage = (formId, targetId, message) => {
    const form = document.getElementById(formId), target = document.getElementById(targetId);
    if (form) form.addEventListener('submit', e => { e.preventDefault(); showMessage(message, target); });
  };
  formMessage('meeting-form','meeting-success','Demo meeting created. Live room creation will be connected later.');
  formMessage('join-meeting-form','join-meeting-success','Code accepted for demo. Room access will be validated after backend integration.');
  formMessage('class-form','class-success','Demo class created. Class storage will be connected later.');
  formMessage('profile-form','profile-success','Demo profile changes saved on this screen.');
  formMessage('settings-form','settings-success','Demo preferences saved on this screen.');
  formMessage('room-chat-form',null,'Demo message sent.');
  formMessage('conversation-form',null,'Demo message sent.');
  const followButtons = document.querySelectorAll('.follow-btn');
  followButtons.forEach(btn => btn.addEventListener('click', () => {
    const following = btn.dataset.following === 'true';
    btn.dataset.following = String(!following);
    btn.textContent = following ? '＋ Follow' : '✓ Following';
    btn.classList.toggle('secondary', !following);
  }));
  document.querySelectorAll('.like-btn').forEach(btn => btn.addEventListener('click', () => {
    const liked = btn.classList.toggle('liked');
    const count = btn.querySelector('span');
    if (count) count.textContent = String(Math.max(0, Number(count.textContent) + (liked ? 1 : -1)));
    btn.firstChild.textContent = liked ? '♥ Unlike ' : '♡ Like ';
  }));
  const classSearch = document.getElementById('class-search');
  if (classSearch) classSearch.addEventListener('input', () => {
    let visible = 0;
    document.querySelectorAll('.class-card').forEach(card => {
      const match = card.textContent.toLowerCase().includes(classSearch.value.toLowerCase());
      card.classList.toggle('hide', !match); if (match) visible++;
    });
    document.getElementById('class-empty').classList.toggle('hide', visible > 0);
  });
  const friendSearch = document.getElementById('friend-search');
  if (friendSearch) friendSearch.addEventListener('input', () => document.querySelectorAll('.friend-card').forEach(card => card.classList.toggle('hide', !card.textContent.toLowerCase().includes(friendSearch.value.toLowerCase()))));
  const postForm = document.getElementById('post-form');
  if (postForm) postForm.addEventListener('submit', e => {
    e.preventDefault();
    const field = document.getElementById('post-content');
    const article = document.createElement('article');
    article.className = 'card feed-post';
    article.innerHTML = '<div class="post-head"><div class="avatar">JM</div><div class="grow"><strong>You</strong><small>Just now · Community</small></div><span class="pill">New post</span></div><div class="post-body"></div><div class="post-actions"><button class="like-btn">♡ Like <span>0</span></button><button data-demo="Comment area opened in this demo">💬 Comment</button><button data-demo="Post share options are not connected yet">↗ Share</button></div>';
    article.querySelector('.post-body').textContent = field.value;
    document.getElementById('timeline-posts').prepend(article);
    article.querySelector('.like-btn').addEventListener('click', function(){const liked=this.classList.toggle('liked');const span=this.querySelector('span');span.textContent=String(Number(span.textContent)+(liked?1:-1));this.firstChild.textContent=liked?'♥ Unlike ':'♡ Like ';});
    article.querySelectorAll('[data-demo]').forEach(el=>el.addEventListener('click',()=>showMessage(el.dataset.demo)));
    field.value = ''; showMessage('Your demo post was published.');
  });
  const convForm = document.getElementById('conversation-form');
  if (convForm) convForm.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('conversation-input');
    const bubble = document.createElement('div');
    bubble.className = 'notice'; bubble.style.cssText = 'max-width:80%;justify-self:end;background:#f1eaff;border-color:#e2d2ff;color:#39216b';
    bubble.textContent = input.value; document.getElementById('conversation-log').appendChild(bubble); input.value = '';
  });
  const roomForm = document.getElementById('room-chat-form');
  if (roomForm) roomForm.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('room-chat-input');
    const bubble = document.createElement('div'); bubble.className='notice'; bubble.textContent=input.value;
    document.getElementById('room-chat-log').appendChild(bubble); input.value='';
  });
});
