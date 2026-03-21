---
name: New shader checklist
description: Steps required whenever a new shader is added to the theme
type: feedback
---

When adding a new shader, also add it to `test-shaders.html` in the project root.

**Why:** The file serves as a local test harness for shaders outside of the Shopify dev server.

**How to apply:** Any time a new shader (`assets/[name].js` + `snippets/shader-controls-[name].liquid`) is created, update `test-shaders.html` to include it alongside the existing shaders.
