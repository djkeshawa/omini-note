# Renderer feature modules

Each product feature owns its UI, controller/hooks, pure model, and renderer services when those layers are needed. External consumers import only from the feature's `index.js`; cross-feature workflows are composed in `src/app`.

Dependency direction is `app -> features -> shared/platform`. Feature internals must not import `src/app` or another feature's private files.
