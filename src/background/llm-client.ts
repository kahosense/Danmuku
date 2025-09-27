import { logger } from '../shared/logger';
import type { LLMStatus } from '../shared/types';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface LLMRequestOptions {
  personaId: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface LLMResponse {
  personaId: string;
  text: string;
  usingFallback: boolean;
  fallbackReason?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 2000;

export class LLMClient {
  #endpoint?: string;
  #apiKey?: string;
  #configured = false;
  #lastStatus: LLMStatus = { level: 'ok' };

  configure({ endpoint, apiKey }: { endpoint?: string; apiKey?: string }) {
    this.#endpoint = endpoint;
    this.#apiKey = apiKey;
    this.#configured = Boolean(endpoint && apiKey);
    this.#lastStatus = this.#configured
      ? { level: 'ok' }
      : { level: 'degraded', detail: 'LLM 未配置，使用占位响应' };
  }

  async complete(options: LLMRequestOptions): Promise<LLMResponse> {
    if (!this.#configured || !this.#endpoint || !this.#apiKey) {
      logger.warn('[llm-client] LLM not configured; returning stub response.');
      this.#lastStatus = { level: 'degraded', detail: 'LLM 未配置' };
      return this.#mockResponse(options, 'missing_config');
    }

    const maxAttempts = (options.maxRetries ?? DEFAULT_MAX_RETRIES) + 1;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        if (options.signal) {
          options.signal.addEventListener('abort', () =>
            controller.abort(options.signal?.reason)
          );
        }

        const timeoutId = setTimeout(() => {
          controller.abort('timeout');
        }, timeoutMs);

        let response: Response;
        try {
          response = await fetch(this.#endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.#apiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: options.messages,
              max_tokens: options.maxTokens ?? 80,
              temperature: options.temperature ?? 0.8,
              top_p: options.topP ?? 0.9,
              presence_penalty: options.presencePenalty ?? 0.5
            }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`LLM request failed: ${response.status} ${detail}`);
        }

        const payload = await response.json();
        const text = payload?.choices?.[0]?.message?.content ?? '';
        const trimmed = text.trim();
        if (!trimmed) {
          throw new Error('LLM returned empty response');
        }

        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining) {
          logger.debug('[llm-client] Quota remaining', {
            remaining,
            limit: response.headers.get('x-ratelimit-limit'),
            reset: response.headers.get('x-ratelimit-reset')
          });
        }

        this.#lastStatus = { level: 'ok' };

        return {
          personaId: options.personaId,
          text: trimmed,
          usingFallback: false
        };
      } catch (error) {
        lastError = error;
        const attemptNumber = attempt + 1;
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(`[llm-client] Attempt ${attemptNumber} failed`, detail);

        if (attempt < maxAttempts - 1) {
          const backoff = BASE_RETRY_DELAY_MS * 2 ** attempt;
          await this.#delay(backoff);
          continue;
        }
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
    this.#lastStatus = { level: 'degraded', detail };
    logger.error('[llm-client] All attempts failed, falling back to stub', detail);

    return this.#mockResponse(options, 'request_failed');
  }

  getLastStatus(): LLMStatus {
    return this.#lastStatus;
  }

  #delay(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  #mockResponse(options: LLMRequestOptions, reason: string): LLMResponse {
    const fallback = options.messages
      .filter((msg) => msg.role === 'user')
      .map((msg) => msg.content)
      .join(' ');
    const trimmed = fallback.replace(/\s+/g, ' ').trim();
    const snippet = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
    const playfulFillers = [
      'wild ride, huh?',
      "this crew keeps me on my toes.",
      'did not see that coming.'
    ];
    const filler = playfulFillers[Math.floor(Math.random() * playfulFillers.length)] ?? '';
    return {
      personaId: options.personaId,
      text: snippet ? `${snippet} (${filler})` : `(${options.personaId}) sharing the moment.`,
      usingFallback: true,
      fallbackReason: reason
    };
  }
}

export const llmClient = new LLMClient();
