let activeRegistry = null;

function getAppActionRegistry() {
  return activeRegistry;
}

function setAppActionRegistry(registry) {
  activeRegistry = registry || null;
  return activeRegistry;
}

function clearAppActionRegistry(registry = null) {
  if (!registry || activeRegistry === registry) activeRegistry = null;
}

export { clearAppActionRegistry, getAppActionRegistry, setAppActionRegistry };
