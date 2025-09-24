import { sendMessage } from '../../shared/messages';
import type { UserPreferences, LLMStatus } from '../../shared/types';
import styles from './styles.css?inline';
import { getRealtimePlaybackPositionMs } from '../playback-observer';

interface ControlPanelOptions {
  getPreferences: () => UserPreferences | null;
}

export class ControlPanel {
  #container: HTMLDivElement;
  #toggle: HTMLInputElement;
  #densitySelect: HTMLSelectElement;
  #personaCheckboxes = new Map<string, HTMLInputElement>();
  #regenerateButton: HTMLButtonElement;
  #statusText: HTMLSpanElement;
  #llmStatusBadge: HTMLSpanElement;
  #collapsed = false;

  constructor({ getPreferences }: ControlPanelOptions) {
    this.#container = document.createElement('div');
    this.#container.className = 'danmaku-control-panel';

    const styleTag = document.createElement('style');
    styleTag.textContent = styles;
    this.#container.appendChild(styleTag);

    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('span');
    title.textContent = 'AI Danmaku';
    header.appendChild(title);

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'panel-collapse';
    collapseBtn.textContent = '≡';
    collapseBtn.addEventListener('click', () => this.#toggleCollapsed());
    header.appendChild(collapseBtn);

    this.#container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'panel-body';
    this.#container.appendChild(body);

    // Global toggle
    const toggleRow = document.createElement('label');
    toggleRow.className = 'panel-row switch-row';
    toggleRow.textContent = '启用弹幕';
    this.#toggle = document.createElement('input');
    this.#toggle.type = 'checkbox';
    this.#toggle.addEventListener('change', () => {
      sendMessage({
        type: 'UPDATE_PREFERENCES',
        preferences: { globalEnabled: this.#toggle.checked }
      });
    });
    toggleRow.appendChild(this.#toggle);
    body.appendChild(toggleRow);

    // Density
    const densityRow = document.createElement('label');
    densityRow.className = 'panel-row';
    densityRow.textContent = '弹幕密度';
    this.#densitySelect = document.createElement('select');
    ['low', 'medium', 'high'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent =
        value === 'low' ? '低' : value === 'medium' ? '中' : '高';
      this.#densitySelect.appendChild(option);
    });
    this.#densitySelect.addEventListener('change', () => {
      sendMessage({
        type: 'UPDATE_PREFERENCES',
        preferences: { density: this.#densitySelect.value as UserPreferences['density'] }
      });
    });
    densityRow.appendChild(this.#densitySelect);
    body.appendChild(densityRow);

    // Personas
    const personaGroup = document.createElement('div');
    personaGroup.className = 'panel-row persona-group';
    personaGroup.innerHTML = '<strong>虚拟观众</strong>';
    body.appendChild(personaGroup);

    const personas: Array<{ id: string; label: string }> = [
      { id: 'alex', label: 'Alex' },
      { id: 'jordan', label: 'Jordan' },
      { id: 'sam', label: 'Sam' },
      { id: 'casey', label: 'Casey' }
    ];

    personas.forEach((persona) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'persona-toggle';
      wrapper.textContent = persona.label;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => {
        sendMessage({
          type: 'UPDATE_PREFERENCES',
          preferences: {
            personaEnabled: {
              [persona.id]: checkbox.checked
            }
          }
        });
      });
      wrapper.appendChild(checkbox);
      personaGroup.appendChild(wrapper);
      this.#personaCheckboxes.set(persona.id, checkbox);
    });

    // Regenerate button
    this.#regenerateButton = document.createElement('button');
    this.#regenerateButton.type = 'button';
    this.#regenerateButton.className = 'panel-button';
    this.#regenerateButton.textContent = '重新生成';
    this.#regenerateButton.addEventListener('click', () => {
      const positionMs = getRealtimePlaybackPositionMs();
      sendMessage({ type: 'REGENERATE_FROM_TIMESTAMP', timestamp: positionMs });
      this.setStatus('重新生成请求已发送');
      window.setTimeout(() => this.setStatus(''), 2000);
    });
    body.appendChild(this.#regenerateButton);

    this.#statusText = document.createElement('span');
    this.#statusText.className = 'panel-status';
    body.appendChild(this.#statusText);

    const llmStatusRow = document.createElement('div');
    llmStatusRow.className = 'panel-status-row';
    const llmLabel = document.createElement('span');
    llmLabel.textContent = 'LLM 状态';
    llmStatusRow.appendChild(llmLabel);
    this.#llmStatusBadge = document.createElement('span');
    this.#llmStatusBadge.className = 'panel-status-badge status-ok';
    this.#llmStatusBadge.textContent = '正常';
    llmStatusRow.appendChild(this.#llmStatusBadge);
    body.appendChild(llmStatusRow);

    document.body.appendChild(this.#container);

    const prefs = getPreferences();
    if (prefs) {
      this.update(prefs);
    }
  }

  update(preferences: UserPreferences) {
    this.#toggle.checked = preferences.globalEnabled;
    this.#densitySelect.value = preferences.density;
    for (const [personaId, input] of this.#personaCheckboxes.entries()) {
      input.checked = Boolean(preferences.personaEnabled[personaId]);
    }
    this.#container.classList.toggle('panel-disabled', !preferences.globalEnabled);
  }

  setStatus(text: string) {
    this.#statusText.textContent = text;
  }

  setLLMStatus(status: LLMStatus) {
    const labels: Record<LLMStatus['level'], string> = {
      ok: '正常',
      degraded: '降级',
      error: '错误'
    };
    const level = status.level;
    this.#llmStatusBadge.textContent = labels[level] ?? level;
    this.#llmStatusBadge.className = `panel-status-badge status-${level}`;
    this.#llmStatusBadge.title = status.detail ?? '';
  }

  #toggleCollapsed() {
    this.#collapsed = !this.#collapsed;
    this.#container.classList.toggle('panel-collapsed', this.#collapsed);
  }
}

let controlPanel: ControlPanel | null = null;

export function ensureControlPanel(options: ControlPanelOptions) {
  if (!controlPanel) {
    controlPanel = new ControlPanel(options);
  }
  return controlPanel;
}
