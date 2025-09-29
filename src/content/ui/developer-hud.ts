import type { EnergyState } from '../../shared/types';

const ENERGY_STATE_ORDER: EnergyState[] = ['calm', 'active', 'peak', 'cooldown'];

interface DeveloperStats {
  cues: number;
  comments: number;
  cacheHitRate: number;
  avgLLMLatencyMs: number;
  avgGenerationLatencyMs: number;
  cacheSizeActiveMb: number;
  cacheSizeGlobalMb: number;
  fallbackResponses: number;
  llmCalls: number;
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
  stateGatedSkips: number;
  stateSoftSkips: number;
  stateForcedEmissions: number;
  energyState: EnergyState;
  stateOccupancy: Partial<Record<EnergyState, number>>;
  lengthMean: number;
  lengthStdDev: number;
  lengthRollingMean: number;
  lengthRollingStdDev: number;
  lengthDeviation: number;
  lengthSamples: number;
  dynamicBanReleases: number;
  speechTicBans: number;
  speechTicViolations: number;
  toneAlignmentHits: number;
  toneAlignmentMisses: number;
  fewShotSelections: number;
  fewShotCooldownSkips: number;
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
    llmCalls: 0,
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
    styleFitDrops: 0,
    stateGatedSkips: 0,
    stateSoftSkips: 0,
    stateForcedEmissions: 0,
    energyState: 'calm',
    stateOccupancy: {},
    lengthMean: 0,
    lengthStdDev: 0,
    lengthRollingMean: 0,
    lengthRollingStdDev: 0,
    lengthDeviation: 0,
    lengthSamples: 0,
    dynamicBanReleases: 0,
    speechTicBans: 0,
    speechTicViolations: 0,
    toneAlignmentHits: 0,
    toneAlignmentMisses: 0,
    fewShotSelections: 0,
    fewShotCooldownSkips: 0
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
    if (partial.llmCalls !== undefined) {
      this.#stats.llmCalls += partial.llmCalls;
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
    if (partial.stateGatedSkips !== undefined) {
      this.#stats.stateGatedSkips = partial.stateGatedSkips;
    }
    if (partial.stateSoftSkips !== undefined) {
      this.#stats.stateSoftSkips = partial.stateSoftSkips;
    }
    if (partial.stateForcedEmissions !== undefined) {
      this.#stats.stateForcedEmissions = partial.stateForcedEmissions;
    }
    if (partial.energyState !== undefined) {
      this.#stats.energyState = partial.energyState;
    }
    if (partial.stateOccupancy !== undefined) {
      this.#stats.stateOccupancy = { ...partial.stateOccupancy };
    }
    if (partial.lengthMean !== undefined) {
      this.#stats.lengthMean = partial.lengthMean;
    }
    if (partial.lengthStdDev !== undefined) {
      this.#stats.lengthStdDev = partial.lengthStdDev;
    }
    if (partial.lengthRollingMean !== undefined) {
      this.#stats.lengthRollingMean = partial.lengthRollingMean;
    }
    if (partial.lengthRollingStdDev !== undefined) {
      this.#stats.lengthRollingStdDev = partial.lengthRollingStdDev;
    }
    if (partial.lengthDeviation !== undefined) {
      this.#stats.lengthDeviation = partial.lengthDeviation;
    }
    if (partial.lengthSamples !== undefined) {
      this.#stats.lengthSamples = partial.lengthSamples;
    }
    if (partial.dynamicBanReleases !== undefined) {
      this.#stats.dynamicBanReleases = partial.dynamicBanReleases;
    }
    if (partial.speechTicBans !== undefined) {
      this.#stats.speechTicBans = partial.speechTicBans;
    }
    if (partial.speechTicViolations !== undefined) {
      this.#stats.speechTicViolations = partial.speechTicViolations;
    }
    if (partial.toneAlignmentHits !== undefined) {
      this.#stats.toneAlignmentHits = partial.toneAlignmentHits;
    }
    if (partial.toneAlignmentMisses !== undefined) {
      this.#stats.toneAlignmentMisses = partial.toneAlignmentMisses;
    }
    if (partial.fewShotSelections !== undefined) {
      this.#stats.fewShotSelections = partial.fewShotSelections;
    }
    if (partial.fewShotCooldownSkips !== undefined) {
      this.#stats.fewShotCooldownSkips = partial.fewShotCooldownSkips;
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
    const occupancy = ENERGY_STATE_ORDER.map((state) => {
      const ratio = (this.#stats.stateOccupancy?.[state] ?? 0) * 100;
      return `${state}:${ratio.toFixed(0)}%`;
    }).join(' ');
    const lengthMean = this.#stats.lengthMean.toFixed(1);
    const lengthStd = this.#stats.lengthStdDev.toFixed(1);
    const lengthRollingMean = this.#stats.lengthRollingMean.toFixed(1);
    const lengthRollingStd = this.#stats.lengthRollingStdDev.toFixed(1);
    const lengthDelta = this.#stats.lengthDeviation.toFixed(1);
    const toneAlignmentRate =
      this.#stats.toneAlignmentHits + this.#stats.toneAlignmentMisses > 0
        ? (
            (this.#stats.toneAlignmentHits /
              (this.#stats.toneAlignmentHits + this.#stats.toneAlignmentMisses)) *
            100
          ).toFixed(0)
        : '—';
    return `
      <div><strong>Dev HUD</strong></div>
      <div>字幕批次: ${this.#stats.cues}</div>
      <div>弹幕输出: ${this.#stats.comments}</div>
      <div>缓存命中率: ${hitRatePercent}%</div>
      <div>LLM延迟: ${llmLatency}ms</div>
      <div>生成耗时: ${generationLatency}ms</div>
      <div>缓存占用: ${cacheActive} / ${cacheGlobal} MB</div>
      <div>Fallback: ${this.#stats.fallbackResponses}</div>
      <div>LLM调用: ${this.#stats.llmCalls}</div>
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
      <div>状态: ${this.#stats.energyState} | 强制发声: ${this.#stats.stateForcedEmissions} | 状态拦截: ${this.#stats.stateGatedSkips} | 偏好跳过: ${this.#stats.stateSoftSkips}</div>
      <div>状态占比: ${occupancy}</div>
      <div>长度(窗口): μ ${lengthMean} σ ${lengthStd} Δ ${lengthDelta} n=${this.#stats.lengthSamples}</div>
      <div>长度(滚动): μ ${lengthRollingMean} σ ${lengthRollingStd}</div>
      <div>禁词释放: ${this.#stats.dynamicBanReleases} | 口头禅封禁: ${this.#stats.speechTicBans} | 违规: ${this.#stats.speechTicViolations}</div>
      <div>Tone 对齐: ${toneAlignmentRate}% (命中:${this.#stats.toneAlignmentHits} 丢失:${this.#stats.toneAlignmentMisses})</div>
      <div>Few-shot: 取样 ${this.#stats.fewShotSelections} | 冷却跳过 ${this.#stats.fewShotCooldownSkips}</div>
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
