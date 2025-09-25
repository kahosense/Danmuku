import variantFile from './persona-variants.json';
import { logger } from '../shared/logger';
import { getVirtualUsersForVariant } from '../shared/persona/roster';
import type { VirtualUserProfile } from '../shared/persona/types';

export interface PersonaFewShotExample {
  user: string;
  assistant: string;
  scenario?: string;
  tags?: string[];
}

export interface PersonaVirtualUserMeta {
  id: string;
  label: string;
  description?: string;
  traits: string[];
  toneVariant?: string;
  preferenceKey: string;
  basePersonaId: string;
  weight: number;
}

export interface PersonaDefinition {
  id: string;
  name: string;
  cadenceSeconds: number;
  systemPrompt: string;
  styleGuidelines: string[];
  maxWords: number;
  fewShotExamples: PersonaFewShotExample[];
  temperature: number;
  topP: number;
  disallowedPhrases: string[];
  speechTics?: string[];
  toneVariants?: string[];
  /** Preference toggle key (defaults to id when omitted). */
  preferenceKey?: string;
  /** Track parent persona even after virtualisation for scheduling heuristics. */
  basePersonaId?: string;
  /** Weight applied when distributing speaking turns. */
  weight?: number;
  /** Virtual user metadata resolved at runtime. */
  virtualUser?: PersonaVirtualUserMeta;
}

export interface PersonaVariantDefinition {
  id: string;
  label: string;
  promptVersion: string;
  description?: string;
  personas: PersonaDefinition[];
  notes?: string;
}

interface PersonaVariantFileShape {
  defaultVariantId: string;
  variants: PersonaVariantDefinition[];
}

const STORAGE_KEY = 'netflix-ai-danmaku::promptVariant';

const parsed: PersonaVariantFileShape = variantFile as PersonaVariantFileShape;
if (!parsed || !Array.isArray(parsed.variants) || parsed.variants.length === 0) {
  throw new Error('[personas] persona-variants.json is empty or malformed');
}

const variantMap = new Map<string, PersonaVariantDefinition>();
parsed.variants.forEach((variant) => {
  variantMap.set(variant.id, variant);
});

let activeVariant: PersonaVariantDefinition =
  variantMap.get(parsed.defaultVariantId) ?? parsed.variants[0];

let resolvedPersonas: PersonaDefinition[] = [];

const listeners = new Set<(variant: PersonaVariantDefinition) => void>();
let initialized = false;

function refreshResolvedPersonas() {
  resolvedPersonas = resolvePersonasForVariant(activeVariant);
}

refreshResolvedPersonas();

function notifyListeners() {
  listeners.forEach((listener) => listener(activeVariant));
}

async function persistVariant(id: string) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: id });
  } catch (error) {
    logger.warn('[personas] Failed to persist prompt variant', error);
  }
}

export function listPersonaVariants(): PersonaVariantDefinition[] {
  return parsed.variants.map((variant) => ({ ...variant }));
}

export function getActivePersonaVariant(): PersonaVariantDefinition {
  return activeVariant;
}

export function getActivePersonas(): PersonaDefinition[] {
  return resolvedPersonas.map((persona) => clonePersonaDefinition(persona));
}

export function subscribePersonaVariant(
  listener: (variant: PersonaVariantDefinition) => void
): () => void {
  listeners.add(listener);
  listener(activeVariant);
  return () => listeners.delete(listener);
}

export async function setActivePersonaVariant(id: string) {
  const next = variantMap.get(id);
  if (!next) {
    throw new Error(`[personas] Unknown prompt variant: ${id}`);
  }
  if (next.id === activeVariant.id) {
    return;
  }
  activeVariant = next;
  refreshResolvedPersonas();
  notifyListeners();
  await persistVariant(id);
  logger.info('[personas] Prompt variant switched', { id });
}

export async function initializePersonaRegistry() {
  if (initialized) {
    return activeVariant;
  }
  initialized = true;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const storedId = stored?.[STORAGE_KEY];
    if (typeof storedId === 'string' && variantMap.has(storedId)) {
      activeVariant = variantMap.get(storedId)!;
    } else {
      await persistVariant(activeVariant.id);
    }
  } catch (error) {
    logger.warn('[personas] Failed to load stored prompt variant, using default', error);
  }
  refreshResolvedPersonas();
  notifyListeners();
  return activeVariant;
}

export function getPersona(personaId: string): PersonaDefinition | undefined {
  const persona = resolvedPersonas.find((entry) => entry.id === personaId);
  return persona ? clonePersonaDefinition(persona) : undefined;
}

function cloneFewShotExample(example: PersonaFewShotExample): PersonaFewShotExample {
  return {
    ...example,
    tags: example.tags ? [...example.tags] : undefined
  };
}

function clonePersonaDefinition(persona: PersonaDefinition): PersonaDefinition {
  return {
    ...persona,
    styleGuidelines: [...persona.styleGuidelines],
    fewShotExamples: persona.fewShotExamples.map((example) => cloneFewShotExample(example)),
    disallowedPhrases: [...persona.disallowedPhrases],
    speechTics: persona.speechTics ? [...persona.speechTics] : undefined,
    toneVariants: persona.toneVariants ? [...persona.toneVariants] : undefined,
    virtualUser: persona.virtualUser
      ? {
          ...persona.virtualUser,
          traits: [...persona.virtualUser.traits]
        }
      : undefined
  };
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed.toLowerCase())) {
      continue;
    }
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

function enhanceBasePersona(base: PersonaDefinition): PersonaDefinition {
  const persona = clonePersonaDefinition(base);
  const preferenceKey = persona.preferenceKey ?? persona.id;
  persona.preferenceKey = preferenceKey;
  persona.basePersonaId = persona.basePersonaId ?? base.id;
  persona.weight = persona.weight ?? 1;
  const tone = persona.toneVariants?.[0];
  persona.virtualUser = {
    id: persona.id,
    label: persona.name,
    description: persona.systemPrompt,
    traits: persona.toneVariants ? [...persona.toneVariants] : [],
    toneVariant: tone,
    preferenceKey,
    basePersonaId: persona.basePersonaId,
    weight: persona.weight
  };
  persona.toneVariants = persona.toneVariants ? dedupeStrings(persona.toneVariants) : [];
  return persona;
}

function mergePersonaWithVirtualUser(
  base: PersonaDefinition,
  profile: VirtualUserProfile
): PersonaDefinition {
  const persona = clonePersonaDefinition(base);
  const preferenceKey = profile.preferenceKey ?? base.preferenceKey ?? base.id;
  persona.id = profile.id;
  persona.name = `${base.name} · ${profile.label}`;
  persona.preferenceKey = preferenceKey;
  persona.basePersonaId = base.basePersonaId ?? base.id;
  persona.weight = profile.weight ?? base.weight ?? 1;
  persona.speechTics = dedupeStrings([
    ...(base.speechTics ?? []),
    ...(profile.extraSpeechTics ?? [])
  ]);
  persona.toneVariants = dedupeStrings([
    ...(base.toneVariants ?? []),
    profile.toneVariant
  ]);
  persona.disallowedPhrases = dedupeStrings([
    ...base.disallowedPhrases,
    ...(profile.disallowedPhrases ?? [])
  ]);
  const traitLine = profile.traits?.length
    ? `Lean into these quirks when it fits: ${profile.traits.join(', ')}.`
    : undefined;
  persona.styleGuidelines = dedupeStrings([
    ...base.styleGuidelines,
    ...(profile.styleGuidelines ?? []),
    traitLine
  ]);
  persona.virtualUser = {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    traits: profile.traits ? [...profile.traits] : [],
    toneVariant: profile.toneVariant,
    preferenceKey,
    basePersonaId: persona.basePersonaId,
    weight: persona.weight
  };
  return persona;
}

export function resolvePersonasForVariant(
  variant: PersonaVariantDefinition
): PersonaDefinition[] {
  const baseMap = new Map<string, PersonaDefinition>();
  variant.personas.forEach((persona) => {
    const clone = clonePersonaDefinition(persona);
    clone.basePersonaId = persona.basePersonaId ?? persona.id;
    clone.preferenceKey = persona.preferenceKey ?? persona.id;
    clone.weight = persona.weight ?? 1;
    baseMap.set(persona.id, clone);
  });

  const roster = getVirtualUsersForVariant(variant.id);
  if (roster.length === 0) {
    return Array.from(baseMap.values()).map((persona) => enhanceBasePersona(persona));
  }

  const resolved: PersonaDefinition[] = [];
  roster.forEach((profile) => {
    const base = baseMap.get(profile.basePersonaId);
    if (!base) {
      logger.warn('[personas] Unknown base persona for virtual user', profile);
      return;
    }
    resolved.push(mergePersonaWithVirtualUser(base, profile));
  });

  return resolved;
}
