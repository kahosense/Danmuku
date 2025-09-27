import type { SubtitleCue } from '../shared/types';

export type SceneTone =
  | 'calm'
  | 'tense'
  | 'humorous'
  | 'sad'
  | 'romantic'
  | 'confused'
  | 'thrilling'
  | 'bittersweet'
  | 'mystery';

export type ToneIntensity = 'low' | 'medium' | 'high';

export interface SceneAnalysis {
  summary: string;
  keywords: string[];
  speakers: string[];
  tone: SceneTone;
  toneIntensity: ToneIntensity;
  toneConfidence: number;
  energy: 'low' | 'medium' | 'high';
  hasQuestion: boolean;
  hasExclamation: boolean;
  shouldRespond: boolean;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'you',
  'for',
  'but',
  'that',
  'with',
  'this',
  'have',
  'what',
  'your',
  'from',
  'they',
  'there',
  'will',
  'were',
  'just',
  'about',
  'like',
  'into',
  'when',
  'them',
  'then',
  'than',
  'over'
]);

function extractSpeakers(text: string) {
  const match = text.match(/^([A-Z][A-Z\s]{1,20}):/);
  if (match) {
    return match[1]
      .split(' ')
      .map((token) => token.trim())
      .filter(Boolean);
  }
  return [];
}

function collectKeywords(text: string) {
  const clean = text
    .replace(/[^a-zA-Z\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

  const counts = new Map<string, number>();
  clean.forEach((word) => {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

interface ToneSignal {
  tone: SceneTone;
  intensity: ToneIntensity;
  confidence: number;
}

const TONE_RULES: Array<{
  tone: SceneTone;
  patterns: RegExp[];
  weight: number;
  intensity: ToneIntensity;
}> = [
  {
    tone: 'tense',
    patterns: [/[!?]{2,}/, /\brun\b/, /\bnow\b/, /\bmove\b/, /\bgun\b/, /\bthreat/i],
    weight: 1.2,
    intensity: 'high'
  },
  {
    tone: 'thrilling',
    patterns: [
      /\bchase\b/i,
      /\bescape\b/i,
      /explosion/i,
      /\bcliffhanger\b/i,
      /\brace\b/i,
      /\bstandoff\b/i
    ],
    weight: 1.3,
    intensity: 'high'
  },
  {
    tone: 'bittersweet',
    patterns: [
      /\bproud of you\b/i,
      /\bthank you\b/i,
      /\bmiss you\b/i,
      /\bfarewell\b/i,
      /\bso happy for you\b/i
    ],
    weight: 1.1,
    intensity: 'medium'
  },
  {
    tone: 'mystery',
    patterns: [
      /\bclue\b/i,
      /\binvestigate\b/i,
      /\bcase\b/i,
      /\bsuspect\b/i,
      /\bmystery\b/i,
      /\bsecret\b/i,
      /\bhidden\b/i
    ],
    weight: 1,
    intensity: 'medium'
  },
  {
    tone: 'humorous',
    patterns: [/(haha|lol|funny|joke|laugh|comedy)/i],
    weight: 1,
    intensity: 'medium'
  },
  {
    tone: 'romantic',
    patterns: [/(love|kiss|sweet|adorable|romantic|date|flirt)/i],
    weight: 0.9,
    intensity: 'medium'
  },
  {
    tone: 'sad',
    patterns: [/(sorry|cry|sad|tears|hurt|heartbroken|funeral|mourning)/i],
    weight: 1,
    intensity: 'medium'
  },
  {
    tone: 'confused',
    patterns: [/(what|why|how|huh|who|where)/i, /\?\s*$/],
    weight: 0.8,
    intensity: 'medium'
  }
];

const INTENSITY_WEIGHT: Record<ToneIntensity, number> = {
  low: 1,
  medium: 2,
  high: 3
};

function numericToIntensity(value: number): ToneIntensity {
  if (value >= 2.5) {
    return 'high';
  }
  if (value >= 1.7) {
    return 'medium';
  }
  return 'low';
}

function detectTone(text: string, energy: 'low' | 'medium' | 'high'): ToneSignal {
  const lower = text.toLowerCase();
  const scores = new Map<SceneTone, number>();
  const intensityScores = new Map<SceneTone, number>();

  const noteMatch = (tone: SceneTone, weight: number, intensity: ToneIntensity) => {
    scores.set(tone, (scores.get(tone) ?? 0) + weight);
    const numeric = INTENSITY_WEIGHT[intensity];
    const current = intensityScores.get(tone) ?? 0;
    intensityScores.set(tone, Math.max(current, numeric));
  };

  let matchedSignals = 0;

  TONE_RULES.forEach((rule) => {
    rule.patterns.forEach((pattern) => {
      if (pattern.test(lower)) {
        matchedSignals += 1;
        noteMatch(rule.tone, rule.weight, rule.intensity);
      }
    });
  });

  const exclamationCount = (text.match(/!/g)?.length ?? 0);
  const questionCount = (text.match(/\?/g)?.length ?? 0);

  if (exclamationCount >= 2 || /do it now|hurry|we have to/i.test(lower)) {
    matchedSignals += 1;
    noteMatch('tense', 0.9 + exclamationCount * 0.1, exclamationCount >= 3 ? 'high' : 'medium');
  }

  if (energy === 'high') {
    matchedSignals += 1;
    noteMatch('thrilling', 0.7, 'high');
  }

  if (questionCount >= 2) {
    matchedSignals += 1;
    noteMatch('confused', 0.6 + questionCount * 0.05, 'medium');
  }

  const totalScore = Array.from(scores.values()).reduce((sum, value) => sum + value, 0);

  let tone: SceneTone = 'calm';
  let intensity: ToneIntensity = energy === 'high' ? 'medium' : 'low';
  let confidence = 0.4;

  if (totalScore > 0) {
    const [bestTone, bestScore] = Array.from(scores.entries()).reduce(
      (best, current) => (current[1] > best[1] ? current : best),
      ['calm', 0] as [SceneTone, number]
    );
    tone = bestTone;
    const intensityNumeric = intensityScores.get(bestTone) ?? (energy === 'high' ? 2 : 1);
    intensity = numericToIntensity(intensityNumeric);
    confidence = Math.min(0.95, Math.max(0.35, bestScore / (totalScore || 1)));
  } else if (energy === 'medium' || energy === 'high') {
    tone = energy === 'high' ? 'tense' : 'calm';
    intensity = energy === 'high' ? 'medium' : 'low';
    confidence = energy === 'high' ? 0.55 : 0.45;
  }

  if (tone === 'calm' && energy === 'medium' && questionCount > 0) {
    tone = 'confused';
    intensity = 'medium';
    confidence = Math.max(confidence, 0.5);
  }

  return {
    tone,
    intensity,
    confidence
  };
}

function detectEnergy(text: string): 'low' | 'medium' | 'high' {
  const lengthScore = Math.min(text.length / 80, 1);
  const exclaimScore = Math.min((text.match(/!/g)?.length ?? 0) / 3, 1);
  const questionScore = Math.min((text.match(/\?/g)?.length ?? 0) / 3, 1);
  const aggregate = lengthScore * 0.3 + exclaimScore * 0.4 + questionScore * 0.3;
  if (aggregate > 0.65) {
    return 'high';
  }
  if (aggregate > 0.35) {
    return 'medium';
  }
  return 'low';
}

function shouldRespond(text: string, energy: 'low' | 'medium' | 'high') {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/^(hmm+|uh+|mm+)$/.test(trimmed.toLowerCase())) {
    return false;
  }
  if (trimmed.length < 8 && energy === 'low') {
    return false;
  }
  return true;
}

export function analyzeScene(cues: SubtitleCue[]): SceneAnalysis {
  if (cues.length === 0) {
    return {
      summary: '',
      keywords: [],
      speakers: [],
      tone: 'calm',
      toneIntensity: 'low',
      toneConfidence: 0.4,
      energy: 'low',
      hasQuestion: false,
      hasExclamation: false,
      shouldRespond: false
    };
  }

  const text = cues.map((cue) => cue.text).join(' ');
  const speakers = Array.from(
    new Set(
      cues
        .flatMap((cue) => extractSpeakers(cue.text))
        .filter((token) => token.length > 1)
    )
  );
  const keywords = collectKeywords(text);
  const energy = detectEnergy(text);
  const toneSignal = detectTone(text, energy);
  const summary = text.length > 160 ? `${text.slice(0, 157)}...` : text;

  return {
    summary,
    keywords,
    speakers,
    tone: toneSignal.tone,
    toneIntensity: toneSignal.intensity,
    toneConfidence: toneSignal.confidence,
    energy,
    hasQuestion: /\?/.test(text),
    hasExclamation: /!/.test(text),
    shouldRespond: shouldRespond(text, energy)
  };
}
