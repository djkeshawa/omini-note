#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUIRED_ENV = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
];

function assertSigningEnvironment(env = process.env) {
  const missing = REQUIRED_ENV.filter(name => !String(env[name] || '').trim());
  if (missing.length) {
    throw new Error(`macOS release signing requires: ${missing.join(', ')}`);
  }
}

function decodeApiKey(encoded) {
  const compact = String(encoded || '').replace(/\s+/g, '');
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error('APPLE_API_KEY_BASE64 is not valid base64');
  }
  const decoded = Buffer.from(compact, 'base64');
  const text = decoded.toString('utf8');
  if (!text.includes('BEGIN PRIVATE KEY') || !text.includes('END PRIVATE KEY')) {
    throw new Error('APPLE_API_KEY_BASE64 does not contain an App Store Connect private key');
  }
  return decoded;
}

function appendGithubEnv(file, name, value) {
  if (!file) throw new Error('GITHUB_ENV is required on the release runner');
  fs.appendFileSync(file, `${name}=${value}${os.EOL}`, 'utf8');
}

function prepareMacosSigning(env = process.env) {
  assertSigningEnvironment(env);
  if (!/^[A-Za-z0-9_-]+$/.test(env.APPLE_API_KEY_ID)) {
    throw new Error('APPLE_API_KEY_ID contains unsupported characters');
  }
  const tempRoot = path.resolve(env.RUNNER_TEMP || os.tmpdir());
  fs.mkdirSync(tempRoot, { recursive: true });
  const keyFile = path.join(tempRoot, `AuthKey_${env.APPLE_API_KEY_ID}.p8`);
  fs.writeFileSync(keyFile, decodeApiKey(env.APPLE_API_KEY_BASE64), { mode: 0o600 });
  fs.chmodSync(keyFile, 0o600);
  appendGithubEnv(env.GITHUB_ENV, 'APPLE_API_KEY', keyFile);
  appendGithubEnv(env.GITHUB_ENV, 'APPLE_API_KEY_ID', env.APPLE_API_KEY_ID);
  appendGithubEnv(env.GITHUB_ENV, 'APPLE_API_ISSUER', env.APPLE_API_ISSUER);
  return keyFile;
}

function main() {
  const keyFile = prepareMacosSigning();
  console.log(`Prepared App Store Connect key at ${keyFile}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_ENV,
  assertSigningEnvironment,
  decodeApiKey,
  prepareMacosSigning,
};
