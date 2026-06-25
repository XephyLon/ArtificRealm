# Map Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new tavern_helper script, `MapCommands`, to the ArtificRealm card JSON that registers 6 slash commands (`/startjourney`, `/arrive`, `/addtravelhours`, `/addpin`, `/revealfog`, `/addtraveloption`) so the AI can drive map state during narration instead of only writing raw `World.*` MVU fields by hand.

**Architecture:** Single new script file, written and synta-checked locally with Node, then injected into `data.extensions.tavern_helper.scripts[]` in `/home/xephy/ArtificRealm/src/ArtificRealm創世域_Eng.json` via the same extract-edit-writeback Python pattern already used for `StatusMenu`/`Map_coordinate` elsewhere in this repo. Each command resolves `stat_data` via `getVariables()`, mutates a clone, and persists via `updateVariablesWith()` — the same globals StatusMenu.html already uses, so no `Mvu`-internals digging (that's what the existing dead-end `診斷` script already tried and failed at).

**Tech Stack:** Plain JS (no build step, no bundler — matches every other script in this card), `SlashCommandParser`/`SlashCommand` (SillyTavern core globals, available directly in tavern_helper scripts since they run in the top window), Python 3 (`json` stdlib) for the JSON read/write-back.

---

## Why no automated test runner

This repo has no JS test framework and no `package.json` — `node --check` (syntax-only) is the only automated verification available locally for the new script. `SlashCommandParser`/`SlashCommand`/`getVariables`/`updateVariablesWith` are SillyTavern runtime globals; they don't exist outside a running SillyTavern instance, so there is no way to unit-test command *behavior* outside of real SillyTavern (this gap is called out explicitly in the design spec's Testing section — don't try to fake it with a mock harness, that would test the mock, not the command). Each task below therefore pairs a `node --check` syntax gate with a **manual verification step you run inside real SillyTavern** before considering the task done.

## File Structure

- Create: `/home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js` — scratch file holding the new script's full source. Built incrementally, one command at a time, each command separated into its own named function for clarity (`registerStartJourney()`, `registerArrive()`, etc.) called from a single top-level `initMapCommands()`.
- Modify: `/home/xephy/ArtificRealm/src/ArtificRealm創世域_Eng.json` — `data.extensions.tavern_helper.scripts[]`, append one new entry: `{name: "MapCommands", content: <map_commands.js contents>}` (match the exact key shape of the existing `Scheme`/`mvu`/`變量監控`/`診斷` entries — confirm shape in Task 1 before writing).

One file. The spec's 6 commands share enough infrastructure (the `getVariables`/`updateVariablesWith` resolution helper, the name-or-key matching helper) that splitting them into multiple files would just mean threading shared helpers across files for no isolation benefit — this mirrors how the existing tavern_helper scripts are each a single file already.

---

### Task 1: Inspect existing tavern_helper script entry shape and SillyTavern slash-command globals

**Files:**
- Read only: `/home/xephy/ArtificRealm/src/ArtificRealm創世域_Eng.json` (`data.extensions.tavern_helper.scripts[]`)

- [ ] **Step 1: Extract and print the exact keys of one existing script entry**

```bash
cd /home/xephy/.claude/jobs/<job-id>/tmp && python3 - <<'EOF'
import json
path = "/home/xephy/ArtificRealm/src/ArtificRealm創世域_Eng.json"
with open(path, encoding='utf-8') as f:
    data = json.load(f)
scripts = data['data']['extensions']['tavern_helper']['scripts']
for s in scripts:
    print(s.get('name'), '| keys:', sorted(s.keys()))
EOF
```

Expected output: 4 lines (`變量監控`, `診斷`, `mvu`, `Scheme`), each showing the same set of keys (likely `id`, `name`, `content`, possibly `enabled`/`moduleName` — record whatever the real output shows, since this determines exactly which keys the new `MapCommands` entry must include in Task 8).

- [ ] **Step 2: Record the exact key set for use in Task 8**

Write the key list down (e.g. in a comment in `map_commands.js`'s header, or just keep it in your working notes) — Task 8's Python script must produce an entry with this exact key set, or SillyTavern may reject/ignore the new script.

No commit for this task — read-only investigation.

---

### Task 2: Scaffold the script file with the stat-resolution and persistence helpers

**Files:**
- Create: `/home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`

- [ ] **Step 1: Write the shared helpers all 6 commands depend on**

```js
/**
 * MapCommands — slash commands letting the AI drive World.* map state
 * (journeys, pins, fog, travel options) directly, instead of only
 * writing raw MVU fields by hand. Mirrors the same getVariables/
 * updateVariablesWith pattern StatusMenu.html's refreshFromMvu uses,
 * so there is no separate "AI state" vs "user state" path.
 */

function resolveMapCommandContext() {
    if (typeof getCurrentMessageId === 'function') {
        const msgId = Number(getCurrentMessageId());
        if (Number.isFinite(msgId) && msgId >= 0) {
            return { type: 'message', message_id: msgId };
        }
    }
    return undefined;
}

function getMapCommandStatData() {
    const context = resolveMapCommandContext();
    if (context) {
        const vars = getVariables(context);
        if (vars && vars.stat_data) return vars.stat_data;
    }
    const globalVars = getVariables();
    return (globalVars && globalVars.stat_data) || null;
}

async function saveMapCommandStatData(mutateFn) {
    const context = resolveMapCommandContext();
    await updateVariablesWith((vars) => {
        if (!vars.stat_data) vars.stat_data = {};
        if (!vars.stat_data.World) vars.stat_data.World = {};
        mutateFn(vars.stat_data);
        return vars;
    }, context);
}

function findByKeyOrName(collection, identifier) {
    if (!collection || !identifier) return null;
    if (collection[identifier]) return { key: identifier, ...collection[identifier] };
    const lower = String(identifier).toLowerCase();
    for (const [key, value] of Object.entries(collection)) {
        if (key === '$meta' || key === '$key' || key === 'template') continue;
        if (value && typeof value.Name === 'string' && value.Name.toLowerCase() === lower) {
            return { key, ...value };
        }
    }
    return null;
}

function generateMapCommandKey(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check /home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`
Expected: no output, exit code 0.

No commit yet — this file isn't wired into anything until Task 8.

---

### Task 3: `/startjourney` command

**Files:**
- Modify: `/home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js` (append)

- [ ] **Step 1: Write the distance/ETA helper and the command registration**

This mirrors `computeTravelEta`'s distance math from StatusMenu.html (`Distance = sqrt(dx²+dy²) * MapScale`) and `startJourney`'s `World.Travel` shape (including `VehicleMode`, added for the flight-arc fix).

```js
function mapCommandDistanceKm(ox, oy, dx, dy, mapScale) {
    const ddx = dx - ox, ddy = dy - oy;
    return Math.sqrt(ddx * ddx + ddy * ddy) * mapScale;
}

function registerStartJourney() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'startjourney',
        callback: async (namedArgs) => {
            const destX = Number(namedArgs.destx);
            const destY = Number(namedArgs.desty);
            if (!Number.isFinite(destX) || !Number.isFinite(destY)) {
                return 'Error: destx/desty must be numbers';
            }
            const stat = getMapCommandStatData();
            if (!stat) return 'Error: no stat_data available';
            const vehicleOptions = (stat.World && stat.World.TravelOptions) || {};
            const vehicle = findByKeyOrName(vehicleOptions, namedArgs.vehicle);
            if (!vehicle) return `Error: vehicle '${namedArgs.vehicle}' not found`;

            const origin = (stat.World && stat.World.PartyPosition) || { X: 0, Y: 0 };
            const mapScale = Number((stat.World && stat.World.MapSettings && stat.World.MapSettings.MapScale) || 50) || 50;
            const destName = namedArgs.destname || '';

            await saveMapCommandStatData((s) => {
                s.World.Travel = {
                    Active: true,
                    OriginX: origin.X, OriginY: origin.Y,
                    DestX: destX, DestY: destY, DestName: destName,
                    VehicleName: vehicle.Name, VehicleMode: vehicle.Mode, SpeedKmh: vehicle.Speed,
                    ElapsedHours: 0
                };
            });

            const distKm = Math.round(mapCommandDistanceKm(origin.X, origin.Y, destX, destY, mapScale));
            const etaH = vehicle.Speed > 0 ? Math.round(distKm / vehicle.Speed) : 0;
            return `Journey started toward ${destName || '(' + destX + ',' + destY + ')'} (${distKm}km, ~${etaH}h)`;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'destx', description: 'Destination X coordinate', isRequired: true }),
            SlashCommandNamedArgument.fromProps({ name: 'desty', description: 'Destination Y coordinate', isRequired: true }),
            SlashCommandNamedArgument.fromProps({ name: 'destname', description: 'Destination display name', isRequired: false }),
            SlashCommandNamedArgument.fromProps({ name: 'vehicle', description: 'TravelOptions key or Name', isRequired: true }),
        ],
        helpString: 'Starts a journey toward the given coordinates using the named vehicle from World.TravelOptions.',
    }));
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check /home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`
Expected: no output, exit code 0.

No commit yet.

---

### Task 4: `/arrive` and `/addtravelhours` commands

**Files:**
- Modify: `/home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js` (append)

- [ ] **Step 1: Write both commands**

```js
function registerArrive() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'arrive',
        callback: async () => {
            const stat = getMapCommandStatData();
            const travel = stat && stat.World && stat.World.Travel;
            if (!travel || !travel.Active) return 'Error: no active journey';

            const destName = travel.DestName || '';
            await saveMapCommandStatData((s) => {
                s.World.PartyPosition = { X: s.World.Travel.DestX, Y: s.World.Travel.DestY };
                s.World.Travel.Active = false;
            });
            return `Arrived at ${destName || '(' + travel.DestX + ',' + travel.DestY + ')'}`;
        },
        helpString: 'Completes the active journey, moving PartyPosition to the destination.',
    }));
}

function registerAddTravelHours() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'addtravelhours',
        callback: async (namedArgs) => {
            const hours = Number(namedArgs.hours);
            if (!Number.isFinite(hours) || hours <= 0) return 'Error: hours must be a positive number';

            const stat = getMapCommandStatData();
            const travel = stat && stat.World && stat.World.Travel;
            if (!travel || !travel.Active) return 'Error: no active journey';

            let total = 0;
            await saveMapCommandStatData((s) => {
                s.World.Travel.ElapsedHours = (s.World.Travel.ElapsedHours || 0) + hours;
                total = s.World.Travel.ElapsedHours;
            });
            return `Added ${hours}h (total elapsed: ${total}h)`;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'hours', description: 'Hours to add to the active journey', isRequired: true }),
        ],
        helpString: 'Adds elapsed hours to the active journey.',
    }));
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check /home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`
Expected: no output, exit code 0.

No commit yet.

---

### Task 5: `/addpin` command

**Files:**
- Modify: `/home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js` (append)

- [ ] **Step 1: Write the command**

```js
function registerAddPin() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'addpin',
        callback: async (namedArgs) => {
            const x = Number(namedArgs.x);
            const y = Number(namedArgs.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Error: x/y must be numbers';
            const name = namedArgs.name || 'New Pin';
            const note = namedArgs.note || '';
            const icon = namedArgs.icon || 'pin';

            const key = generateMapCommandKey('pin');
            await saveMapCommandStatData((s) => {
                if (!s.World.MapPins) s.World.MapPins = {};
                s.World.MapPins[key] = { Name: name, Note: note, X: x, Y: y, Icon: icon };
            });
            return `Pin '${name}' added at (${x},${y})`;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'name', description: 'Pin display name', isRequired: true }),
            SlashCommandNamedArgument.fromProps({ name: 'x', description: 'X coordinate', isRequired: true }),
            SlashCommandNamedArgument.fromProps({ name: 'y', description: 'Y coordinate', isRequired: true }),
            SlashCommandNamedArgument.fromProps({ name: 'note', description: 'Optional note', isRequired: false }),
            SlashCommandNamedArgument.fromProps({ name: 'icon', description: 'Optional icon key (default "pin")', isRequired: false }),
        ],
        helpString: 'Adds a new entry to World.MapPins.',
    }));
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check /home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`
Expected: no output, exit code 0.

No commit yet.

---

### Task 6: `/revealfog` command

**Files:**
- Modify: `/home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js` (append)

- [ ] **Step 1: Write the command**

```js
function registerRevealFog() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'revealfog',
        callback: async (namedArgs) => {
            const stat = getMapCommandStatData();
            const regions = (stat && stat.World && stat.World.FogRegions) || {};
            const match = findByKeyOrName(regions, namedArgs.name);
            if (!match) return `Error: fog region '${namedArgs.name}' not found`;

            await saveMapCommandStatData((s) => {
                s.World.FogRegions[match.key].Revealed = true;
            });
            return `Fog region '${match.Name}' revealed`;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'name', description: 'FogRegions key or Name', isRequired: true }),
        ],
        helpString: 'Sets Revealed=true on a World.FogRegions entry.',
    }));
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check /home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`
Expected: no output, exit code 0.

No commit yet.

---

### Task 7: `/addtraveloption` command + final wiring

**Files:**
- Modify: `/home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js` (append)

- [ ] **Step 1: Write the command and the top-level init that registers all 6**

```js
function registerAddTravelOption() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'addtraveloption',
        callback: async (namedArgs) => {
            const speed = Number(namedArgs.speed);
            if (!Number.isFinite(speed)) return 'Error: speed must be a number';
            const name = namedArgs.name || 'New Option';
            const mode = namedArgs.mode || 'Walking';

            const key = generateMapCommandKey('travel');
            await saveMapCommandStatData((s) => {
                if (!s.World.TravelOptions) s.World.TravelOptions = {};
                s.World.TravelOptions[key] = { Name: name, Mode: mode, Speed: speed };
            });
            return `Travel option '${name}' added (${mode}, ${speed}km/h)`;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'name', description: 'Travel option display name', isRequired: true }),
            SlashCommandNamedArgument.fromProps({ name: 'mode', description: "Mode: 'Walking'|'Mounted'|'Sailing'|'Flying'", isRequired: true }),
            SlashCommandNamedArgument.fromProps({ name: 'speed', description: 'Speed in km/h', isRequired: true }),
        ],
        helpString: 'Adds a new entry to World.TravelOptions.',
    }));
}

function initMapCommands() {
    registerStartJourney();
    registerArrive();
    registerAddTravelHours();
    registerAddPin();
    registerRevealFog();
    registerAddTravelOption();
}

initMapCommands();
```

- [ ] **Step 2: Final syntax-check of the complete file**

Run: `node --check /home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Sanity-check the file has exactly 6 `SlashCommandParser.addCommandObject` calls**

Run: `grep -c "SlashCommandParser.addCommandObject" /home/xephy/.claude/jobs/<job-id>/tmp/map_commands.js`
Expected: `6`

No commit yet — still a scratch file, not wired into the card.

---

### Task 8: Write `MapCommands` into the card JSON

**Files:**
- Modify: `/home/xephy/ArtificRealm/src/ArtificRealm創世域_Eng.json`

- [ ] **Step 1: Append the new script entry using the exact key shape recorded in Task 1**

Adjust the dict literal below if Task 1's actual key set differed (e.g. add an `id`/`enabled` field matching the existing entries — copy whatever extra keys the existing 4 entries have, generating a fresh `id` the same way they're shaped, e.g. a random uuid string if that's the pattern observed):

```bash
cd /home/xephy/.claude/jobs/<job-id>/tmp && python3 - <<'EOF'
import json
path = "/home/xephy/ArtificRealm/src/ArtificRealm創世域_Eng.json"
with open(path, encoding='utf-8') as f:
    data = json.load(f)

with open('map_commands.js', encoding='utf-8') as f:
    content = f.read()

scripts = data['data']['extensions']['tavern_helper']['scripts']
# Use the existing 'mvu' entry as the shape template (smallest existing entry).
template = next(s for s in scripts if s.get('name') == 'mvu')
new_entry = dict(template)
new_entry['name'] = 'MapCommands'
new_entry['content'] = content
if 'id' in new_entry:
    import uuid
    new_entry['id'] = str(uuid.uuid4())

scripts.append(new_entry)

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("written, new script count:", len(scripts))
EOF
```

Expected output: `written, new script count: 5`

- [ ] **Step 2: Verify round-trip**

```bash
cd /home/xephy/.claude/jobs/<job-id>/tmp && python3 - <<'EOF'
import json
path = "/home/xephy/ArtificRealm/src/ArtificRealm創世域_Eng.json"
with open(path, encoding='utf-8') as f:
    data = json.load(f)
scripts = data['data']['extensions']['tavern_helper']['scripts']
mc = next(s for s in scripts if s.get('name') == 'MapCommands')
with open('map_commands.js', encoding='utf-8') as f:
    expected = f.read()
print('content match:', mc['content'] == expected)
EOF
```

Expected: `content match: True`

- [ ] **Step 3: Confirm the diff scope is exactly this one addition**

Run: `cd /home/xephy/ArtificRealm && git diff --stat`
Expected: 1 file changed (the card JSON), insertion count roughly matching the new script's line count — no unrelated changes.

- [ ] **Step 4: Commit**

```bash
cd /home/xephy/ArtificRealm
git add "src/ArtificRealm創世域_Eng.json"
git commit -m "Add MapCommands tavern_helper script (slash commands for AI map actions)

Registers /startjourney, /arrive, /addtravelhours, /addpin, /revealfog,
/addtraveloption via SlashCommandParser.addCommandObject. Each writes
World.* MVU fields through getVariables/updateVariablesWith, the same
globals StatusMenu.html already uses — no new AI-state-vs-user-state
split. StatusMenu.html itself is untouched."
```

---

### Task 9: Manual verification in real SillyTavern

**Files:** none — verification only, no code changes.

This is the only verification path available (see "Why no automated test runner" above). Run each step in a real SillyTavern instance with the ArtificRealm card loaded and an active chat.

- [ ] **Step 1: Confirm the script loaded without errors**

Open the chat, check the browser console for any `MapCommands` syntax/runtime errors on page load. Expected: none.

- [ ] **Step 2: `/startjourney`**

Run: `/startjourney destx=10 desty=20 destname=TestDest vehicle=Airship` (assuming `World.TravelOptions` has been seeded with the default `airship` entry — `ensureMapDefaults()` seeds it automatically the first time the Map tab is opened).
Expected: returns `"Journey started toward TestDest (...)"`. Open the StatusMenu map tab; the travel line should render as an arc (the `airship` default has `Mode:'Flying'`).

- [ ] **Step 3: `/addtravelhours`**

Run: `/addtravelhours hours=2`
Expected: returns `"Added 2h (total elapsed: 2h)"`.

- [ ] **Step 4: `/arrive`**

Run: `/arrive`
Expected: returns `"Arrived at TestDest"`. Confirm `World.PartyPosition` (visible on the map / via `/getvar World.PartyPosition` if available) now shows `(10,20)`.

- [ ] **Step 5: `/addpin`**

Run: `/addpin name=TestPin x=5 y=5 note=hello`
Expected: returns `"Pin 'TestPin' added at (5,5)"`. Confirm the pin appears on the map.

- [ ] **Step 6: `/revealfog`**

Run: `/revealfog name=<an existing FogRegions entry name from World.FogRegions>`
Expected: returns `"Fog region '<name>' revealed"`. Confirm the region's fog overlay disappears on the map.

- [ ] **Step 7: `/addtraveloption`**

Run: `/addtraveloption name=TestMount mode=Mounted speed=15`
Expected: returns `"Travel option 'TestMount' added (Mounted, 15km/h)"`. Confirm it appears in the Travel Options card list.

- [ ] **Step 8: Error paths — at least one per command**

Run each and confirm an `"Error: ..."` string is returned and **no state changes** (re-check the relevant World.* field is unchanged):
- `/startjourney destx=abc desty=20 destname=X vehicle=Airship` → `"Error: destx/desty must be numbers"`
- `/startjourney destx=1 desty=1 destname=X vehicle=Dragon` → `"Error: vehicle 'Dragon' not found"`
- `/arrive` (with no active journey) → `"Error: no active journey"`
- `/addtravelhours hours=-5` → `"Error: hours must be a positive number"`
- `/addpin name=X x=abc y=1` → `"Error: x/y must be numbers"`
- `/revealfog name=NoSuchRegion` → `"Error: fog region 'NoSuchRegion' not found"`
- `/addtraveloption name=X mode=Walking speed=abc` → `"Error: speed must be a number"`

If any step fails, fix the corresponding command in the scratch file, re-run Task 8's write-back (it's idempotent — re-running replaces the `content` field), and re-test from the failing step.

No commit for this task (verification only — if a fix is needed, that's a new commit on top of Task 8's).
