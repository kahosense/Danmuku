import{s as a}from"./messages-BONoywxy.js";(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))i(t);new MutationObserver(t=>{for(const e of t)if(e.type==="childList")for(const s of e.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&i(s)}).observe(document,{childList:!0,subtree:!0});function c(t){const e={};return t.integrity&&(e.integrity=t.integrity),t.referrerPolicy&&(e.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?e.credentials="include":t.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function i(t){if(t.ep)return;t.ep=!0;const e=c(t);fetch(t.href,e)}})();let o=null;function d(n){if(!o){n.innerHTML='<p class="loading">加载设置中…</p>';return}const r=Object.entries(o.personaEnabled);n.innerHTML=`
    <header class="app-header">
      <h1>Netflix AI Danmaku</h1>
      <p class="app-subtitle">管理扩展设置</p>
    </header>
    <section class="section">
      <label class="row">
        <span>启用弹幕</span>
        <input type="checkbox" id="toggle" ${o.globalEnabled?"checked":""} />
      </label>
      <label class="row">
        <span>弹幕密度</span>
        <select id="density">
          <option value="low" ${o.density==="low"?"selected":""}>低</option>
          <option value="medium" ${o.density==="medium"?"selected":""}>中</option>
          <option value="high" ${o.density==="high"?"selected":""}>高</option>
        </select>
      </label>
    </section>
    <section class="section personas">
      <h2>虚拟观众</h2>
      <div class="persona-list">
        ${r.map(([e,s])=>`
              <label>
                <input type="checkbox" data-persona="${e}" ${s?"checked":""} />
                <span>${e}</span>
              </label>
            `).join("")}
      </div>
    </section>
    <section class="section feedback">
      <h2>快速反馈</h2>
      <div class="feedback-buttons">
        <button class="button feedback-button" data-feedback="too_noisy">弹幕太多</button>
        <button class="button feedback-button" data-feedback="too_robotic">太像机器人</button>
        <button class="button feedback-button" data-feedback="great">很不错</button>
      </div>
    </section>
    <footer class="footer">
      <button id="dev-mode" class="button">
        ${o.developerMode?"关闭开发者模式":"开启开发者模式"}
      </button>
    </footer>
  `;const c=n.querySelector("#toggle");c?.addEventListener("change",()=>{a({type:"UPDATE_PREFERENCES",preferences:{globalEnabled:c.checked}})});const i=n.querySelector("#density");i?.addEventListener("change",()=>{a({type:"UPDATE_PREFERENCES",preferences:{density:i.value}})}),n.querySelectorAll('.persona-list input[type="checkbox"]').forEach(e=>{const s=e.dataset.persona;s&&e.addEventListener("change",()=>{a({type:"UPDATE_PREFERENCES",preferences:{personaEnabled:{[s]:e.checked}}})})}),n.querySelector("#dev-mode")?.addEventListener("click",()=>{a({type:"UPDATE_PREFERENCES",preferences:{developerMode:!o?.developerMode}})}),n.querySelectorAll(".feedback-button").forEach(e=>{const s=e.dataset.feedback;if(!s)return;const l=e.textContent??"";e.addEventListener("click",async()=>{e.disabled=!0,await a({type:"SUBMIT_USER_FEEDBACK",feedback:{category:s}}),e.textContent="已记录",setTimeout(()=>{e.disabled=!1,e.textContent=l},1600)})})}async function p(){const n=document.querySelector("#app");if(!n)return;const r=await a({type:"REQUEST_PREFERENCES"});r?.type==="PREFERENCES_RESPONSE"&&(o=r.preferences,d(n)),chrome.runtime.onMessage.addListener(c=>{c.type==="PREFERENCES_RESPONSE"&&(o=c.preferences,d(n))})}document.addEventListener("DOMContentLoaded",p);
