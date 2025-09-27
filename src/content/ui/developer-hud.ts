interface DeveloperStats {
  cues: number;
  comments: number;
  cacheHitRate: number;
  avgLLMLatencyMs: number;
  avgGenerationLatencyMs: number;
  cacheSizeActiveMb: number;
  cacheSizeGlobalMb: number;
  fallbackResponses: number;
  windowCommentTotal: number;
  activeLanes: number;
  segmentsGenerated: number;
  truncatedComments: number;
  avgCommentLength: number;
  dynamicBans: number;
  toneWarnings: number;
  hotwordReminders: number;
  keywordFilterRate: number;
  duplicateHardRejects: number;
  semanticRejects: number;
  lowRelevanceDrops: number;
  styleFitDrops: number;
}

export class DeveloperHUD {
  #container: HTMLDivElement;
  #stats: DeveloperStats = {
    cues: 0,
    comments: 0,
    cacheHitRate: 0,
    avgLLMLatencyMs: 0,
    avgGenerationLatencyMs: 0,
    cacheSizeActiveMb: 0,
    cacheSizeGlobalMb: 0,
    fallbackResponses: 0,
    windowCommentTotal: 0,
    activeLanes: 0,
    segmentsGenerated: 0,
    truncatedComments: 0,
    avgCommentLength: 0,
    dynamicBans: 0,
    toneWarnings: 0,
    hotwordReminders: 0,
    keywordFilterRate: 0,
    duplicateHardRejects: 0,
    semanticRejects: 0,
    lowRelevanceDrops: 0,
    styleFitDrops: 0
  };

  constructor() {
    this.#container = document.createElement('div');
    this.#container.className = 'danmaku-dev-hud';
    this.#container.innerHTML = this.#renderHTML();
    document.body.appendChild(this.#container);
  }

  update(partial: Partial<DeveloperStats>) {
    if (partial.cues !== undefined) {
      this.#stats.cues += partial.cues;
    }
    if (partial.comments !== undefined) {
      this.#stats.comments += partial.comments;
    }
    if (partial.cacheHitRate !== undefined) {
      this.#stats.cacheHitRate = partial.cacheHitRate;
    }
    if (partial.avgLLMLatencyMs !== undefined) {
      this.#stats.avgLLMLatencyMs = partial.avgLLMLatencyMs;
    }
    if (partial.avgGenerationLatencyMs !== undefined) {
      this.#stats.avgGenerationLatencyMs = partial.avgGenerationLatencyMs;
    }
    if (partial.cacheSizeActiveMb !== undefined) {
      this.#stats.cacheSizeActiveMb = partial.cacheSizeActiveMb;
    }
    if (partial.cacheSizeGlobalMb !== undefined) {
      this.#stats.cacheSizeGlobalMb = partial.cacheSizeGlobalMb;
    }
    if (partial.fallbackResponses !== undefined) {
      this.#stats.fallbackResponses = partial.fallbackResponses;
    }
    if (partial.windowCommentTotal !== undefined) {
      this.#stats.windowCommentTotal = partial.windowCommentTotal;
    }
    if (partial.activeLanes !== undefined) {
      this.#stats.activeLanes = partial.activeLanes;
    }
    if (partial.segmentsGenerated !== undefined) {
      this.#stats.segmentsGenerated = partial.segmentsGenerated;
    }
    if (partial.truncatedComments !== undefined) {
      this.#stats.truncatedComments = partial.truncatedComments;
    }
    if (partial.avgCommentLength !== undefined) {
      this.#stats.avgCommentLength = partial.avgCommentLength;
    }
    if (partial.dynamicBans !== undefined) {
      this.#stats.dynamicBans = partial.dynamicBans;
    }
    if (partial.toneWarnings !== undefined) {
      this.#stats.toneWarnings = partial.toneWarnings;
    }
    if (partial.hotwordReminders !== undefined) {
      this.#stats.hotwordReminders = partial.hotwordReminders;
    }
    if (partial.keywordFilterRate !== undefined) {
      this.#stats.keywordFilterRate = partial.keywordFilterRate;
    }
    if (partial.duplicateHardRejects !== undefined) {
      this.#stats.duplicateHardRejects = partial.duplicateHardRejects;
    }
    if (partial.semanticRejects !== undefined) {
      this.#stats.semanticRejects = partial.semanticRejects;
    }
    if (partial.lowRelevanceDrops !== undefined) {
      this.#stats.lowRelevanceDrops = partial.lowRelevanceDrops;
    }
    if (partial.styleFitDrops !== undefined) {
      this.#stats.styleFitDrops = partial.styleFitDrops;
    }
    this.#container.innerHTML = this.#renderHTML();
  }

  destroy() {
    this.#container.remove();
  }

  #renderHTML() {
    const hitRatePercent = (this.#stats.cacheHitRate * 100).toFixed(1);
    const llmLatency = this.#stats.avgLLMLatencyMs.toFixed(0);
    const generationLatency = this.#stats.avgGenerationLatencyMs.toFixed(0);
    const cacheActive = this.#stats.cacheSizeActiveMb.toFixed(2);
    const cacheGlobal = this.#stats.cacheSizeGlobalMb.toFixed(2);
    const avgLen = this.#stats.avgCommentLength.toFixed(1);
    const keywordRatePercent = (this.#stats.keywordFilterRate * 100).toFixed(1);
    return `
      <div><strong>Dev HUD</strong></div>
      <div>字幕批次: ${this.#stats.cues}</div>
      <div>弹幕输出: ${this.#stats.comments}</div>
      <div>缓存命中率: ${hitRatePercent}%</div>
      <div>LLM延迟: ${llmLatency}ms</div>
      <div>生成耗时: ${generationLatency}ms</div>
      <div>缓存占用: ${cacheActive} / ${cacheGlobal} MB</div>
      <div>Fallback: ${this.#stats.fallbackResponses}</div>
      <div>窗口总弹幕: ${this.#stats.windowCommentTotal}</div>
      <div>活跃车道: ${this.#stats.activeLanes}</div>
      <div>分段数: ${this.#stats.segmentsGenerated} 截断: ${this.#stats.truncatedComments}</div>
      <div>平均长度: ${avgLen}</div>
      <div>禁词触发: ${this.#stats.dynamicBans}</div>
      <div>Tone 警示: ${this.#stats.toneWarnings}</div>
      <div>热词提醒: ${this.#stats.hotwordReminders}</div>
      <div>关键词过滤率: ${keywordRatePercent}%</div>
      <div>硬去重拒绝: ${this.#stats.duplicateHardRejects}</div>
      <div>语义拒绝: ${this.#stats.semanticRejects}</div>
      <div>低关联拒绝: ${this.#stats.lowRelevanceDrops}</div>
      <div>风格拒绝: ${this.#stats.styleFitDrops}</div>
    `;
  }
}

let hud: DeveloperHUD | null = null;

export function setDeveloperHUDEnabled(enabled: boolean) {
  if (enabled && !hud) {
    hud = new DeveloperHUD();
  }
  if (!enabled && hud) {
    hud.destroy();
    hud = null;
  }
}

export function updateDeveloperHUD(partial: Partial<DeveloperStats>) {
  hud?.update(partial);
}
