function isLikelyCreditCard(value) {
  if (!/(?:\d[ -]?){12,18}\d/.test(String(value || ''))) return false;
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleNext = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (doubleNext) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleNext = !doubleNext;
  }
  return sum > 0 && sum % 10 === 0;
}

function isLikelyPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function createPiiReducer() {
  const replacements = [];
  const seen = new Map();
  const counters = {};
  const remember = (type, value) => {
    const original = String(value || '');
    if (!original) return original;
    const key = `${type}\0${original}`;
    if (seen.has(key)) return seen.get(key);
    counters[type] = (counters[type] || 0) + 1;
    const placeholder = `[${type}_${counters[type]}]`;
    seen.set(key, placeholder);
    replacements.push({ placeholder, value: original });
    return placeholder;
  };
  return { replacements, remember };
}

function reducePiiText(text, reducer = createPiiReducer()) {
  let out = String(text || '');
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, value => reducer.remember('EMAIL', value));
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, value => reducer.remember('SSN', value));
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, value => reducer.remember('TOKEN', value));
  out = out.replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, value => reducer.remember('SECRET', value));
  out = out.replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, value => reducer.remember('IP', value));
  out = out.replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Place|Pl|Way)\b\.?/gi, value => reducer.remember('ADDRESS', value));
  out = out.replace(/(?:\d[ -]*?){13,19}/g, value => isLikelyCreditCard(value) ? reducer.remember('CARD', value) : value);
  out = out.replace(/(?:\+\d{1,3}[ .-]?)?(?:\(?\d+(?:\)\s?\d+)(?:[.-]\d+)*|\d{1,4}(?:([ .-])\d{1,4}(?:\1\d{1,4})+)|\d+(?:[.-]\d+)*)/g, value => isLikelyPhone(value) ? reducer.remember('PHONE', value) : value);
  return out;
}

function restorePiiText(text, replacements = []) {
  let out = String(text || '');
  for (const item of replacements) {
    out = out.split(item.placeholder).join(item.value);
  }
  return out;
}

function reducePiiMessages(messages, enabled = true) {
  const reducer = createPiiReducer();
  if (!enabled) return { messages, replacements: reducer.replacements };
  return {
    messages: messages.map(message => ({
      ...message,
      content: reducePiiText(message.content, reducer),
    })),
    replacements: reducer.replacements,
  };
}

function restorePiiResult(result, replacements) {
  if (!replacements?.length || !result || typeof result.text !== 'string') return result;
  return { ...result, text: restorePiiText(result.text, replacements) };
}


module.exports = {
  createPiiReducer,
  reducePiiText,
  restorePiiText,
  reducePiiMessages,
  restorePiiResult,
  isLikelyCreditCard,
  isLikelyPhone,
};
