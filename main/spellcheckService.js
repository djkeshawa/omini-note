const fs = require('fs');
const { normalizeSpellWord } = require('../lib/connectors/ipc/preferenceValidation');

function createSpellcheckService() {
const SPELL_DICTIONARY_PATHS = [
  '/usr/share/dict/american-english',
  '/usr/share/dict/british-english',
  '/usr/share/hunspell/en_US.dic',
  '/usr/share/hunspell/en_GB.dic',
];
const SPELL_SUGGESTION_CACHE_LIMIT = 1000;
const MIN_USABLE_DICTIONARY_WORDS = 1000;
let spellWords = null;
let spellWordsPromise = null;
let spellWordBuckets = null;
let spellDictionaryAvailable = false;
const spellSuggestionCache = new Map();

const COMMON_SPELL_WORDS = [
  'about', 'after', 'again', 'also', 'because', 'block', 'blocks', 'calendar',
  'check', 'checker', 'code', 'correct', 'document', 'editor', 'feature',
  'features', 'highlight', 'language', 'markdown', 'misspelled', 'note',
  'notes', 'notification', 'notifications', 'programming', 'reminder',
  'reminders', 'settings', 'spell', 'spelling', 'suggestion', 'suggestions',
  'syntax', 'text', 'their', 'there', 'these', 'this', 'typing', 'with',
  'word', 'words', 'working',
];
async function loadSpellWords() {
  if (spellWords) return spellWords;
  if (spellWordsPromise) return await spellWordsPromise;
  spellWordsPromise = loadSpellWordsFromDisk();
  return await spellWordsPromise;
}

async function loadSpellWordsFromDisk() {
  const words = new Set();
  let loadedDictionaryWords = 0;
  for (const file of SPELL_DICTIONARY_PATHS) {
    try {
      const lines = (await fs.promises.readFile(file, 'utf8')).split(/\r?\n/);
      for (const line of lines) {
        const raw = line.replace(/\/.*$/, '').trim();
        const word = normalizeSpellWord(raw);
        if (word.length >= 2 && /^[a-z][a-z']*$/.test(word)) {
          const before = words.size;
          words.add(word);
          if (words.size > before) loadedDictionaryWords++;
        }
      }
    } catch {}
  }
  if (loadedDictionaryWords < MIN_USABLE_DICTIONARY_WORDS) {
    spellWords = new Set();
    spellWordBuckets = new Map();
    spellDictionaryAvailable = false;
    return spellWords;
  }
  for (const word of COMMON_SPELL_WORDS) words.add(word);
  spellDictionaryAvailable = true;
  spellWordBuckets = new Map();
  for (const word of words) {
    const first = word[0] || '';
    if (!spellWordBuckets.has(first)) spellWordBuckets.set(first, []);
    spellWordBuckets.get(first).push(word);
  }
  spellWords = words;
  return spellWords;
}

function spellDistance(a, b) {
  const alen = a.length, blen = b.length;
  if (Math.abs(alen - blen) > 2) return 99;
  const prev = Array.from({ length: blen + 1 }, (_, i) => i);
  for (let i = 1; i <= alen; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= blen; j++) {
      const old = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + cost);
      last = old;
    }
  }
  return prev[blen];
}

function spellSuggestions(word, dictionary) {
  if (spellSuggestionCache.has(word)) {
    const cached = spellSuggestionCache.get(word);
    spellSuggestionCache.delete(word);
    spellSuggestionCache.set(word, cached);
    return cached;
  }
  const first = word[0];
  const maxDistance = word.length <= 5 ? 1 : 2;
  const scored = [];
  const candidates = spellWordBuckets?.get(first) || dictionary;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - word.length) > maxDistance) continue;
    const distance = spellDistance(word, candidate);
    if (distance <= maxDistance) scored.push({ candidate, distance });
  }
  const suggestions = scored
    .sort((a, b) => a.distance - b.distance || a.candidate.length - b.candidate.length || a.candidate.localeCompare(b.candidate))
    .slice(0, 5)
    .map(item => item.candidate);
  if (spellSuggestionCache.size >= SPELL_SUGGESTION_CACHE_LIMIT) {
    const oldest = spellSuggestionCache.keys().next().value;
    spellSuggestionCache.delete(oldest);
  }
  spellSuggestionCache.set(word, suggestions);
  return suggestions;
}

async function spellcheckWords(inputWords = []) {
  const dictionary = await loadSpellWords();
  if (!spellDictionaryAvailable) return {};
  const result = {};
  for (const raw of inputWords) {
    const word = normalizeSpellWord(raw);
    if (!word || word.length < 3 || dictionary.has(word)) continue;
    result[word] = spellSuggestions(word, dictionary);
  }
  return result;
}


  return { spellcheckWords, loadSpellWords };
}

module.exports = { createSpellcheckService };
