/* JOINT shared comment sticker picker: inserts a free sticker into the existing comment field. */
(function(){
  const stickers=['❤️','😂','🥰','🎉','👏','🔥','🌟','🤗','💯','😊','😍','😘','🥳','🤩','💖','💝','💞','💫','✨','🌈','🫶','🙌','😎','🥹','😻','💌','🍀','🎈','🧡','💜','💙','💚','💛','🤍','🖤','🌸','🌻','🌺','🌷','🍓','🍒','🍉','🍕','☕','🎂','🎁','🎊','🦄','🐼','🐸','🐶','🐱','🐻','🐰','🦊','🦋','🐢','🐙','🌹','🍎','🍇','🍑','🍟','🍩','🍦','🥑','⚽','🏀','🎯','🎸','🎧','🎨','💐','💘','💓','💗','🫂','🤝','🙏','✌️','💪','🙈','🤯','🤔','😴','👻','🤖','🎃','🫡','🫠','👋','👀','🐣','🦆','🐳','🐘','🌞','🌙','⚡','🌊','❄️','🌱','🍃','🍋','🍍','🥝','🥥','🫐','🍿','🍪','🧋','🍜','🍣','🍔','🌮','🥐','🎀','🧸','🧩','🎲','🏅','📸','💬'];
  function attach(input){
    if(!input || input.dataset.jointStickerReady) return;
    input.dataset.jointStickerReady='1';
    const form=input.closest('form'); if(!form) return;
    const plus=document.createElement('button'); plus.type='button';plus.textContent='+';
    plus.setAttribute('aria-label','Add sticker');plus.style.cssText='flex:0 0 36px;width:36px;height:36px;border:0;border-radius:50%;background:#eee5ff;color:#5424b5;font-size:22px;font-weight:900;cursor:pointer';
    const panel=document.createElement('div');panel.hidden=true;panel.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;height:50vh;max-height:50vh;overflow:auto;box-sizing:border-box;padding:14px 14px calc(14px + env(safe-area-inset-bottom));border-top:1px solid #e5daf5;border-radius:18px 18px 0 0;background:#fff;box-shadow:0 -10px 35px #20133130;display:none;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px';
    const header=document.createElement('div');header.style.cssText='grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;font-weight:800;color:#241735';header.append('Stickers');
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close sticker picker');close.style.cssText='border:0;background:#f3eef9;border-radius:50%;width:32px;height:32px;font-size:24px';close.onclick=()=>{panel.hidden=true;panel.style.display='none'};header.append(close);panel.append(header);
    stickers.forEach(s=>{const b=document.createElement('button');b.type='button';b.textContent=s;b.title='Sticker '+s;b.style.cssText='aspect-ratio:1;border:1px solid #e8e0f2;border-radius:10px;background:#fff;font-size:23px';b.onclick=()=>{input.value=(input.value?input.value+' ':'')+s;input.focus();panel.hidden=true;panel.style.display='none'};panel.append(b)});
    plus.onclick=()=>{const open=panel.hidden;panel.hidden=!open;panel.style.display=open?'grid':'none';if(open)panel.scrollTop=0};
    form.insertBefore(plus,input);form.append(panel);
  }
  function scan(){document.querySelectorAll('.mp-comment-form input, .comment-form input').forEach(attach)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
