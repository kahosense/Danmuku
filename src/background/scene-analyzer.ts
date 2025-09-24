import type { SubtitleCue } from '../shared/types';

export type SceneTone = 'calm' | 'tense' | 'humorous' | 'sad' | 'romantic' | 'confused';

export interface SceneAnalysis {
  summary: string;
  keywords: string[];
  speakers: string[];
  tone: SceneTone;
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

function detectTone(text: string): SceneTone {
  const lower = text.toLowerCase();
  if (/[!?]{2,}/.test(text) || /shut up|run|now!/i.test(text)) {
    return 'tense';
  }
  if (/(haha|lol|funny|joke|laugh)/i.test(lower)) {
    return 'humorous';
  }
  if (/(love|kiss|sweet|adorable)/i.test(lower)) {
    return 'romantic';
  }
  if (/(sorry|cry|sad|tears|hurt)/i.test(lower)) {
    return 'sad';
  }
  if (/(what|why|how|huh)/i.test(lower) || /\?/.test(text)) {
    return 'confused';
  }
  return 'calm';
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
  const tone = detectTone(text);
  const energy = detectEnergy(text);
  const summary = text.length > 160 ? `${text.slice(0, 157)}...` : text;

  return {
    summary,
    keywords,
    speakers,
    tone,
    energy,
    hasQuestion: /\?/.test(text),
    hasExclamation: /!/.test(text),
    shouldRespond: shouldRespond(text, energy)
  };
}
