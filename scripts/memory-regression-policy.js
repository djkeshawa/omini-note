function isAuthenticationError(error) {
  const message = `${error?.message || error || ''} ${error?.status || ''}`;
  return /authentication required|unauthori[sz]ed|forbidden|\b40[13]\b/i.test(message);
}

function shouldSkipOptionalSecuredServer({ error, apiKey = '', required = false } = {}) {
  return required !== true && !String(apiKey || '').trim() && isAuthenticationError(error);
}

module.exports = {
  isAuthenticationError,
  shouldSkipOptionalSecuredServer,
};
