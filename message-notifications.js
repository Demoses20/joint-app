/* JOINT unread-message navigation badge. Uses the existing chat read-tracking tables. */
(async function(){
  'use strict';
  const clientPromise=window.jointSupabaseConnection;
  if(!clientPromise)return;
  let client;
  try{client=await clientPromise;}catch(_){return;}
  const links=Array.from(document.querySelectorAll('a[href]')).filter(a=>{
    const href=(a.getAttribute('href')||'').split('?')[0].split('#')[0];
    return href==='chat.html'||href.endsWith('/chat.html');
  });
  if(!links.length)return;
  let style=document.getElementById('joint-message-badge-style');
  if(!style){style=document.createElement('style');style.id='joint-message-badge-style';style.textContent=
    '.joint-message-nav-link{position:relative!important}.joint-message-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;margin-left:5px;border-radius:999px;background:#e83e69;color:#fff;font-size:11px;font-weight:800;line-height:1;vertical-align:middle}.bottom-nav .joint-message-count{position:absolute;top:0;right:12%;margin:0}.bottom-nav a{position:relative}';document.head.appendChild(style);}
  links.forEach(a=>a.classList.add('joint-message-nav-link'));
  function setCount(n){links.forEach(a=>{let b=a.querySelector('.joint-message-count');if(n>0){if(!b){b=document.createElement('span');b.className='joint-message-count';b.setAttribute('role','status');a.appendChild(b)}b.textContent=n>99?'99+':String(n);b.title=n+' unread message'+(n===1?'':'s');b.setAttribute('aria-label',n+' unread messages')}else if(b)b.remove()})}
  async function refresh(){try{
    const {data:ud,error:ue}=await client.auth.getUser();if(ue)throw ue;const user=ud.user;if(!user){setCount(0);return}
    const {data:convos,error:ce}=await client.from('joint_conversations').select('id').or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`).limit(500);if(ce)throw ce;
    const ids=(convos||[]).map(c=>c.id);if(!ids.length){setCount(0);return}
    const [mr,rr]=await Promise.all([
      client.from('joint_messages').select('conversation_id,sender_id,created_at').in('conversation_id',ids).neq('sender_id',user.id).order('created_at',{ascending:false}).limit(2000),
      client.from('joint_message_reads').select('conversation_id,last_read_at').eq('user_id',user.id).in('conversation_id',ids)
    ]);if(mr.error)throw mr.error;if(rr.error)throw rr.error;
    const readMap=new Map((rr.data||[]).map(r=>[r.conversation_id,r.last_read_at?new Date(r.last_read_at).getTime():0]));
    const unread=(mr.data||[]).filter(m=>new Date(m.created_at).getTime()>(readMap.get(m.conversation_id)||0)).length;
    setCount(unread);
  }catch(e){console.warn('JOINT unread-message badge could not refresh. Check chat table policies and migrations.',e)}}
  await refresh();window.setInterval(refresh,20000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
  window.addEventListener('joint:messages-read',refresh);window.addEventListener('joint:message-sent',refresh);
})();
