exports.default = async function beforePack(context) {
  const targetPlatform = context.electronPlatformName;
  if (!targetPlatform || targetPlatform === process.platform) return;

  throw new Error(
    [
      `Refusing to package ${targetPlatform} on ${process.platform}.`,
      'VispNote ships native SQLite modules, so each OS package must be built on the same OS.',
      'Use the release workflow matrix or run the Windows build on Windows.',
    ].join(' ')
  );
};
