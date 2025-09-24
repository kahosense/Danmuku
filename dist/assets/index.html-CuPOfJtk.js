import{s as l}from"./messages-BoMeRyd0.js";(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))i(t);new MutationObserver(t=>{for(const e of t)if(e.type==="childList")for(const o of e.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function c(t){const e={};return t.integrity&&(e.integrity=t.integrity),t.referrerPolicy&&(e.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?e.credentials="include":t.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function i(t){if(t.ep)return;t.ep=!0;const e=c(t);fetch(t.href,e)}})();let s=null;function a(n){if(!s){n.innerHTML='<p class="loading">加载设置中…</p>';return}const r=Object.entries(s.personaEnabled);n.innerHTML=`
    <header class="app-header">
      <h1>Netflix AI Danmaku</h1>
      <p class="app-subtitle">管理扩展设置</p>
    </header>
    <section class="section">
      <label class="row">
        <span>启用弹幕</span>
        <input type="checkbox" id="toggle" ${s.globalEnabled?"checked":""} />
      </label>
      <label class="row">
        <span>弹幕密度</span>
        <select id="density">
          <option value="low" ${s.density==="low"?"selected":""}>低</option>
          <option value="medium" ${s.density==="medium"?"selected":""}>中</option>
          <option value="high" ${s.density==="high"?"selected":""}>高</option>
        </select>
      </label>
    </section>
    <section class="section personas">
      <h2>虚拟观众</h2>
      <div class="persona-list">
        ${r.map(([e,o])=>`
              <label>
                <input type="checkbox" data-persona="${e}" ${o?"checked":""} />
                <span>${e}</span>
              </label>
            `).join("")}
      </div>
    </section>
    <footer class="footer">
      <button id="dev-mode" class="button">
        ${s.developerMode?"关闭开发者模式":"开启开发者模式"}
      </button>
    </footer>
  `;const c=n.querySelector("#toggle");c?.addEventListener("change",()=>{l({type:"UPDATE_PREFERENCES",preferences:{globalEnabled:c.checked}})});const i=n.querySelector("#density");i?.addEventListener("change",()=>{l({type:"UPDATE_PREFERENCES",preferences:{density:i.value}})}),n.querySelectorAll('.persona-list input[type="checkbox"]').forEach(e=>{const o=e.dataset.persona;o&&e.addEventListener("change",()=>{l({type:"UPDATE_PREFERENCES",preferences:{personaEnabled:{[o]:e.checked}}})})}),n.querySelector("#dev-mode")?.addEventListener("click",()=>{l({type:"UPDATE_PREFERENCES",preferences:{developerMode:!s?.developerMode}})})}async function d(){const n=document.querySelector("#app");if(!n)return;const r=await l({type:"REQUEST_PREFERENCES"});r?.type==="PREFERENCES_RESPONSE"&&(s=r.preferences,a(n)),chrome.runtime.onMessage.addListener(c=>{c.type==="PREFERENCES_RESPONSE"&&(s=c.preferences,a(n))})}document.addEventListener("DOMContentLoaded",d);
