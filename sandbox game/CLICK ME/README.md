# Pixel Forge — a pixel physics sandbox for metalworking

A 2D falling-sand style sandbox (think *Sandboxels* / *The Powder Toy*) built around **movable
objects, metal casting, crafting and working machines**. Every pixel is a simulated cell with its
own material and temperature. Crucibles, moulds and castings are real objects made of cells —
tilting a crucible physically pours its contents out, cell by cell, into a mould whose cavity
shape becomes the finished casting.

Plain HTML + CSS + native ES modules. No frameworks, no backend, no account, no install.

---

## Running it

**Double-click `index.html`.** That's it: no server or commands needed.

It opens with the **Lapin Studios** splash for two seconds, then the **main menu**: Play, **Tutorial**
(an interactive walkthrough in The Foundry that ends with you casting a gold bar), **How to Play**
(controls, tools and tips at a glance), Worlds, Blank Map, Load and Settings. Get back to the menu any
time with **🏠 Menu** in the top bar or `Esc`. Add `#skipmenu` to the URL to jump straight into the game.

`index.html` loads `dist/pixel-forge.js`, a single bundled script generated from `src/` (with the
example worlds embedded), so it works straight from disk in any modern browser (Chrome, Edge,
Firefox or Safari, 2022 or newer). Keep the folder together: `index.html` needs `dist/`,
`styles/` and `assets/` next to it.

### For developers

The source lives in `src/` as ES modules. After editing anything in `src/` or `worlds/`, rebuild the bundle:

```bash
python build.py
```

`build.py` (standard library only) walks the import graph from `src/main.js` and wraps each module in
its own function scope. It embeds `worlds/*.json` and writes `dist/pixel-forge.js`, plus `dev.html`,
a copy of the page that loads `src/` directly as ES modules. To use `dev.html` (no rebuild needed
between edits), serve the folder over HTTP, because browsers block ES modules on `file://`:

```bash
python serve.py
```

then open http://localhost:8000/dev.html. `serve.py` wraps Python's built-in server, disables
caching and always serves `.js` as JavaScript.

---

## Your first gold bar (2 minutes)

The default world, **The Foundry**, already has a crucible of gold heating in the fuel furnace.

1. Press **5** (Hand tool), click the crucible's wall inside the left furnace and drag it up and out.
2. Hover it to watch the contents' temperature. Gold melts at **1064 °C** (it sits at 1064 °C
   for a moment while it absorbs latent heat). If it isn't molten yet, put it back and wait.
3. Carry it over the **Gold Bar Mould** on the casting table.
4. Hold **E** (or **Q**, or scroll the wheel) to tilt — molten gold pours over the rim.
5. Level it with **R** when the mould is full. The label above the mould turns green
   (“Solid — ready to extract”) once every cell has solidified.
6. Hover the mould and press **X**. Out comes a **Gold Bar** item made of the cast cells.

The built-in interactive tutorial (🎓 Tutorial in the top bar) walks through exactly this.

---

## Controls

| Input | Action |
| --- | --- |
| Left mouse | Use current tool (paint / grab / inspect / carve / place) |
| Right mouse | Erase · drop the held object |
| Middle drag · Alt+drag | Pan |
| W A S D / arrow keys | Pan |
| Mouse wheel | Zoom — or tilt a held object |
| Shift+wheel · `[` `]` | Brush size (size **1** is a pencil: exactly one pixel per cell, no scatter, no stream while holding still) |
| `1`–`8` | Brush, Eraser, Heat Gun, Freeze Spray, Hand, Inspect, Carve, Mix |
| `9` · `0` · `K` | Line, Rope, Pin |
| `Q` / `E` (hold) | Tilt the held object (pour) |
| `R` | Level the held / hovered object |
| `X` | Extract the casting from the hovered mould |
| `F` | Fuse the hovered item back into the world as cells |
| `T` · click | Toggle the switch under the cursor (clicking a switch with the Brush, Hand or Inspect tool flips it too) |
| Shift + drag | Paint a straight line (horizontal, vertical or 45°) — handy for wires |
| `Delete` | Delete the held / hovered object or ragdoll |
| `Space` / `P` | Pause / resume |
| `N` / `.` | Step one tick |
| `+` / `-` | Simulation speed (0.25× – 4×) |
| `H` | Thermal view |
| `V` | Power view: live wiring glows yellow, dead wiring red, switches/sensors green (on) or red (off) |
| `B` | Recipe Book |
| `Tab` | Toggle the material sidebar |
| `Home` | Fit world to screen |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` / `Ctrl+O` | Save / load dialog |
| `Ctrl+C` / `Ctrl+V` | Copy the hovered object or ragdoll / paste a copy at the cursor |
| `Esc` | Close dialog · drop · stop placing · otherwise open the main menu |

Clicking an object's **wall** with the Brush or Eraser also grabs it; painting over its opening paints
straight into it (gold into a crucible, milk into a pot); erasing there empties it. Shift-click with Carve to cut out mixed solids.
The **Mix** tool stirs everything loose under the brush, including the contents of pots and
crucibles, and anything that can combine **dissolves into what you're stirring it into straight away**:
salt into water, sugar into syrup, flour + milk into batter, molten tin into copper for bronze. It only swaps
material with neighbouring material, so nothing gets thrown into the air. Static solids and finished
castings are left alone.

* **Line** (`9`): drag to draw a perfectly straight line of the selected material at the brush thickness;
  right-drag erases a line.
* **Rope** (`0`): drag from one thing to another to tie them — objects, ragdoll parts, pins, walls or thin
  air (a pin is made where there's nothing to tie to). Whatever hangs from a rope swings like a pendulum and
  turns to hang below the knot. Right-click a rope or pin to remove it.
* **Pin** (`K`): click an object to nail it in place (it can still swivel around the pin), a ragdoll part to
  hold it there, or empty space for a rope anchor.
* **Painted solids stay put.** Wood, stone, metal, glass and other solids you paint are fixed in place.
  To make a piece physical, cut it loose with **Carve** (`7`): it becomes a loose block that falls, tips
  over and floats if it's lighter than the liquid.
* **Ctrl+C / Ctrl+V** copies the hovered object or ragdoll and pastes a copy at the cursor.

---

## Features

### Simulation
* Grid cellular automaton with **chunked active-cell tracking** (16×16 chunks sleep when nothing
  changes), alternating scan direction, and per-tick update marks so nothing moves twice.
* **196 materials** sorted into sidebar **tabs**: Solids, Powders, Liquids, Gases, Food, Nature, Fire,
  Electronics, Special and Tools (22 object types incl. the ragdoll), each split into sub-groups; all data-driven (`src/materials/Materials.js`): powders pile and
  slide, liquids flow and spread with viscosity, gases rise or sink by density, fire flickers and
  spreads, everything layers by density (oil floats on water, slag floats on molten metal,
  mercury sinks under everything).
* **Heat**: per-cell temperature, conductivity and heat capacity; explicit diffusion between
  neighbours; open air relaxes to ambient. **Latent heat**: metals sit at their melting point while
  melting / solidifying, which is what lets a pour fill a mould before it freezes.
* **Phase changes**: melting, freezing, boiling, condensation, sublimation, calcination, firing
  clay, pyrolysis… with weighted multi-product outcomes and gas byproducts.
* **Combustion**: ignition temperatures, burn time, oxygen requirement / boost, smothering,
  extinguishing with water, smoke, embers and charcoal residues. **Explosions** for gunpowder,
  nitroglycerin, hydrogen and methane that also shove objects. **Fuse** (Fire tab) burns along its
  length at ~12 cells/s with sparks — even underwater — to set off charges at the far end.
* **33 pairwise reactions**: quenching lava to obsidian, dissolving salt, mud, concrete mixing,
  slaking lime, rust and verdigris corrosion, acids, acid rain, carbothermic smelting of six ores,
  and alloying (bronze, brass, steel, pewter, electrum, rose gold).
* **Plants**: seeds sprout near water, plants grow leaves and flowers, grass spreads, moss creeps
  over wet rock, vines hang, fungus rots wood.

### Objects & metalworking
* Rigid objects are local cell grids with a position and rotation. They are stamped into the world
  every tick (walls block cells, cavities absorb them), fall under gravity, collide with terrain
  and each other, ride conveyors and get shoved by explosions.
* **Tipping physics**: a resting object is supported by its outline (convex hull) where it touches the
  ground. If its centre of mass is outside that support it rotates over the edge — tilted moulds fall
  flat, tall objects topple onto their side, crucibles right themselves or lie down — and it squares up
  to the pixel grid once it settles. Containers spill as they tip.
* **Containers** simulate their contents in their own rotated frame, so tilting really pours,
  splashes and spills. Dip a bucket in water to fill it. Contents keep temperature, react and
  change phase inside the container (smelt ore with charcoal *in* the crucible, alloy two metals).
* Overheated walls fail: a steel ladle melts under molten steel, a wooden item burns, a cast
  bar dropped in a furnace melts back into liquid metal.
* **Moulds** (ingot, gold bar, copper bar stock, ring, gear, sword blade) in refractory ceramic.
  The casting is built from exactly the cells that solidified in the cavity; sprue metal is
  trimmed off as scrap; partial or mixed pours give flawed castings.
* **Items** can be carried, dropped into crucibles to remelt, placed on a workbench to craft, or
  fused back into the world. The **Carve** tool cuts any connected solid (wood, gems, metal) loose
  as an item, however big.
* **Buoyancy:** objects in liquid feel lift by how much of them is under the surface versus their
  density (empty cavities count as air), so wooden blocks and carved wood float, iron sinks, and things
  bob in molten metal.

### Food & cooking
* The **Food** tab: milk, butter, cheese, eggs, flour, dough, bread, toast, batter, pancakes, cake,
  sugar, syrup, caramel, candy, chocolate, juice, popsicles, tea, vinegar, baking soda, meat,
  potatoes, fries, rice, popcorn, apples, jam, ice cream and more.
* Ingredients combine when they touch: flour + water → dough, flour + milk → batter,
  batter + sugar/egg → cake batter, milk + vinegar → cheese, sugar + water → syrup,
  baking soda + vinegar → CO₂ fizz, potato + hot oil → fries, rice + hot water → cooked rice,
  apple + sugar (hot) → jam, melted chocolate + milk → chocolate milk, milk + sugar below −2 °C → ice cream.
* Heat cooks them: eggs fry at 70 °C, batter → pancakes, dough → bread → toast, popcorn pops and
  doubles in volume, sugar caramelises, chocolate and butter melt. Overcook anything and it chars.
* **Kitchen** objects (Tools tab): Cooking Pot, Frying Pan, Hot Plate (50–400 °C),
  Oven (50–300 °C) and Fridge (−25–10 °C).
* **Easy cooking:** pots and pans **stir themselves**, so layered ingredients combine without the Mix tool,
  and a hot plate warms whatever pot or pan sits on it directly. The hot plate, oven and fridge have
  **one-click quick settings** in the inspector (🍳 Eggs / meat 120 °C, 🥞 Pancakes 170 °C, 🍟 Fries 190 °C,
  🍿 Popcorn 200 °C, 🍬 Caramel, 🍚 Simmer, 🍞 Bread 200 °C, 🎂 Cake 180 °C, 🥔 Potato, 🍞 Toast 250 °C,
  🍦 Ice cream −18 °C…) — hot enough to cook, too cool to burn. The Food tab has a **How to cook** recipe card.

### Electronics
* **Quick circuit:** paint a **Battery**, draw **Copper Wire** from it to a **Lamp** (or any output). That's it —
  there's no need for a loop back to the battery. The Electronics tab shows this as a how-to card.
* Parts connect when they **touch, including at corners**, so diagonal and hand-drawn wires work. Live wire glows.
* Selecting an electronic part switches to a thin brush automatically (your old size comes back when you pick
  something else), and parts paint **straight over existing wire**, so you can drop a switch or lamp into a line.
* **Shift+drag** draws perfectly straight wires. Click a **Switch** with the Brush, Hand or Inspect tool (or press
  `T`) to flip it.
* **Power view** (`V` or the ⚡ button) dims everything else and colours the wiring: yellow = live, red = not
  connected to power, green / red = switches and sensors that are on / off.
* Power: **Battery**, **Solar Panel** (needs open sky; glass lets light through), **Thermocouple**
  (powered while hot).
* Control: **Copper Wire** (solid metals conduct too), **Switch**, **Thermostat** (on while colder than
  its setpoint), **Heat Sensor** (on while hotter), **Liquid Sensor** (on while wet),
  **Pressure Plate** (on while cells or an object rest on it). A connected block of a sensor acts as one
  sensor, so pressing any part of a long plate triggers it.
* Outputs: **Lamp**, **Red/Green/Blue LEDs**, **Buzzer**, heating & cooling elements, igniter, fan,
  conveyor and pump.
* Inspect any electrical cell to see whether it's live, and to change thermostat or sensor setpoints.

### Ragdoll human
* Tools tab → **People → Ragdoll Human**: click to drop one in, People Playground style. He **never moves on his
  own** — grab any body part with the **Hand** tool (`5`) to drag him, dangle him or fling him (let go
  mid-swing). Right-click or `Esc` drops him, `Delete` removes him.
* He looks like a People Playground human: a grey side-on figure with a square head and a single eye,
  built from separate outlined blocks (head, upper / middle / lower body, upper and lower arms and legs,
  L-shaped feet), with the near arm drawn over the body and far-side limbs darker. He's drawn as a
  high-resolution sprite (4 pixels per world cell), so he stays crisp and readable instead of blocky.
* **He stands on his own and supports himself:** while conscious, his muscles hold him upright over his
  planted feet. A hard hit, throw or explosion knocks him down; after a moment he plants his hands and
  gets back up. Falling, he throws his arms out to catch himself. He never walks. Badly hurt (under 25%
  health), frozen, burning or electrocuted, he goes limp.
* He's calm while carried (limbs hang instead of whipping around), limbs can't be dragged through thin
  walls, sand piled on him gets pushed aside, and a stuck part finds its way to the nearest free spot. He
  shoves loose objects he slams into. Pin or rope him to things with the Pin and Rope tools.
* **Dragging is full strength with no delay:** the part you grab sits exactly under the cursor (even while
  paused), so you can pose him precisely or swing and fling him.
* He's a verlet skeleton (13 joints, bones with joint limits; knees only bend forward and elbows backward)
  that falls, tumbles, collides with terrain and objects, settles without jittering, floats in water, bobs on
  molten metal, gets carried by conveyors and blown around by explosions. **Flip facing** in the inspector
  turns him around.
* Damage shows **on the part that took it**: bruises and bloody wounds where he hit, charring on the limbs
  that burned, acid burns where he touched acid.
* He reacts to everything: hard landings and throws hurt (and can break arms and legs, which then flop),
  he bleeds **Blood** (a new liquid) when hurt, catches fire from flames, lava or a heat gun and spreads it,
  freezes solid in the cold (the freeze spray turns him into a rigid statue), gets electrocuted by live
  wiring (flashing skeleton), dissolves in acid, drowns if his head is held under, and burns to ash in lava.
* His eye shows how he's doing (blinking, wide when scared, squeezed shut in pain, closed when knocked
  out or dead), with grunts, yelps and screams. Inspect him for health, air, burns, body temperature and broken bones, and to heal / revive him.

### Machines
* **Furnace** (fuel hopper, 1650 °C) and **Electric Furnace** (wired power terminal, 2400 °C):
  heat everything in their chamber toward a target set in the inspector.
* **Fuel Heater** (radiant, hopper-fed) and **Cooling Station** (refrigerated area cooling).
* **Casting Table** (water-cooled) and **Workbench** (11 crafting recipes, some producing working
  machines and containers).
* **Thermometer** probe objects.
* Cell machines (Electronics tab): see above. **Pumps & pipes** move liquid between tanks *and* into
  containers; powered conveyors carry powders and objects.
* **Heat Limiter** (Electronics → Wiring & Control): wire it to power and nothing within 12 cells — cells,
  objects or ragdolls — can get hotter than its limit (500 °C to start). Inspect it to change the limit for
  the whole block; hovering it shows its range. Add more to cover bigger areas.
* **Electric Stove** (Electronics → Outputs): wire it to power and the burner glows, heating toward 260 °C and
  warming any pot, pan or food sitting on it.
* Special tab: the **Spout** pours a material out forever — pick the material first (e.g. Lava), then pick
  Spout and paint. The **Cloner** copies whatever touches it, including objects and ragdolls, which fall
  straight through it (no collision). The **Void** deletes anything that touches it, objects and ragdolls
  included.

### Interface
* Lapin Studios splash screen and a main menu with the tutorial and a How to Play guide.
* Searchable, collapsible material sidebar with procedurally drawn icons and tooltips.
* Inspector with live cursor readout, object details, contents, progress bars and machine controls.
* Play / pause / step / 5 simulation speeds, undo / redo, thermal view, fit view.
* **Recipe Book** with metalworking guide, discoverable reactions (hidden until you make them),
  phase tables, casting, workbench recipes, machines and a material browser.
* Save / load named worlds (localStorage), JSON export / import with validation, autosave,
  7 example worlds, settings (units, effects, audio), and an interactive tutorial.
* Bloom glow, heat haze, sparks, steam and smoke particles.

### Sound
All sound is synthesised live with WebAudio (no audio files), split into effects, interface and
ambience channels with separate controls in Settings → Audio. World sounds are panned left/right by
where they happen on screen and get quieter off-screen.
* **Tools:** each material type has its own brush sound (sandy hiss, liquid blub, gas hiss, solid
  tick, fire whoosh), plus erase, heat-gun roar, freeze spray, mix swish, carving chisel, tool switch,
  object pick-up / drop / tilt creak and delete.
* **World:** glugging molten-metal pours, liquid and powder pours, splashes, boiling sizzle, metal
  melting, ice cracking, popcorn popping, food frying, acid fizz, ignition whoosh, fuse crackle,
  explosions, impacts (metal clink / heavy thud, including objects tipping over) and containers
  cracking when their walls fail.
* **Ragdoll:** grunts and yelps when hurt, screams while burning or shocked, bone cracks, electric zaps
  and a groan when he dies.
* **Machines:** furnace crackle, electric hum, power-up / power-down and relay clicks as circuits
  change, switches, buzzers.
* **Ambience** follows what's on screen: fire crackle, furnace and lava roar, machine hum, flowing
  water and boiling bubbles.
* **Interface:** clicks, dialogs, notifications, undo / redo, save / load, play / pause,
  discoveries, crafting and casting chimes.

---

## Example worlds (`worlds/*.json`)

| World | What's in it |
| --- | --- |
| **Blank Map** | Nothing at all — an empty 480×270 world whose bottom edge is the ground. |
| **The Foundry** | Fuel furnace melting gold, electric furnace alloying bronze, iron-ore smelting crucible, moulds on a casting table, cooling station, quench tank, gems, ore bins, workbench. |
| **Kitchen** | Fridge turning milk + sugar into ice cream, oven baking bread, eggs frying on a hot plate, rice simmering, a pantry and liquid tanks, solar-powered ceiling lights and a pressure-plate doorbell. |
| **Empty Workshop** | Floor, basic tools, ore bins — start from scratch. |
| **Volcano** | Lava-filled mountain with ore veins, forest, snow and a lake. Dig a channel and watch. |
| **Water Lab** | Two pumped tanks (one pump switched off — toggle it), boiler + condenser water cycle, density column, salt on ice, liquid nitrogen. |
| **Small Factory** | Ore funnel → battery-powered conveyor → electric smelter, thermostat-controlled kiln firing clay, fan-blown coal fire, switched ceiling lamps. |


Tip: `index.html#world=kitchen&tab=food` opens a specific world and sidebar tab; add `&panel=book`
(or `worlds`, `settings`) to open a dialog on load.

Presets are declarative: drawing ops (`rect`, `frame`, `circle`, `line`, `terrain`, `noise`,
`scatter`, `set`, `temp`) plus a list of objects with optional contents and machine state.

---

## Architecture

```
pixel-sandbox/
├── index.html            UI skeleton (panels, modals); loads the bundle — double-click to play
├── dev.html              same page loading src/ as ES modules (generated; needs serve.py)
├── dist/pixel-forge.js   bundled build (generated by build.py — don't edit)
├── build.py              bundler: src/ + worlds/ -> dist/pixel-forge.js
├── serve.py              no-cache local server for development
├── styles/               main.css (layout/tokens) · interface.css (panels) · effects.css (animation)
├── assets/icons/         logo + favicon (SVG pixel art); all textures/sounds are procedural
├── worlds/               example worlds as JSON
└── src/
    ├── main.js           boot + fatal-error screen
    ├── core/             Game (loop, wiring) · World (typed-array grid, chunks) · Simulation
    │                     (cell update, movement primitives, reactions) · Renderer (ImageData +
    │                     bloom) · Camera · InputManager · ToolController (all player tools)
    ├── physics/          Gravity (powders) · LiquidPhysics · GasPhysics (gas + fire) · HeatSystem ·
    │                     PhaseTransitions (+ latent heat) · Combustion · Behaviors (plants,
    │                     cloner, machine-cell dispatch) · ObjectPhysics (rigid bodies + object heat)
    ├── materials/        Materials (the data table) · MaterialRegistry (compiles to typed arrays) ·
    │                     MaterialProperties (enums, textures, colour LUTs) · Reactions
    ├── objects/          WorldObject (local grid, transform, footprint, wall failure) · Container
    │                     (rotated-frame contents sim, pouring) · Crucible · Mold · Item · Tools
    │                     (thermometer, casting table, workbench) · ObjectFactory · ObjectManager ·
    │                     Ragdoll (People Playground-style verlet human: joints, per-part injuries, reactions, pixel renderer)
    ├── machines/         Furnace · Heater · Cooler · Pump (+ pipe network) · Conveyor · Fan ·
    │                     Electricity (power flood-fill) · MachineRegistry
    ├── crafting/         CraftingSystem (casting extraction, workbench) · RecipeBook
    ├── systems/          SaveManager · WorldPresets · Particles · AudioManager · History (undo) ·
    │                     Discovery (recipe-book progress)
    ├── ui/               Interface (shell, modals, toasts) · MaterialPanel · Inspector · Toolbar ·
    │                     Settings · Encyclopedia · SaveMenu · Tutorial
    └── utils/            MathUtils (PRNG, noise, colour, RLE/base64) · Performance
```

**Data flow per tick:** `Simulation.step()` → swap chunk activity → electricity (every 4 ticks) →
pipe network (every 20) → cell updates bottom-to-top over active chunks → heat diffusion →
`ObjectManager.step()` (physics, re-stamping, object↔world heat exchange, container contents,
machines). The `Renderer` only reads state, so simulation and rendering can evolve independently.

**How pouring works:** an object's footprint is computed by inverse-rotating every world cell in
its bounding box into local space. Cavity cells are stamped with `-id`, walls with `+id`. World
cells moving into a cavity cell are absorbed into the object's local grid; local contents fall
toward the rotated gravity vector, and a content cell stepping past the rim is emitted into the
world (or straight into another container's cavity) at its transformed position.

**Adding a material:** append an entry to `MATERIAL_DEFS` in `src/materials/Materials.js`
(state, colour, density, conductivity, transitions, tags…). Reactions are entries in
`REACTION_DEFS`; tags like `#carbon` match whole groups. No other code changes are needed.

**Saves** store RLE-compressed cell / temperature / life / pipe arrays, every object's grids and
state, and the material key table so ids are remapped if the library changes.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Blank page or stuck on the loading screen | Make sure `index.html` is still next to the `dist/`, `styles/` and `assets/` folders (don't move it out on its own). |
| My edits to `src/` don't show up in `index.html` | Run `python build.py` to regenerate `dist/pixel-forge.js`, then reload. Or develop with `dev.html` via `python serve.py`. |
| `dev.html` shows CORS / module errors | ES modules don't load from `file://`. Use `python serve.py` and open `http://localhost:8000/dev.html`. |
| “Failed to load module script … MIME type text/plain” (dev.html) | Windows registry maps `.js` to text. Use `python serve.py` (it forces the right type). |
| `python` not found | Try `py` (Windows) or `python3` (macOS/Linux). Only needed for developing, not for playing. |
| Port already in use | `python serve.py 8080` and open `http://localhost:8080/dev.html`. |
| Low frame rate | Lower simulation speed, disable Bloom / Particles in Settings, or load a smaller world. |
| “Browser storage is full” when saving | Delete old saves (Load tab) or use Import / Export to keep worlds as files. |
| No sound | Click once in the page (browsers block audio until interaction); check Settings → Audio. |
