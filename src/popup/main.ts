import './style.css';
import { sendMessage, type RuntimeMessage } from '../shared/messages';
import type { UserPreferences, FeedbackCategory } from '../shared/types';

let currentPreferences: UserPreferences | null = null;

function render(root: HTMLDivElement) {
  if (!currentPreferences) {
    root.innerHTML = '<p class="loading">加载设置中…</p>';
    return;
  }

  const personas = Object.entries(currentPreferences.personaEnabled);

  root.innerHTML = `
    <header class="app-header">
      <h1>Netflix AI Danmaku</h1>
      <p class="app-subtitle">管理扩展设置</p>
    </header>
    <section class="section">
      <label class="row">
        <span>启用弹幕</span>
        <input type="checkbox" id="toggle" ${currentPreferences.globalEnabled ? 'checked' : ''} />
      </label>
      <label class="row">
        <span>弹幕密度</span>
        <select id="density">
          <option value="low" ${currentPreferences.density === 'low' ? 'selected' : ''}>低</option>
          <option value="medium" ${currentPreferences.density === 'medium' ? 'selected' : ''}>中</option>
          <option value="high" ${currentPreferences.density === 'high' ? 'selected' : ''}>高</option>
        </select>
      </label>
    </section>
    <section class="section personas">
      <h2>虚拟观众</h2>
      <div class="persona-list">
        ${personas
          .map(
            ([personaId, enabled]) => `
              <label>
                <input type="checkbox" data-persona="${personaId}" ${enabled ? 'checked' : ''} />
                <span>${personaId}</span>
              </label>
            `
          )
          .join('')}
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
        ${currentPreferences.developerMode ? '关闭开发者模式' : '开启开发者模式'}
      </button>
    </footer>
  `;

  const toggle = root.querySelector<HTMLInputElement>('#toggle');
  toggle?.addEventListener('change', () => {
    sendMessage({ type: 'UPDATE_PREFERENCES', preferences: { globalEnabled: toggle.checked } });
  });

  const density = root.querySelector<HTMLSelectElement>('#density');
  density?.addEventListener('change', () => {
    sendMessage({
      type: 'UPDATE_PREFERENCES',
      preferences: { density: density.value as UserPreferences['density'] }
    });
  });

  root.querySelectorAll<HTMLInputElement>('.persona-list input[type="checkbox"]').forEach((checkbox) => {
    const personaId = checkbox.dataset.persona;
    if (!personaId) {
      return;
    }
    checkbox.addEventListener('change', () => {
      sendMessage({
        type: 'UPDATE_PREFERENCES',
        preferences: {
          personaEnabled: {
            [personaId]: checkbox.checked
          }
        }
      });
    });
  });

  const devModeBtn = root.querySelector<HTMLButtonElement>('#dev-mode');
  devModeBtn?.addEventListener('click', () => {
    sendMessage({
      type: 'UPDATE_PREFERENCES',
      preferences: { developerMode: !currentPreferences?.developerMode }
    });
  });

  root
    .querySelectorAll<HTMLButtonElement>('.feedback-button')
    .forEach((button) => {
      const category = button.dataset.feedback as FeedbackCategory | undefined;
      if (!category) {
        return;
      }
      const original = button.textContent ?? '';
      button.addEventListener('click', async () => {
        button.disabled = true;
        await sendMessage({
          type: 'SUBMIT_USER_FEEDBACK',
          feedback: { category }
        });
        button.textContent = '已记录';
        setTimeout(() => {
          button.disabled = false;
          button.textContent = original;
        }, 1600);
      });
    });
}

async function init() {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) {
    return;
  }

  const message = await sendMessage({ type: 'REQUEST_PREFERENCES' });
  if (message?.type === 'PREFERENCES_RESPONSE') {
    currentPreferences = message.preferences;
    render(root);
  }

  chrome.runtime.onMessage.addListener((runtimeMessage: RuntimeMessage) => {
    if (runtimeMessage.type === 'PREFERENCES_RESPONSE') {
      currentPreferences = runtimeMessage.preferences;
      render(root);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
