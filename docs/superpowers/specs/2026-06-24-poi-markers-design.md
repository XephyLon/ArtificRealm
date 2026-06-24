# Lorebook POI Markers + Party-Member Locations — Design

**Goal:** Seed the interactive map with the ~50 named locations from the world lorebook as permanent, visually-distinct "points of interest" (POI) markers, separate from player-placed pins and AI-discovered `World_Calc` entries. Also let party members who are elsewhere (or present-but-separate) show up on the map at their own coordinates instead of always being implied to be wherever `World.PartyPosition` is.

**Source data:** the `<map_coordinate>` lorebook entry pasted into chat 2026-06-24, defining the Old Continent / Endless Ocean / New Continent geography, the shared coordinate system (origin = center of Old Continent, +X east, +Y north, 1 unit = 50 km), and ~54 named locations (33 Old Continent, 21 New Continent — the latter gated behind `Mainchar.Level > 70` in the lorebook's own template logic).

## 1. Data model

### `World.PointsOfInterest` (new collection)

Plain record collection, same shape family as `World.MapPins`/`World.FogRegions`. Each entry:

```js
{ Name: string, X: number, Y: number, Type: 'capital'|'settlement'|'faction'|'ruins'|'special', Note: string }
```

- `Type` drives the marker icon (see §3). Assigned per-entry from the lorebook's own groupings (kingdom capitals → `capital`; lesser towns/ports/forts → `settlement`; demi-human/dwarven/elven/bloodline faction holdings → `faction`; ruins/battlefields/necropolises/graveyards → `ruins`; anomalous or mythic sites → `special`).
- `Note` is empty for now — free text slot for future flavor, not populated from the lorebook (which gives no descriptions).
- Seeded once, idempotently, via a `DEFAULT_POINTS_OF_INTEREST` constant + `ensureMapDefaults()` check (`if (!stat.World.PointsOfInterest) { ...; changed = true; }`), exactly like `DEFAULT_FOG_REGIONS`/`DEFAULT_TRAVEL_OPTIONS` are today. Static reference data, not written to again afterward — the AI/user don't edit it (no `data-allow-add`/edit affordance; see §3 read-only behavior).

Full seed dataset (54 entries, slug-keyed):

| Key | Name | X | Y | Type |
|---|---|---|---|---|
| poi_auston | Royal Capital Auston | 15 | -5 | capital |
| poi_barak | Southern Trade Port Barak | 20 | -25 | settlement |
| poi_iron_guard_fortress | Iron Guard Fortress | 10 | 0 | settlement |
| poi_lumina | Holy City Lumina | -3 | 75 | capital |
| poi_port_of_joy | Port of Joy (Feiyue Port) | 95 | 100 | settlement |
| poi_thousand_sails | Capital City of Thousand Sails | 40 | 40 | capital |
| poi_wave_lost_city | Wave-Lost City | 50 | 80 | special |
| poi_black_iron_fortress | Black Iron Fortress | 5 | 140 | settlement |
| poi_blue_lookout_village | Blue Lookout Village | 60 | 50 | settlement |
| poi_battle_cry_city | Battle Cry City | -35 | 0 | faction |
| poi_ancestral_spirit_mesa | Ancestral Spirit Mesa | -100 | -5 | faction |
| poi_windconflux_city | Windconflux City | -60 | -35 | faction |
| poi_gateward_fortress | Gateward Fortress | -60 | 125 | faction |
| poi_molten_core_great_forge | Molten Core Great Forge | -75 | 120 | faction |
| poi_elven_forest_entrance | Elven Forest Entrance | -10 | -50 | faction |
| poi_scarletleaf_tribe | ScarletLeaf Tribe | -22 | -65 | faction |
| poi_moonwhisper_ruins | MoonWhisper Ruins | -15 | -80 | ruins |
| poi_fairy_forest | Fairy Forest | -30 | -70 | special |
| poi_shackle_city | Shackle City | -20 | 60 | settlement |
| poi_startrace_tower | Startrace Tower | -105 | 95 | special |
| poi_pandemonium_city | Pandemonium City | -170 | 75 | special |
| poi_svartalheim | Svartalheim | 10 | 150 | special |
| poi_tidesong_town | Tidesong Town | 65 | 7 | settlement |
| poi_deep_look_city | Deep Look City | 85 | 10 | settlement |
| poi_atlantis | Atlantis | 85 | 10 | special |
| poi_peak_of_skyfire | Peak of Skyfire | -120 | 125 | special |
| poi_silent_giant_necropolis | Silent Giant Necropolis | -120 | -55 | ruins |
| poi_winged_beasts_firmament | Winged Beasts Firmament | -20 | -40 | special |
| poi_witchwood_forest | Witchwood Forest | 0 | 115 | special |
| poi_mirage_spring_oasis | Mirage Spring Oasis | -110 | 75 | special |
| poi_wailing_battlefield | Wailing Battlefield | -95 | 90 | ruins |
| poi_island_of_lost_time | Island of Lost Time | 95 | 60 | special |
| poi_abyssal_throat | Abyssal Throat | 65 | -22 | ruins |
| poi_frostbound_ice_forest | Frostbound Ice Forest | 30 | 170 | special |
| poi_nameless_island | Nameless Island | 62 | -18 | special |
| poi_luoyang | Divine Capital Luoyang | -300 | 75 | capital |
| poi_tiangong_city | Tiangong City | -330 | 100 | settlement |
| poi_jiangnan | Jiangnan | -300 | 35 | settlement |
| poi_jade_gate_pass | Jade Gate Pass | -270 | 70 | settlement |
| poi_great_wall_entrance | Great Wall Entrance | -280 | 80 | ruins |
| poi_yao_city | Yao City | -220 | -10 | settlement |
| poi_frostfire_keep | Frostfire Keep | -290 | 105 | faction |
| poi_aurora_port | Aurora Port | -295 | 140 | settlement |
| poi_dragonbone_graveyard | Dragonbone Graveyard | -250 | 130 | ruins |
| poi_frostwinter_core_stronghold | Frostwinter Core Stronghold | -365 | 140 | faction |
| poi_celestial_stairway | Celestial Stairway | -220 | 135 | special |
| poi_zahrabad | Zahrabad | -370 | 30 | capital |
| poi_chronos_federation | Chronos Federation | -375 | -40 | capital |
| poi_new_hope_port | New Hope Port | -390 | -75 | settlement |
| poi_unicorn_sanctum | Unicorn Sanctum | -220 | -75 | special |
| poi_jade_pool | Jade Pool | -320 | 0 | special |
| poi_entrance_settlement | Entrance Settlement | -280 | -80 | settlement |
| poi_hinomoto_shogunate | Hinomoto Shogunate | -280 | -25 | capital |
| poi_deep_forest_core | Deep Forest Core | -210 | -15 | special |

(Classification is best-effort from naming/context — easy to tweak Type per-entry later without any structural change.)

### New Continent level-gate (reuses existing FogRegions entry, no new data needed)

`DEFAULT_FOG_REGIONS` already seeds a `new_continent` region — `{ Name: 'New Continent', X: -400, Y: -100, W: 250, H: 250, MinLevel: 70 }`, i.e. `X:[-400,-150]`, `Y:[-100,150]`. The actual New Continent POI bounding box (computed from the table below) is `X:[-390,-210]`, `Y:[-80,140]` — fully inside the existing rectangle, and no Old Continent POI falls inside `X < -150` (closest is Pandemonium City at `X:-170`). So this needs zero new fog-region data — POI markers just run through the existing `isPointFogged()` check, same as `MapPins`/`World_Calc` pins, and the existing seeded region does the gating already.

### `Familiar.*` member coordinates

Add two plain (non-tuple) fields to `familiarMemberSchema` (card zod schema) and the corresponding StatusMenu rendering: `X`, `Y` (numbers, default `0`). Used to mark a member's location separately from `World.PartyPosition` — including the case where a member is in the same place as another but `Is_present: false` (not in the current scene), or off somewhere else entirely. The AI/user sets these like any other stat field when a member splits off.

## 2. Card schema changes (`tavern_helper` "Scheme" script)

- `worldSchema`: add `PointsOfInterest: z.record(z.string(), poiSchema).prefault({})` where `poiSchema` validates `{Name, X, Y, Type, Note}` with `.passthrough()`.
- `maincharSchema`/`familiarMemberSchema`: add `X: z.coerce.number().prefault(0)`, `Y: z.coerce.number().prefault(0)` to `familiarMemberSchema` only (not `Mainchar` — the player character's position is `World.PartyPosition`).

This mirrors the fix already applied for the original map fields — anything new under `World.*` or `Familiar.*` must be declared here or MVU's zod validation silently strips it.

## 3. Rendering (StatusMenu, embedded in the card's `StatusMenu` regex script)

**POI layer** — new `_mapLayers.poi` + `renderPoiLayer(stat)`, modeled on `renderPinsLayer()`:
- Icon by `Type`: `capital` 🏰, `settlement` 🏘️, `faction` ⚔️, `ruins` 💀, `special` ✨.
- Every POI marker additionally gets a shared CSS class (`map-poi-icon`, distinct gold-ring/border styling) layered on top of the per-type emoji, so the group reads as "lore POI" at a glance versus player `MapPins` (📍, plain pin styling) and `World_Calc`-sourced pins (🏰⚔️🏛️⚡, no ring).
- Filtered through `isPointFogged()` exactly like existing pin sources.
- Click opens `showModal(title, item, false, ...)` — **read-only**, no edit/delete affordance, since this is static reference data.

**Member layer** — new `_mapLayers.members` + `renderMemberLayer(stat)`:
- Reads all `Familiar` entries with numeric `X`/`Y`.
- Groups entries by exact `(X, Y)` match into one marker per unique coordinate (so members traveling together render as a single marker, not stacked duplicates).
- Marker tooltip lists every member's name at that coordinate (works whether or not it coincides with `World.PartyPosition`, and regardless of `Is_present`).
- Distinct icon/bubble color (👥, its own CSS class) — different from the party compass (🧭) and from POI/player pins.
- Not fog-gated — the party's own whereabouts isn't hidden lore.

**Known edge case:** `poi_frostbound_ice_forest` sits at `Y:170`, past the current `MapSettings.MaxY` of `150` (calibrated to the actual `map.png` artwork). Leaving `MapSettings` untouched — re-stretching it would shift every other already-calibrated pin/fog-region. That one marker will render just above the visible map image, in blank canvas. Acceptable; flagged here rather than silently surprising.

**Out of scope:** the lorebook's coordinate-range "Special Area Determination" zones (Frostfall Tundra, Dragonfang Mountains, etc.) are AI-prose flavor triggers, not point locations — not rendered as map overlays.

## 4. Testing

- Manual/headless render check: seed a fresh `stat_data` (no `World` key), call `updateMapPanel`, confirm `World.PointsOfInterest` and the new FogRegion get seeded, all 54 POI markers appear (28 visible, 26 fogged when `Mainchar.Level < 70`; all 54 visible at `Level >= 70`).
- Confirm a POI marker click opens a read-only modal (no save/delete buttons).
- Confirm two `Familiar` entries with identical `X`/`Y` render as one grouped marker with both names in the tooltip; differing coordinates render as separate markers.
- Confirm card's zod schema round-trips `World.PointsOfInterest` and `Familiar.*.X/Y` without stripping (the original map-fields bug).
