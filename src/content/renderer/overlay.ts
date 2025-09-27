import type { GeneratedComment } from '../../shared/types';
import { getRealtimePlaybackPositionMs, getLatestPlaybackPositionMs } from '../playback-observer';
import styles from './styles.css?inline';

interface LaneState {
  element: HTMLDivElement;
  busyUntil: number;
}

const LANE_COUNT = 4;
const BASE_DURATION_MS = 6000;
const COMMENT_PADDING = 32;
const LANE_GAP_MS = 350;
const LONG_TEXT_THRESHOLD = 90;
const SPEED_FAST = 190; // px per second
const SPEED_MEDIUM = 150;
const SPEED_SLOW = 115;
const MIN_SPEED = 90;
const EXIT_BUFFER_MS = 200;

export class DanmakuRenderer {
  #root: ShadowRoot;
  #lanes: LaneState[] = [];
  #enabled = true;
  #renderedIds = new Set<string>();
  #batchSegments = 0;
  #batchTruncated = 0;
  #laneLocks = new Map<string, LaneState>();
  #segmentsRemaining = new Map<string, number>();
  #scheduledTimers = new Map<string, number>();

  constructor(private host: HTMLElement) {
    this.#root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    this.#root.appendChild(style);

    const container = document.createElement('div');
    container.className = 'danmaku-container';
    this.#root.appendChild(container);

    for (let i = 0; i < LANE_COUNT; i += 1) {
      const lane = document.createElement('div');
      lane.className = 'danmaku-lane';
      container.appendChild(lane);
      this.#lanes.push({ element: lane, busyUntil: 0 });
    }
  }

  setEnabled(enabled: boolean) {
    this.#enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  clear() {
    this.#scheduledTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    this.#scheduledTimers.clear();
    this.#lanes.forEach((lane) => {
      lane.element.innerHTML = '';
      lane.busyUntil = 0;
    });
    this.#renderedIds.clear();
  }

  renderBatch(comments: GeneratedComment[]) {
    if (!this.#enabled) {
      return;
    }

    this.#batchSegments = 0;
    this.#batchTruncated = 0;

    const scheduled = [...comments].sort((a, b) => a.renderAt - b.renderAt);

    for (const comment of scheduled) {
      if (this.#renderedIds.has(comment.id)) {
        continue;
      }
      const segments = this.#splitLongComment(comment);
      const baseId = comment.id;
      this.#segmentsRemaining.set(baseId, segments.length);
      this.#batchSegments += segments.length;
      if (comment.text.trim().length > LONG_TEXT_THRESHOLD) {
        this.#batchTruncated += 1;
      }
      segments.forEach((segment) => {
        if (this.#renderedIds.has(segment.id)) {
          return;
        }
        this.#renderedIds.add(segment.id);
        this.#scheduleCommentRender(segment, baseId);
      });
    }

    this.#emitMetrics();
  }

  #scheduleCommentRender(comment: GeneratedComment, baseId?: string) {
    if (!this.#enabled) {
      return;
    }

    const realtimePosition = getRealtimePlaybackPositionMs();
    const fallbackPosition = getLatestPlaybackPositionMs();
    const playbackPosition = realtimePosition > 0 ? realtimePosition : fallbackPosition;
    const waitMs = Math.max(0, comment.renderAt - playbackPosition);

    if (waitMs > 0) {
      const existing = this.#scheduledTimers.get(comment.id);
      if (existing !== undefined) {
        window.clearTimeout(existing);
      }
      const timerId = window.setTimeout(() => {
        this.#scheduledTimers.delete(comment.id);
        if (!this.#enabled) {
          return;
        }
        this.#renderComment(comment, baseId);
      }, waitMs);
      this.#scheduledTimers.set(comment.id, timerId);
      return;
    }

    this.#renderComment(comment, baseId);
  }

  #renderComment(comment: GeneratedComment, baseId?: string) {
    const timerId = this.#scheduledTimers.get(comment.id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      this.#scheduledTimers.delete(comment.id);
    }

    const parentId = baseId ?? this.#extractBaseId(comment.id);
    const slot = this.#nextAvailableLane(parentId);
    if (slot.waitMs > 0) {
      window.setTimeout(() => {
        if (this.#enabled) {
          this.#renderComment(comment, parentId);
        }
      }, slot.waitMs);
      return;
    }

    const lane = slot.lane;
    const now = Date.now();
    const estimatedDuration = Number.isFinite(comment.durationMs)
      ? Math.max(comment.durationMs, BASE_DURATION_MS)
      : BASE_DURATION_MS;
    const prelockUntil = now + estimatedDuration + LANE_GAP_MS;
    if (lane.busyUntil < prelockUntil) {
      lane.busyUntil = prelockUntil;
    }
    const bubble = document.createElement('div');
    bubble.className = `danmaku-comment persona-${comment.personaId}`;
    bubble.textContent = comment.text;
    bubble.dataset.commentId = comment.id;

    lane.element.appendChild(bubble);

    requestAnimationFrame(() => {
      const laneWidth = lane.element.clientWidth || window.innerWidth;
      const textWidth = bubble.clientWidth;
      const distance = laneWidth + textWidth + COMMENT_PADDING;
      const duration = this.#calculateDuration(distance, comment.text.length, comment.durationMs);

      const keyframes = [
        { transform: `translateX(${laneWidth}px)` },
        { transform: `translateX(-${textWidth + COMMENT_PADDING}px)` }
      ];

      const animation = bubble.animate(keyframes, {
        duration,
        easing: 'linear'
      });

      const releaseAt = Date.now() + duration;
      lane.busyUntil = Math.max(lane.busyUntil, releaseAt + LANE_GAP_MS);
      const busyMarker = lane.busyUntil;

      animation.finished
        .catch(() => undefined)
        .finally(() => {
          bubble.remove();
          if (lane.busyUntil === busyMarker) {
            lane.busyUntil = Date.now();
          }
          this.#renderedIds.delete(comment.id);
          if (parentId) {
            const remaining = (this.#segmentsRemaining.get(parentId) ?? 1) - 1;
            if (remaining <= 0) {
              this.#segmentsRemaining.delete(parentId);
              this.#laneLocks.delete(parentId);
            } else {
              this.#segmentsRemaining.set(parentId, remaining);
            }
          }
        });
    });
  }

  #nextAvailableLane(baseId?: string): { lane: LaneState; waitMs: number } {
    const now = Date.now();
    if (baseId) {
      const locked = this.#laneLocks.get(baseId);
      if (locked) {
        return { lane: locked, waitMs: Math.max(0, locked.busyUntil - now) };
      }
    }

    let candidate = this.#lanes[0];
    let waitMs = Math.max(0, candidate.busyUntil - now);
    for (const lane of this.#lanes) {
      const laneWait = Math.max(0, lane.busyUntil - now);
      if (laneWait === 0) {
        candidate = lane;
        waitMs = 0;
        break;
      }
      if (laneWait < waitMs) {
        candidate = lane;
        waitMs = laneWait;
      }
    }
    if (baseId) {
      this.#laneLocks.set(baseId, candidate);
    }
    return { lane: candidate, waitMs };
  }

  #calculateDuration(distance: number, textLength: number, fallbackMs: number) {
    let speed = SPEED_FAST;
    if (textLength > 70) {
      speed = SPEED_SLOW;
    } else if (textLength > 45) {
      speed = SPEED_MEDIUM;
    }
    speed = Math.max(MIN_SPEED, speed);
    const durationFromSpeed = (distance / speed) * 1000;
    return Math.max(durationFromSpeed + EXIT_BUFFER_MS, fallbackMs, BASE_DURATION_MS);
  }

  #splitLongComment(comment: GeneratedComment) {
    const trimmed = comment.text.trim();
    if (trimmed.length <= LONG_TEXT_THRESHOLD) {
      return [{ ...comment, text: trimmed }];
    }

    const truncated = trimmed.slice(0, LONG_TEXT_THRESHOLD - 1).trimEnd();
    return [
      {
        ...comment,
        text: `${truncated}…`
      }
    ];
  }

  #extractBaseId(id: string) {
    const separatorIndex = id.indexOf('::');
    return separatorIndex === -1 ? id : id.slice(0, separatorIndex);
  }

  #emitMetrics() {
    requestAnimationFrame(() => {
      const activeLanes = this.#lanes.filter((lane) => lane.busyUntil > Date.now()).length;
      document.dispatchEvent(
        new CustomEvent('danmaku-metrics', {
          detail: {
            activeLanes,
            segmentsGenerated: this.#batchSegments,
            truncated: this.#batchTruncated
          }
        })
      );
    });
  }
}

let rendererInstance: DanmakuRenderer | null = null;

export function ensureRendererHost(): DanmakuRenderer {
  if (rendererInstance) {
    return rendererInstance;
  }
  let host = document.getElementById('danmaku-overlay-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'danmaku-overlay-host';
    host.style.position = 'absolute';
    host.style.inset = '0';
    host.style.pointerEvents = 'none';
    const playerRoot =
      document.querySelector<HTMLElement>('.watch-video--player-container') ??
      document.querySelector<HTMLElement>('.watch-video--player-view') ??
      document.body;
    playerRoot.appendChild(host);
  }
  rendererInstance = new DanmakuRenderer(host);
  return rendererInstance;
}
