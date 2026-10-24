# Source inventory checkpoint — 2026-10-24

Source repositories were inspected through their GitHub default branches, read-only. These are **migration input pins**, not a claim that feature parity is reached.

| Repository | Inspected `main` commit | Inspected declared version | Relevant systems |
| --- | --- | --- | --- |
| [CEOS](https://github.com/m-amirov/codex-engineering-system) | `c8cc13bd3852409be93097ee823e9cd35e512b73` | `0.5.40` | Workflow engine, checkpoints, evidence, git preflight, routing, production art, global installer |
| [Starter Kit](https://github.com/m-amirov/starter-kit-yandex-games) | `7595fefe4e125c37c57a830d9bce60deda083489` | `0.5.15` | Profiles, new/mature project updater, manifest ownership, Yandex/VK validation, evidence gates |

## Migration input handling

1. Create machine-readable file-level ownership and feature inventory pinned to these SHAs (or deliberately repin a newer source before phase 2).
2. For migrated code, preserve license attribution and provenance; do not copy the complete source trees as-is.
3. Characterize behavior with upstream tests and sanitized fixtures before extracting a module.
4. Record the old→new path and interface mapping, associated test, and parity verdict for each migrated behavior.
5. Continue supporting original repositories until migration pilots and release gates pass.

**Open inventory work:** source-level feature parity table and comprehensive edge-case tests are not yet complete; this checkpoint is structural, not a full audit.
