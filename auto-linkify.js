/* JOINT URL recognition: clickable links in rendered text and previews for text inputs. */
(function(){
 'use strict';
 const URL_RE=/((?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,!?;:)\]])/gi;
 function safeUrl(raw){try{const u=new URL(/^www\./i.test(raw)?'https://'+raw:raw);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch(_){return null;}}
 function linkifyTextNode(node){
  if(!node||!node.parentNode||node.parentElement?.closest('a,button,script,style,textarea,input,select,option,code,pre,[contenteditable="true"],.joint-url-preview'))return;
  const text=node.nodeValue;if(!text||!URL_RE.test(text)){URL_RE.lastIndex=0;return;}URL_RE.lastIndex=0;
  const frag=document.createDocumentFragment();let last=0,m,changed=false;
  while((m=URL_RE.exec(text))){const href=safeUrl(m[0]);if(!href)continue;changed=true;frag.appendChild(document.createTextNode(text.slice(last,m.index)));const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.className='joint-detected-link';a.textContent=m[0];a.addEventListener('click',e=>e.stopPropagation());frag.appendChild(a);last=m.index+m[0].length;}
  if(!changed){URL_RE.lastIndex=0;return;}frag.appendChild(document.createTextNode(text.slice(last)));node.parentNode.replaceChild(frag,node);
 }
 function scan(root){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);nodes.forEach(linkifyTextNode);}
 function previewFor(input){
  if(input.dataset.jointUrlPreview==='1')return;input.dataset.jointUrlPreview='1';
  const box=document.createElement('div');box.className='joint-url-preview';box.setAttribute('aria-live','polite');box.hidden=false;
  input.insertAdjacentElement('afterend',box);
  const update=()=>{const val=(input.value||'').trim();const matches=val.match(URL_RE);box.replaceChildren();if(!matches){box.classList.remove('has-link');box.textContent='';return;}let added=false;matches.forEach(raw=>{const href=safeUrl(raw);if(!href)return;if(added)box.appendChild(document.createTextNode(' · '));const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=raw;a.addEventListener('click',e=>e.stopPropagation());box.appendChild(a);added=true;});box.classList.toggle('has-link',added);};
  input.addEventListener('input',update);input.addEventListener('change',update);update();
 }
 function setup(){
  scan(document.body);
  document.querySelectorAll('textarea,input:not([type="password"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])').forEach(previewFor);
  if(window.MutationObserver){const observer=new MutationObserver(records=>{for(const r of records){r.addedNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE)linkifyTextNode(n);else if(n.nodeType===Node.ELEMENT_NODE){scan(n);n.querySelectorAll?.('textarea,input:not([type="password"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])').forEach(previewFor);}});}});observer.observe(document.body,{childList:true,subtree:true});}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();