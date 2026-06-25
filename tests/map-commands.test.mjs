import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const CARD_PATH = new URL('../src/ArtificRealm創世域_Eng.json', import.meta.url);

function loadMapCommandsHarness(initialStat) {
  const card = JSON.parse(readFileSync(CARD_PATH, 'utf8'));
  const script = card.data.extensions.tavern_helper.scripts.find((entry) => entry.name === 'MapCommands');
  assert.ok(script, 'MapCommands script exists');
  assert.equal(script.enabled, true, 'MapCommands script is enabled');

  const commands = new Map();
  let stat = structuredClone(initialStat);
  const context = {
    console,
    structuredClone,
    setTimeout,
    window: {},
    SillyTavern: {
      SlashCommand: {
        fromProps(props) {
          return props;
        },
      },
      SlashCommandParser: {
        addCommandObject(command) {
          commands.set(command.name, command);
        },
      },
    },
    getVariables(options) {
      if (options?.type === 'message' && options.message_id === 'missing') return {};
      return { stat_data: stat };
    },
    updateVariablesWith(updater) {
      const next = updater({ stat_data: stat });
      if (next?.stat_data) stat = next.stat_data;
      return { stat_data: stat };
    },
  };
  context.window = context;

  vm.runInNewContext(script.content, context, { filename: 'MapCommands.js' });
  return {
    commands,
    get stat() {
      return stat;
    },
  };
}

function baseStat() {
  return {
    World: {
      MapSettings: { MapScale: 50 },
      PartyPosition: { X: 1, Y: 2 },
      TravelOptions: {
        airship: { Name: 'Airship', Mode: 'Flying', Speed: 60 },
        horse: { Name: 'Horse', Mode: 'Mounted', Speed: 15 },
      },
      FogRegions: {
        new_continent: { Name: 'New Continent', X: -400, Y: -100, W: 200, H: 250, MinLevel: 70, Revealed: false },
      },
      MapPins: {},
      Travel: { Active: false },
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('registers all map slash commands', () => {
  const harness = loadMapCommandsHarness(baseStat());
  assert.deepEqual([...harness.commands.keys()].sort(), [
    'addpin',
    'addtravelhours',
    'addtraveloption',
    'arrive',
    'revealfog',
    'startjourney',
  ]);
});

test('startjourney matches vehicle by name and writes travel state', async () => {
  const harness = loadMapCommandsHarness(baseStat());
  const result = await harness.commands.get('startjourney').callback({
    destx: '4',
    desty: '6',
    destname: 'Sky Port',
    vehicle: 'airship',
  });

  assert.equal(result, 'Journey started toward Sky Port (250km, ~4.2h)');
  assert.deepEqual(plain(harness.stat.World.Travel), {
    Active: true,
    OriginX: 1,
    OriginY: 2,
    DestX: 4,
    DestY: 6,
    DestName: 'Sky Port',
    VehicleName: 'Airship',
    VehicleMode: 'Flying',
    SpeedKmh: 60,
    ElapsedHours: 0,
  });
});

test('startjourney returns an error without mutation when vehicle is unknown', async () => {
  const initial = baseStat();
  const harness = loadMapCommandsHarness(initial);
  const result = await harness.commands.get('startjourney').callback({
    destx: '4',
    desty: '6',
    destname: 'Sky Port',
    vehicle: 'dragon',
  });

  assert.equal(result, "Error: vehicle 'dragon' not found");
  assert.deepEqual(harness.stat, initial);
});

test('arrive and addtravelhours update only an active journey', async () => {
  const stat = baseStat();
  stat.World.Travel = {
    Active: true,
    OriginX: 0,
    OriginY: 0,
    DestX: 8,
    DestY: 9,
    DestName: 'Ruins',
    VehicleName: 'Horse',
    VehicleMode: 'Mounted',
    SpeedKmh: 15,
    ElapsedHours: 1,
  };
  const harness = loadMapCommandsHarness(stat);

  assert.equal(await harness.commands.get('addtravelhours').callback({ hours: '2.5' }), 'Added 2.5h (total elapsed: 3.5h)');
  assert.equal(harness.stat.World.Travel.ElapsedHours, 3.5);
  assert.equal(await harness.commands.get('arrive').callback({}), 'Arrived at Ruins');
  assert.deepEqual(plain(harness.stat.World.PartyPosition), { X: 8, Y: 9 });
  assert.equal(harness.stat.World.Travel.Active, false);
});

test('addpin, revealfog, and addtraveloption append map collections', async () => {
  const harness = loadMapCommandsHarness(baseStat());

  assert.equal(
    await harness.commands.get('addpin').callback({ name: 'Camp', x: '3', y: '5', note: 'safe', icon: 'tent' }),
    "Pin 'Camp' added at (3,5)",
  );
  assert.deepEqual(plain(Object.values(harness.stat.World.MapPins)), [{ Name: 'Camp', X: 3, Y: 5, Note: 'safe', Icon: 'tent' }]);

  assert.equal(await harness.commands.get('revealfog').callback({ name: 'new continent' }), "Fog region 'New Continent' revealed");
  assert.equal(harness.stat.World.FogRegions.new_continent.Revealed, true);

  assert.equal(
    await harness.commands.get('addtraveloption').callback({ name: 'Skiff', mode: 'Sailing', speed: '18' }),
    "Travel option 'Skiff' added (Sailing, 18km/h)",
  );
  assert.deepEqual(plain(Object.values(harness.stat.World.TravelOptions).at(-1)), { Name: 'Skiff', Mode: 'Sailing', Speed: 18 });
});
