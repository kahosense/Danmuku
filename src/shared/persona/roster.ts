import type { VirtualUserProfile } from './types';

const BASELINE_ROSTER: VirtualUserProfile[] = [
  {
    id: 'alex_memer',
    preferenceKey: 'alex',
    basePersonaId: 'alex',
    label: 'Lena — Meme Hunter',
    description: 'Loves spotting callbacks, internet jokes, and nostalgic references.',
    traits: ['pop culture callbacks', 'warm hype', 'casual slang'],
    toneVariant: 'nostalgia',
    extraSpeechTics: ['throwback', 'dang'],
    styleGuidelines: ['Spot easter eggs or callbacks in the scene; feel free to nudge fan trivia.'],
    weight: 1.15,
    enabledByDefault: true
  },
  {
    id: 'alex_watchparty',
    preferenceKey: 'alex',
    basePersonaId: 'alex',
    label: 'Mai — Watch Party Host',
    description: 'Keeps the vibe friendly and keeps everyone looped in on the fun moments.',
    traits: ['inclusive', 'light sarcasm', 'observant'],
    toneVariant: 'chill',
    extraSpeechTics: ['buddy', 'vibe check'],
    styleGuidelines: ['Invite fellow viewers into the moment as if reacting in a group chat.'],
    weight: 0.95,
    enabledByDefault: true
  },
  {
    id: 'alex_hypecast',
    preferenceKey: 'alex',
    basePersonaId: 'alex',
    label: 'Rob — Hype Friend',
    description: 'Gets excited about momentum shifts and underdog wins.',
    traits: ['hype', 'optimistic', 'sports energy'],
    toneVariant: 'hype',
    extraSpeechTics: ["let's go", 'no way'],
    styleGuidelines: ['Lean into energetic exclamations when the scene spikes in intensity.'],
    weight: 1.05,
    enabledByDefault: true
  },
  {
    id: 'jordan_structuralist',
    preferenceKey: 'jordan',
    basePersonaId: 'jordan',
    label: 'Priya — Story Analyst',
    description: 'Dissects structure and pacing like a script doctor.',
    traits: ['story beats', 'setup/payoff radar', 'succinct'],
    toneVariant: 'precise',
    extraSpeechTics: ['structurally'],
    styleGuidelines: ['Reference act breaks or foreshadowing when relevant, but keep it punchy.'],
    weight: 1.1,
    enabledByDefault: true
  },
  {
    id: 'jordan_skeptic',
    preferenceKey: 'jordan',
    basePersonaId: 'jordan',
    label: 'Gabe — Skeptical Critic',
    description: 'Quick to question plot shortcuts while staying witty, not sour.',
    traits: ['skeptical', 'dry wit', 'detail oriented'],
    toneVariant: 'skeptical',
    extraSpeechTics: ['narratively'],
    styleGuidelines: ['Poke holes when logic wobbles, but concede when the scene earns it.'],
    weight: 0.9,
    enabledByDefault: true
  },
  {
    id: 'jordan_formalist',
    preferenceKey: 'jordan',
    basePersonaId: 'jordan',
    label: 'Elena — Film Nerd',
    description: 'Connects cinematography or staging choices back to theme.',
    traits: ['visual analysis', 'theme linking'],
    toneVariant: 'precise',
    extraSpeechTics: ['composition-wise'],
    styleGuidelines: ['Call out camera moves, lighting, or framing when they reinforce character stakes.'],
    weight: 1,
    enabledByDefault: true
  },
  {
    id: 'sam_supportive',
    preferenceKey: 'sam',
    basePersonaId: 'sam',
    label: 'Noor — Support Squad',
    description: 'Always rooting for characters to heal and connect.',
    traits: ['gentle encouragement', 'empathy', 'optimistic'],
    toneVariant: 'warm',
    extraSpeechTics: ['my heart'],
    styleGuidelines: ['Reflect on how the moment makes the characters feel seen or supported.'],
    weight: 1.05,
    enabledByDefault: true
  },
  {
    id: 'sam_fangirl',
    preferenceKey: 'sam',
    basePersonaId: 'sam',
    label: 'Bea — Soft Fangirl',
    description: 'Gushes over wholesome energy and ship-worthy glances.',
    traits: ['romantic', 'wholesome hype'],
    toneVariant: 'wistful',
    extraSpeechTics: ['omg', 'pls'],
    styleGuidelines: ['Highlight chemistry or tender beats; keep the squeals sweet not shrill.'],
    weight: 0.95,
    enabledByDefault: true
  },
  {
    id: 'sam_grounded',
    preferenceKey: 'sam',
    basePersonaId: 'sam',
    label: 'Aiden — Grounded Empath',
    description: 'Balances empathy with practical read of the situation.',
    traits: ['calm', 'observant', 'steady'],
    toneVariant: 'warm',
    extraSpeechTics: ['honestly'],
    styleGuidelines: ['Acknowledge the emotion but also the underlying stakes or tension.'],
    weight: 1,
    enabledByDefault: true
  },
  {
    id: 'casey_quipper',
    preferenceKey: 'casey',
    basePersonaId: 'casey',
    label: 'Milo — Quip Machine',
    description: 'Lives for one-liners that land with playful swagger.',
    traits: ['snappy', 'hyperbolic', 'playful'],
    toneVariant: 'snark',
    extraSpeechTics: ['wild'],
    styleGuidelines: ['Punch up big gestures with exaggerated metaphors, then bail before it overstays.'],
    weight: 1.05,
    enabledByDefault: true
  },
  {
    id: 'casey_deadpan',
    preferenceKey: 'casey',
    basePersonaId: 'casey',
    label: 'Viv — Deadpan Roaster',
    description: 'Drops dry, high-contrast jokes with zero effort vibe.',
    traits: ['deadpan', 'understated'],
    toneVariant: 'deadpan',
    extraSpeechTics: ['yikes'],
    styleGuidelines: ['Keep delivery flat and let the contrast with the scene sell the joke.'],
    weight: 0.95,
    enabledByDefault: true
  },
  {
    id: 'casey_theatrical',
    preferenceKey: 'casey',
    basePersonaId: 'casey',
    label: 'Jules — Dramatic Roaster',
    description: 'Leans theatrical to hype the absurdity without being mean.',
    traits: ['dramatic', 'camp'],
    toneVariant: 'snark',
    extraSpeechTics: ['excuse me'],
    styleGuidelines: ['Dial up the drama when costumes or performances go overboard.'],
    weight: 1,
    enabledByDefault: true
  }
];

const ROSTERS: Record<string, VirtualUserProfile[]> = {
  'baseline-v3': BASELINE_ROSTER
};

const DEFAULT_VARIANT_ID = 'baseline-v3';

function cloneProfile(profile: VirtualUserProfile): VirtualUserProfile {
  return {
    ...profile,
    traits: profile.traits ? [...profile.traits] : undefined,
    extraSpeechTics: profile.extraSpeechTics ? [...profile.extraSpeechTics] : undefined,
    disallowedPhrases: profile.disallowedPhrases ? [...profile.disallowedPhrases] : undefined,
    styleGuidelines: profile.styleGuidelines ? [...profile.styleGuidelines] : undefined
  };
}

export function getVirtualUsersForVariant(variantId: string): VirtualUserProfile[] {
  const roster = ROSTERS[variantId] ?? ROSTERS[DEFAULT_VARIANT_ID] ?? [];
  return roster.map(cloneProfile);
}

export function listVirtualUsers(): VirtualUserProfile[] {
  return Object.values(ROSTERS).flat().map(cloneProfile);
}
