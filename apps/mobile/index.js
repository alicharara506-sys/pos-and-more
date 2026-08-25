// Custom entry point, used instead of `expo/AppEntry.js`'s default. That
// file imports the app via `../../App`, a relative path that assumes a
// specific node_modules nesting depth — an assumption that breaks under a
// pnpm monorepo (isolated symlinks resolve to a `.pnpm` store path at a
// different depth; a hoisted linker places `expo` at the workspace root
// instead of this app's own node_modules). Importing `./App` directly
// sidesteps that assumption entirely — see metro.config.js for the related
// pnpm-monorepo Metro resolver configuration.
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
