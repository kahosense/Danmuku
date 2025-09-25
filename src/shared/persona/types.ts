export interface VirtualUserProfile {
  /** Unique identifier for the virtual viewer */
  id: string;
  /** Stable preference toggle key (usually the base persona id). */
  preferenceKey: string;
  /** Base persona the virtual user inherits prompts from. */
  basePersonaId: string;
  /** Human readable label used in logs or debug HUD. */
  label: string;
  /** Short description that can feed prompt context. */
  description?: string;
  /** High-level traits that distinguish this voice. */
  traits?: string[];
  /** Optional tone variant tag that biases scheduling/reranking. */
  toneVariant?: string;
  /** Additional speech tics injected on top of the base persona. */
  extraSpeechTics?: string[];
  /** Additional disallowed phrases, if any. */
  disallowedPhrases?: string[];
  /** Optional style guidelines appended to the base persona list. */
  styleGuidelines?: string[];
  /** Relative weight when distributing speaking turns (default 1). */
  weight?: number;
  /** Whether the virtual user is enabled by default. */
  enabledByDefault?: boolean;
}

export interface VirtualUserRoster {
  variantId: string;
  users: VirtualUserProfile[];
}
