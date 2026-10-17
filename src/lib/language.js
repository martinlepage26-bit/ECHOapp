/**
 * language.js — best-effort language detection, used to pick a voice and to
 * decide which number vocabulary the verbalizer should read from.
 */

const SCRIPTS = [
  [/[Ѐ-ӿ]/, 'ru', 'Russian'],
  [/[぀-ゟ゠-ヿ]/, 'ja', 'Japanese'],
  [/[一-鿿]/, 'zh', 'Chinese'],
  [/[가-힯]/, 'ko', 'Korean'],
  [/[؀-ۿ]/, 'ar', 'Arabic'],
  [/[ऀ-ॿ]/, 'hi', 'Hindi'],
  [/[֐-׿]/, 'he', 'Hebrew'],
  [/[Ͱ-Ͽ]/, 'el', 'Greek'],
  [/[฀-๿]/, 'th', 'Thai'],
];

const STOPWORDS = {
  en: ['the', 'and', 'is', 'to', 'of', 'in', 'that', 'it', 'for', 'you', 'with', 'this', 'was', 'are'],
  fr: ['le', 'la', 'les', 'et', 'est', 'que', 'une', 'des', 'pour', 'dans', 'avec', 'sur', 'pas', 'plus'],
  es: ['el', 'la', 'los', 'las', 'que', 'una', 'para', 'con', 'por', 'pero', 'como', 'más', 'este'],
  de: ['der', 'die', 'das', 'und', 'ist', 'ein', 'mit', 'nicht', 'auch', 'sich', 'den', 'von'],
  it: ['il', 'che', 'una', 'per', 'con', 'sono', 'non', 'questo', 'anche', 'più', 'della'],
  pt: ['que', 'uma', 'para', 'com', 'não', 'mais', 'este', 'como', 'mas', 'seu', 'dos'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'op', 'dat', 'niet', 'met', 'voor'],
};

const NAMES = {
  en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', zh: 'Chinese',
  ko: 'Korean', ar: 'Arabic', hi: 'Hindi', he: 'Hebrew', el: 'Greek', th: 'Thai',
};

export function detectLanguage(text) {
  if (!text || !text.trim()) return null;
  // Sampling the head is enough and keeps this cheap on long documents.
  const sample = text.slice(0, 4000);

  for (const [re, code, name] of SCRIPTS) {
    if (re.test(sample)) return { code, name };
  }

  const words = new Set(sample.toLowerCase().match(/[a-zà-ÿ'’-]+/g) || []);
  let best = 'en';
  let bestScore = 0;
  for (const [code, list] of Object.entries(STOPWORDS)) {
    const score = list.reduce((s, w) => s + (words.has(w) ? 1 : 0), 0);
    if (score > bestScore) { best = code; bestScore = score; }
  }
  return { code: best, name: NAMES[best] || best };
}

export const languageName = (code) => NAMES[code] || code;
