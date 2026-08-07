/** Hardline voice profile catalog and selection. */
import { ECHO_PROFILE_ID, SYSTEM_PROFILE_ID, ECHO_PROFILE_SUMMARY } from './config.js';

export const PROFILE_CATALOG = [
  {
    id: ECHO_PROFILE_ID,
    label: 'Echo',
    summary: 'From echo.mp3 sample · SpeechT5 clone · reads any draft',
    rate: 0.92,
    pitch: 1,
    volume: 1,
    langPrefixes: ['en', 'fr'],
    nameHints: ['aria', 'jenny', 'sonia', 'natasha', 'clara', 'samantha', 'google', 'daniel', 'thomas'],
    onlineVoiceId: 'echo',
  },
  {
    id: 'patricia',
    label: 'Patricia',
    summary: 'Charming, clear and young · reads any draft',
    rate: 0.95,
    pitch: 1,
    volume: 1,
    langPrefixes: ['en'],
    nameHints: [],
    onlineVoiceId: 'patricia',
  },
  {
    id: 'martin-en',
    label: 'Martin EN',
    summary: 'Martin English · reads any draft',
    rate: 0.95,
    pitch: 1,
    volume: 1,
    langPrefixes: ['en'],
    nameHints: [],
    onlineVoiceId: 'martin-en',
  },
  {
    id: 'martin-fr',
    label: 'Martin FR',
    summary: 'Martin français · lit tout brouillon',
    rate: 0.95,
    pitch: 1,
    volume: 1,
    langPrefixes: ['fr'],
    nameHints: [],
    onlineVoiceId: 'martin-fr',
  },
  {
    id: SYSTEM_PROFILE_ID,
    label: 'System voices',
    rate: 1,
    pitch: 1,
    volume: 1,
    langPrefixes: [],
    nameHints: [],
    onlineVoiceId: '',
  },
];

export function findProfile(profileId) {
  return PROFILE_CATALOG.find((profile) => profile.id === profileId) || PROFILE_CATALOG[0];
}

export const PROFILE_ALIASES = { ariel: 'echo', voice11: 'echo' };

export function profileFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = String(params.get('profile') || '').trim().toLowerCase();
  const profileId = PROFILE_ALIASES[raw] || raw;
  return PROFILE_CATALOG.some((profile) => profile.id === profileId) ? profileId : '';
}

export function persistQueryProfile(profileId) {
  const url = new URL(window.location.href);
  url.searchParams.set('profile', profileId);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

