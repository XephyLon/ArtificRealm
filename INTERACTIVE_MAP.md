# StatusMenu.html Interactive Map — Architecture Notes

These notes cover the StatusMenu panel embedded in this card (the `StatusMenu` regex script under `extensions.regex_scripts`), focused on the Leaflet-based interactive map feature (`World.MapImage`/`MapSettings`/`MapPins`/`FogRegions`/`TravelOptions`/`PartyPosition`/`Travel`) and the surrounding data/binding plumbing it depends on. StatusMenu.html is a single, self-contained HTML file loaded inside an iframe in the SillyTavern chat UI — no external `<script src>`/CDN dependencies, everything inline (`<script type="module">` near the end of the file). Keep it that way unless a feature genuinely requires vendoring a library inline (the map's vendored Leaflet is the existing example of doing this correctly).

## Data model

All character/world state lives in a single nested object, referred to in the code as `_lastStatData` (kept in sync with SillyTavern's "MVU" variable-extension state). Two persistence backends are used side by side:

- **MVU variables** (via `updateVariablesWith()` / `getVariables()` on `window` or `window.parent`) — the primary store, synced with the chat/character save and across devices. Small values (numbers, strings, list entries) live here.
- **`localStorage`**, keyed `mzsb_img_<fullPath>` — used only for locally-uploaded images (base64 data URIs), to avoid bloating MVU with large strings. Image fields fall back to MVU if no localStorage entry exists (e.g. an image set via URL instead of upload).

Values can be plain (`"Ostin"`) or tuples (`[value, label]`, checked via `isTuple()`/`tupleVal()`) — used where a stat needs both a raw value and a display label. Helpers `getRaw`/`getV`/`getL`/`setVal` (using lodash `_.get`/`_.set` when available, with manual path-walking fallback) are the standard way to read/write paths like `"Mainchar.Level"` or `"World_Calc.Locations"`.

`COLLECTION_PATHS` (a `Set` of dot-paths) tells the renderer which paths are records-to-be-treated-as-lists, overriding the default tuple-or-not heuristics.

## Binding system (declarative, via `data-*` attributes)

- `data-bind-fullpath="X.Y"` — wraps a field; scopes child bindings.
- `data-bind-val` / plain text bindings — render a single value.
- `data-bind-img="LeafName"` + `data-save-root`/`data-save-leaf` — image fields; click the pencil (`handleEditClick`) to upload/replace, click the image (`showImagePopup`) to view fullscreen.
- `data-bind-list="Name"` / `data-bind-list-fullpath="Full.Path"` with `class="simple-list"`, `data-list-type`, `data-allow-edit`, `data-allow-delete` — renders a collection. Clicking a row opens `showModal(title, data, allowEdit, listPath, itemKey)`, a generic key/value detail-and-edit popup. A list can opt into a "+ Add" button via `data-allow-add="1"` plus `data-add-key-prefix`/`data-add-defaults` (a JSON string for the new item's starting shape) — generic and reusable, currently used by `World.TravelOptions` and `World.FogRegions` (`World.MapPins` is created a different way, via the map's click-to-place "Add Pin" flow calling `showModal()` directly, not this attribute); most lists still omit it and are populated only by the AI's own MVU updates during the story.
- `data-bind-root="World"` + `data-template="tpl-..."` + `<template id="tpl-...">` — repeating block renderer (`prop-list`), used for the bigger per-tab card sections.
- `data-page-size` — pagination for list/block renderers.

The page is organized into `.tab-content` panes (a custom tab system, not `<details>`/native), each containing `.col-wrapper` columns of `.info-card`s.

## Save pipeline (the pattern to follow for any new mutable field)

1. Mutate `_lastStatData` directly (see `deleteListItem()` for the canonical example: navigate via `path.split('.')`, mutate, done).
2. Re-render: `updateStatusPanel({ stat_data: _lastStatData })`.
3. Persist: `saveStatData(_lastStatData)` → prefers `updateVariablesWith()` (functional update, avoids clobbering other extensions' variables) when available.

Both the AI (writing MVU variables directly as part of its narrative output) and the user (via this page's edit/delete UI) write through the same paths — there is no separate "AI state" vs "user state."

## Iframe/host integration

The script defensively tries `window.parent` (SillyTavern's main window) for: chat scroll-position bookkeeping, theme CSS variables, and hosting modals in the parent document (so they aren't clipped by the iframe's own scroll/size). Cross-origin access is wrapped in `try`/`catch` and falls back to local `window`/`document`. `window.frameElement` is used to read the iframe's own position within the parent chat for scroll-sync.

CSS theme values (`--accent-primary`, `--background-card`, `--text-primary`, `--border-color`, etc.) are read live via `getComputedStyle` rather than hardcoded, so new UI should do the same to stay on-theme across genre/skin variants.

## Map artwork

`map.png` ("Artific Realm") is the image bound at `World.MapImage`. A reference version with a coordinate grid and a 51-location legend exists at the project's GitHub repo (`KritBlade/ArtificRealm`, `Image/map.jpg` and `Image/map1.jpg` for the fogged variant) — useful context if recalibrating coordinates, but not vendored into this repo. Confirmed coordinate system: X spans -400 (west) to 100 (east), Y spans -100 (south) to 150 (north), 1 unit = 50 km, Y-up (matches Leaflet's `CRS.Simple` convention directly, no conversion needed).

## Interactive map

The static `World.MapImage` `<img>` on the Map card is now a Leaflet map (vendored inline, same single-file constraint as everything else). New `World.*` fields:

- `MapSettings` — `{MinX, MaxX, MinY, MaxY, MapScale}`, the image-overlay bounds and km-per-unit scale (defaults: -400/100/-100/150/50).
- `MapPins` — collection, `{Name, Note, X, Y, Icon}`. User-created via the map's "📍 Add Pin" flow (click the button, click the map, fill in the popup) — this is the first and only "create new list item" UI in the file (see the Binding system note above).
- `FogRegions` — collection, `{Name, X, Y, W, H, MinLevel, Revealed}`. A region is hidden (pin and any matching list row redacted) while `Mainchar.Level < MinLevel` and `Revealed` isn't `true`.
- `TravelOptions` — collection, `{Name, Mode, Speed}` (km/h). Seeded with on-foot/horse/sailing-ship/airship.
- `PartyPosition` — `{X, Y}`. Draggable on the map; not draggable mid-journey.
- `Travel` — `{Active, OriginX, OriginY, DestX, DestY, DestName, VehicleName, SpeedKmh, ElapsedHours}`. Drives the travel panel's progress bar/ETA and the "🧭 Plan Route" flow.

`ensureMapDefaults()` seeds all of the above into `World` the first time any are missing (idempotent, called from `updateMapPanel` on every render). Existing `World_Calc.Locations`/`Factions`/`Ruins`/`Events` items can optionally carry `X`/`Y` fields to show up as map pins too (`MAP_PIN_SOURCES`) — no schema change needed for those.

`_leafletMap` is long-lived: created once via `initLeafletMapIfNeeded()` (guarded against recreation), unlike the rest of the file's list/card content, which gets torn down and rebuilt from scratch on every render via `updateBindingsIn`/`renderBlock`. `updateMapPanel(stat)` — called from `updateStatusPanel`'s Phase 3 — is the per-render sync point: it updates the existing map's layers (fog/pins/party/travel), it does not rebuild the map itself. Tab switches matter here too: the Map card lives on a `.tab-content` pane, so the container can be zero-sized until its tab is selected; `selectTab()` calls `_leafletMap.invalidateSize()` on a short delay to handle this, and the fullscreen toggle (`toggleMapFullscreen()`, which re-parents the container into `window.parent`'s document, same as `showModal`) does the same.

See `docs/superpowers/specs/2026-06-24-interactive-map-design.md` for the full design rationale and `docs/superpowers/plans/2026-06-24-interactive-map.md` for the task-by-task implementation history. The feature is complete; both docs are kept for reference, not as a pointer to unfinished work.

### Card-side MVU schema requirement

This file is only half the picture in real SillyTavern. The character card (separate repo, `KritBlade/ArtificRealm` upstream / `XephyLon/ArtificRealm` fork) defines a zod schema in its `tavern_helper` extension's "Scheme" script (`extensions.tavern_helper.scripts[]`, entry named `Scheme`) that MVU validates `stat_data` against on every read/write. Zod's default `.object()` strips any key not explicitly declared in the schema (unless `.passthrough()` is set). **Every new `World.*` field added here must also be added to that card-side `worldSchema`**, or MVU will silently delete it before this page ever sees it — this is exactly what happened with the map fields (`MapImage`, `MapSettings`, `MapPins`, `FogRegions`, `TravelOptions`, `PartyPosition`, `Travel`) until fixed. `worldSchema` now also carries a defensive `.passthrough()` (matching `world_CalcSchema`'s existing pattern) so future ad-hoc fields fail soft instead of vanishing silently — but passthrough fields skip type coercion/defaults, so still add an explicit entry for anything that needs `prefault`/numeric coercion.
