import type { GeneratedComment } from '../../shared/types';
import styles from './styles.css?inline';

interface LaneState {
  element: HTMLDivElement;
  busyUntil: number;
}

const LANE_COUNT = 4;
const BASE_DURATION_MS = 6000;
const COMMENT_PADDING = 32;
const LANE_GAP_MS = 350;
const LONG_TEXT_THRESHOLD = 60;
const MAX_SEGMENTS = 3;
const SEGMENT_DELAY_MS = 350;
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

    for (const comment of comments) {
      if (this.#renderedIds.has(comment.id)) {
        continue;
      }
      const segments = this.#splitLongComment(comment);
      this.#batchSegments += segments.length;
      if (segments.length > 1) {
        this.#batchTruncated += segments.length - 1;
      }
      segments.forEach((segment, index) => {
        if (this.#renderedIds.has(segment.id)) {
          return;
        }
        this.#renderedIds.add(segment.id);
        const delay = index * SEGMENT_DELAY_MS;
        if (delay > 0) {
          window.setTimeout(() => {
            if (this.#enabled) {
              this.#renderComment(segment);
            }
          }, delay);
        } else {
          this.#renderComment(segment);
        }
      });
    }

    this.#emitMetrics();
  }

  #renderComment(comment: GeneratedComment) {
    const slot = this.#nextAvailableLane();
    if (slot.waitMs > 0) {
      window.setTimeout(() => {
        if (this.#enabled) {
          this.#renderComment(comment);
        }
      }, slot.waitMs);
      return;
    }

    const lane = slot.lane;
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
      lane.busyUntil = releaseAt + LANE_GAP_MS;
      const busyMarker = lane.busyUntil;

      animation.finished
        .catch(() => undefined)
        .finally(() => {
          bubble.remove();
          if (lane.busyUntil === busyMarker) {
            lane.busyUntil = Date.now();
          }
          this.#renderedIds.delete(comment.id);
        });
    });
  }

  #nextAvailableLane(): { lane: LaneState; waitMs: number } {
    const now = Date.now();
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
    if (comment.text.length <= LONG_TEXT_THRESHOLD) {
      return [comment];
    }

    const segments: string[] = [];
    const sentences = comment.text
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      if (sentence.length <= LONG_TEXT_THRESHOLD) {
        segments.push(sentence);
        continue;
      }
      const words = sentence.split(/\s+/);
      let buffer: string[] = [];
      for (const word of words) {
        if ([...buffer, word].join(' ').length > LONG_TEXT_THRESHOLD) {
          segments.push(buffer.join(' '));
          buffer = [word];
        } else {
          buffer.push(word);
        }
      }
      if (buffer.length) {
        segments.push(buffer.join(' '));
      }
    }

    const limited = segments.slice(0, MAX_SEGMENTS);
    if (limited.length === 0) {
      return [comment];
    }

    return limited.map((segment, index) => ({
      ...comment,
      id: `${comment.id}::${index}`,
      text: segment.trim()
    }));
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
