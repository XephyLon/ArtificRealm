# Map Slash Commands — Design

**Goal:** Let the AI directly invoke map actions (start a journey, drop a pin, reveal fog, register a travel option) during narration, instead of only being able to write raw `World.*` MVU fields by hand.

## Background

The card's `tavern_helper` extension already has four scripts: `Scheme` (the zod schema), `變量監控` (combat-stat auto-correction), `mvu` (imports the MagVarUpdate bundle), and `診斷` — a diagnostic dead-end from a past attempt to add slash commands. `診斷` was hunting for an `addCommands` function on the `Mvu` instance, never found it, and just dumps `Mvu`'s structure to the console for manual inspection — no working slash-command registration exists anywhere in this card today.

The actual SillyTavern API for this is `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))` — a different global than `Mvu` entirely. `tavern_helper` scripts run directly in the top SillyTavern window (unlike StatusMenu.html, which is sandboxed in an iframe and only reaches the top window through `window.parent`), so `SlashCommandParser`/`SlashCommand` are available to a new script as plain globals.

## Architecture

A new tavern_helper script, **`MapCommands`**, added alongside the existing four. On load it calls `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))` once per command below.

Each command's callback:

1. Resolves the relevant `stat_data` via `getVariables({type:'message', message_id})` when a message context is available, falling back to global `getVariables()` — the same fallback chain StatusMenu.html's `refreshFromMvu` already uses, kept consistent so behavior doesn't diverge across the two scripts.
2. Mutates a plain JS clone of `stat_data` — each command replicates the small bit of logic its StatusMenu.html counterpart has (vehicle lookup, origin lookup, etc.), it does not call into StatusMenu.html's functions.
3. Persists via `updateVariablesWith(fn, context)` — the same functional-update API StatusMenu.html already uses, so it merges instead of clobbering other extensions' variables.

StatusMenu.html is **not modified**. It keeps polling and rendering exactly as today, blind to whether a `World.*` write came from a slash command or a direct AI MVU write — there is no new "AI vs user" state split, matching the existing architecture note in CLAUDE.md.

**Why not call StatusMenu.html's functions directly (the alternative considered):** that would require StatusMenu.html to expose `startJourney`/`addPin`/etc. on its own `window`, and the slash command to locate the *specific* message's iframe by DOM lookup. That couples the command to a particular iframe instance being mounted at call time and is more fragile than just writing the MVU fields the AI could already write by hand, only friendlier.

## Commands

| Command | Args | Mirrors | Mutates |
|---|---|---|---|
| `/startjourney` | `destx`, `desty`, `destname`, `vehicle` | `startJourney` | `World.Travel` |
| `/arrive` | (none) | `arriveAtDestination` | `World.PartyPosition`, `World.Travel.Active` |
| `/addtravelhours` | `hours` | `addTravelHours` | `World.Travel.ElapsedHours` |
| `/addpin` | `name`, `x`, `y`, `note`, `icon` | (new) | `World.MapPins` |
| `/revealfog` | `name` | (new) | `World.FogRegions.<key>.Revealed` |
| `/addtraveloption` | `name`, `mode`, `speed` | (new) | `World.TravelOptions` |

### `/startjourney destx= desty= destname= vehicle=`

- `vehicle` matches against `World.TravelOptions` first by collection key, then case-insensitively by `Name`. No match → return `"Error: vehicle '<vehicle>' not found"`, no mutation.
- Origin = current `World.PartyPosition` (default `{X:0,Y:0}` if unset).
- `destx`/`desty` coerced with `Number()`; `NaN` → `"Error: destx/desty must be numbers"`, no mutation.
- On success, sets `World.Travel = {Active:true, OriginX, OriginY, DestX, DestY, DestName, VehicleName, VehicleMode, SpeedKmh, ElapsedHours:0}` (same shape `startJourney` already builds, including the `VehicleMode` field added for the flight-arc rendering fix).
- Returns `"Journey started toward <DestName> (<dist>km, ~<eta>h)"` using the same distance/ETA math as `computeTravelEta`/the lorebook's `Distance = sqrt(...) * 50` formula.

### `/arrive`

- No-op with `"Error: no active journey"` if `World.Travel.Active` isn't true.
- Otherwise sets `World.PartyPosition = {X: Travel.DestX, Y: Travel.DestY}`, `Travel.Active = false`. Returns `"Arrived at <DestName>"`.

### `/addtravelhours hours=`

- `hours` coerced with `Number()`; `NaN` or `<=0` → error, no mutation.
- No-op with `"Error: no active journey"` if `Travel.Active` isn't true.
- Adds to `Travel.ElapsedHours`. Returns `"Added <hours>h (total elapsed: <total>h)"`.

### `/addpin name= x= y= note= icon=`

- `x`/`y` required, `Number()`-coerced, `NaN` → error.
- `note` and `icon` optional, default `''` and `'pin'`.
- Defensively initializes `World.MapPins = {}` if missing.
- Appends a new entry (key generated the same way the existing "Add Pin" UI flow does — `generateMapItemKey('pin')`-style). Returns `"Pin '<name>' added at (<x>,<y>)"`.

### `/revealfog name=`

- Matches `World.FogRegions` entries case-insensitively by `Name`. No match → `"Error: fog region '<name>' not found"`, no mutation.
- Sets that entry's `Revealed = true`. Returns `"Fog region '<name>' revealed"`.

### `/addtraveloption name= mode= speed=`

- `speed` required, `Number()`-coerced, `NaN` → error.
- `mode` free-text (matches the existing `Mode` field convention: `'Walking'|'Mounted'|'Sailing'|'Flying'`, but not enforced — StatusMenu.html's arc-vs-straight check only special-cases `'Flying'`, anything else renders as a straight line, so a typo'd mode just silently doesn't get the arc rather than erroring).
- Defensively initializes `World.TravelOptions = {}` if missing.
- Appends a new entry. Returns `"Travel option '<name>' added (<mode>, <speed>km/h)"`.

## Error handling

Every callback returns a short status string on both success and failure (`"Error: ..."` prefix on failure) rather than throwing or silently no-opping, so failures are visible in chat/console regardless of how SillyTavern's STscript handles the command's return value when it appears inline in AI-authored text. No command mutates state when it returns an error string.

## Testing

The existing puppeteer harness (`/tmp/map-smoketest`) mocks only the iframe+host pair for StatusMenu.html — it has no `SlashCommandParser`/`SlashCommand` globals, so these commands cannot be exercised there. **This is a real coverage gap, not glossed over**: verification has to happen by loading the actual card in real SillyTavern and running each command manually from the chat input box (e.g. `/startjourney destx=10 desty=20 destname=Test vehicle=Airship`), then confirming both the returned status string and that StatusMenu.html's map re-renders correctly afterward (the existing polling picks up the MVU write with no code changes needed on that side).

## Card schema impact

None. All six commands write into `World.*` fields (`Travel`, `PartyPosition`, `MapPins`, `FogRegions`, `TravelOptions`) that already exist in `worldSchema` from the original interactive-map work — no new schema fields, no new `.passthrough()` risk.
