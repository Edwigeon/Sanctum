# PROJECT: SANCTUM — Current Systems Architecture

> **Motto:** Small. Fast. Efficient. Moddable.  
> **Architecture:** 15 Hz Server-Authoritative Simulation • Dual-Resolution 60+ FPS Browser Client • Zero Build Step ES Modules

---

## 1. Directory & Module Overview

```text
Sanctum/
├── shared/                     # Deterministic modules shared by Node.js server & browser client
│   ├── Constants.js            # Engine specs, 16-color PALETTE/PALETTE_INDEX/PALETTE_RGB, tiles, rarities, packets
│   ├── MathUtils.js            # 32-bit deterministic PRNG (Mulberry32), dist(), clamp()
│   ├── DungeonGen.js           # Seeded 40×30 procedural dungeon generator with BFS connectivity check
│   └── CombatMath.js           # Damage rolls, primary stat scaling, armor mitigation, NG+ scaling
├── server/                     # Node.js HTTP + WebSocket authoritative server
│   ├── server.js               # REST API router, static file server, WebSocket room/lobby manager
│   └── systems/
│       ├── GameRoom.js         # 15 Hz authoritative game loop, AI, combat, loot, floor descent
│       ├── DataRegistry.js     # Loads and indexes JSON content tables from /data
│       ├── LootGenerator.js    # Procedural gear drops with rarity rolls, prefixes, and suffixes
│       ├── Database.js         # SQLite (better-sqlite3 WAL) schema, scrypt hashing, 180d retention
│       ├── AuthService.js      # Registration, login, bearer token validation, rolling TTL refresh
│       ├── SaveManager.js      # Character CRUD, real-time state persistence, Hall of Fallen Heroes
│       ├── ModService.js       # Moderator Portal queries, account bans/roles, character JSON editing
│       └── DemoSeeder.js       # Optional demo database & live bot lobby seeder (SANCTUM_DEMO_LOBBIES=1)
├── client/                     # Zero-dependency ES Module browser client
│   ├── index.html              # Game viewport, HUD overlays, Auth/Roster/Lobby modal screens
│   ├── style.css               # Zero-dependency handcrafted retro dark-fantasy stylesheet (<25 KB)
│   ├── app.js                  # Client coordinator: WebSocket lifecycle, event routing, rAF loop
│   ├── mod.html                # Moderator Portal UI (/mod)
│   ├── mod.js                  # Moderator Portal controller
│   ├── dev.html                # Developer Asset & PSG Studio UI (/dev)
│   ├── dev.js                  # Dev Studio coordinator & moderator save auth
│   ├── dev/
│   │   ├── SpriteStudio.js     # Image-to-16-color digitizer, pixel/frame editor, 8-band torch preview
│   │   └── SoundLab.js         # Lanthorn-PSG parametric workbench + PICO-8 3-layer Visual SFX Painter
│   └── systems/
│       ├── LightingSystem.js   # Merged-wall analytical 2D lighting, 9-band Bayer dither, additive 16-color RGB
│       ├── SpriteRegistry.js   # Loads /data/sprites.json hex-grids into fast Uint8Array frames
│       ├── AudioPSG.js         # Lanthorn-PSG core: dual-oscillator synth, DSP modifiers, Macro FX, spatial audio, HiFi/LoFi
│       ├── MusicDatabase.js    # IndexedDB binary database persisting pre-rendered Float32Array PCM buffers & ASTs
│       ├── MusicPlayer.js      # Interactive tracker engine, real-time tonal shifts (explore, combat, tension), beat quantization
│       ├── Renderer.js         # Dual-canvas rendering pipeline, camera lock, subpixel sprite/entity stamping, UI overlay
│       ├── CanvasHUD.js        # Canvas-native ARPG action HUD: Life/Mana glass globes, wave meniscus, forged-iron belt & XP bar
│       ├── BitSprites.js       # 16-color bit-array micro-sprites for UI icons, attributes, item bases & equipment slots
│       ├── Interpolator.js     # 15 Hz snapshot buffer -> smooth 60+ FPS entity interpolation
│       ├── HUDController.js    # In-game DOM HUD, Character Sheet (C), Inventory (I), Audio Settings, Pause/Invite
│       ├── InputController.js  # Mouse world projection, LMB move/attack lock, RMB skill, visibility culling, hotkeys
│       └── MenuController.js   # Auth flow, Hero Roster, Multiplayer Lobby Browser, Invite links
├── scripts/                    # Build & verification toolchain
│   ├── pack_soundtrack.js      # Bundles 6 tracker projects into compact AST JSON
│   └── verify_technical_plan.js# Regression test suite for collision, interpolation, lighting & lifecycle
└── data/                       # Moddable JSON content tables, tracker CSVs & SQLite storage
    ├── classes.json            # Playable archetypes (VANGUARD, ARCANIST, SHADOW)
    ├── monsters.json           # Monster definitions (crawler, brute)
    ├── items.json              # Base equipment definitions across 4 slots (weapon, armor, gloves, ring)
    ├── affixes.json            # Item prefixes and suffixes
    ├── sprites.json            # Palette-indexed 16-color hex-grid micro-sprites (tiles, entities, objects)
    ├── sfx.json                # Lanthorn-PSG compatible SFX patches (hit, crit, spark, potion, level_up, etc.)
    ├── music/                  # Modular Lanthorn-PSG v1.1 .csv tracker projects
    │   ├── sanctum_cathedral.csv # 8-channel cathedral/dungeon suite (Mist & Toll, Cathedral Dusk, etc.)
    │   └── sanctum_town.csv    # 8-channel atmospheric town/hearth suite
    └── saves/
        └── sanctum.db          # SQLite database (WAL mode)
```

---

## 2. Shared Deterministic Core (`/shared`)

### `Constants.js`
* **Engine Timing & Viewport**:
  * `TICK_RATE: 15` (`66.67 ms` per server tick).
  * `TILE_SIZE: 12` pixels per tile.
  * `INTERNAL_WIDTH: 240`, `INTERNAL_HEIGHT: 144` (`20×12` visible tiles, `5:3` aspect ratio).
* **Canonical 16-Color Palette (`PALETTE`, `PALETTE_INDEX`, `PALETTE_RGB`)**:
  * Single source of truth for the PICO-8 16-color palette (`BLACK: 0` through `PEACH: 15`), used across floor rendering, dynamic light hues, entity stamps, and future digitized micro-sprites.
* **Game Modes**: `CLASSIC` (normal respawn with 10% XP penalty) and `HARDCORE` (permadeath).
* **Tiles**: `EMPTY (0)`, `FLOOR (1)`, `WALL (2)`, `DOOR (3)`, `STAIRS_DOWN (4)`, `PORTAL_TOWN (5)`.
* **Rarities & Colors**: `NORMAL (#FFFFFF)`, `MAGIC (#60A5FA)`, `RARE (#FACC15)`, `UNIQUE (#FB923C)`.
* **Packet Protocol (`PACKET_TYPES`)**:
  * **Client → Server**: `JOIN_LOBBY`, `INPUT_MOVE`, `INPUT_ATTACK`, `INPUT_SKILL`, `INPUT_POTION`, `PICKUP_LOOT`, `ALLOC_STAT`, `EQUIP_ITEM`, `DROP_ITEM`, `INPUT_RESPAWN`.
  * **Server → Client**: `LOBBY_ERROR`, `ROOM_INIT`, `WORLD_SNAPSHOT`, `PLAYER_STATE_SYNC`.

### `MathUtils.js` & `DungeonGen.js`
* **32-Bit PRNG**: `PRNG` uses deterministic 32-bit integer bit-mixing (`Math.imul`) so the server only transmits a single 32-bit `seed` in `ROOM_INIT`, and both sides generate the exact same `40×30` tile grid.
* **Dungeon Layout**:
  * Carves up to 8 non-overlapping rectangular rooms (`6–11` tiles wide, `5–8` tiles high).
  * Connects rooms sequentially via 2-tile-wide L-shaped corridors, plus loop corridors (`rooms[0] ↔ rooms[n-2]`, `rooms[1] ↔ rooms[n-1]`) for tactical kiting.
  * Places `spawnPoint` at the center of Room 0 and `STAIRS_DOWN` (`exitPoint`) at the center of the final room.
  * Verifies 100% room reachability using a Breadth-First Search (BFS) flood-fill from `spawnPoint`.

### `CombatMath.js`
* **Damage Formula**:
  $$\text{Raw} = (\text{rng}(\text{baseDmgMin}, \text{baseDmgMax}) + \text{flatBonus}) \times (1 + \max(0, (\text{primaryStat} - 10) \times 0.02)) \times 1.35^{\text{ngCycle}}$$
* **Critical Strikes**: Multiplies damage by `critMult` (`1.5×` default) when `rng.nextFloat() < critChance`.
* **Armor Mitigation**:
  $$\text{Reduction} = \frac{\text{targetArmor}}{\text{targetArmor} + 50}, \quad \text{FinalDamage} = \max(1, \lfloor \text{Damage} \times (1 - \text{Reduction}) \rfloor)$$

---

## 3. Dual-Resolution Client & Real-Time 2D Lighting (`/client`)

### Real-Time 2D Shadowcast Lighting (`LightingSystem.js`)
Sanctum uses a pure real-time 2D line-of-sight lighting engine (no explored/unexplored memory state — unlit areas fall back into pitch black):
1. **Merged Continuous Wall Segments (`buildMergedWallSegments`)**:
   * On `ROOM_INIT`, adjacent `WALL` tiles touching open `FLOOR` are merged into single continuous horizontal/vertical line segments (`~30–40` segments per `40×30` floor instead of 1,200 tiles).
   * `computeVisibility()` runs exact analytical ray-segment intersection against those merged segments (with AABB rejection), eliminating discrete raymarch stepping and `12×12` wall-seam scalloping/shimmer.
   * Angle-independent perpendicular surface depth (`getWallSurfaceDepth`) fades wall faces smoothly into darkness across the back of the wall.
2. **Additive 16-Color RGB Light Accumulation & Saturation-Preserving Shading**:
   * Every light source resolves its color directly from the canonical 16-color palette (`PALETTE_INDEX`):
     * Players & Co-op Allies: `ORANGE` (warm torchlight with organic multi-harmonic subtle flicker, ±3.2px radius breathing, and micro-sway shadows)
     * `Spark` Projectiles: `BLUE` (`#29ADFF` electric glow illuminating dark corridors)
     * `STAIRS_DOWN` & `Unique ★` Loot: `YELLOW`
     * `Rare` Loot: `PINK`
     * Glowing/Elite Monsters: `RED`
   * Overlapping lights combine additively in both intensity (`lightGrid`) and colored photons (`lightR/G/B`), ensuring colored lights brighten and tint.
   * **Chromatic Diffuse Modulation & Cool-Wash Balance**: On entities and monsters (`sampleLitPixelU32`), colored photons are modulated by the sprite's base reflectance ($0.32 + 0.68 \times ref$) with cool-wash glow neutralization and soft-add highlight compression, preventing saturation loss and chalky white wash-out when illuminated by projectiles or non-torch lights.
   * **4-Sample Colored Light Interpolation**: Bilinear interpolation samples all four contributing grid corners ($i_{00}, i_{10}, i_{01}, i_{11}$) and checks interpolated RGB values, preventing colored lights from dropping across grid-cell boundaries when $i_{00}$ is uncolored.
3. **9-Band `SHADE_U32` + World-Locked `1×1` Bayer Dithering**:
   * Bilinearly interpolates `lightGrid` across every `1×1` pixel of the `242×146` `pixelCanvas` buffer and quantizes transitions with a world-locked `4×4` Bayer matrix (`(wx & 3, wy & 3)`). Perceptually tuned brightness curve ($t^{0.92}$) and expanded 116px torch radius improve entity visibility across mid/dim light bands.
4. **Organic Torch Flicker, Static Object Occluders & Ambient Transitions**:
   * Smooth multi-harmonic sine wander brings natural torch flicker to player and ally torches, static object shadow occluders (`setStaticOccluder`), personal torch toggle (`T`), and smooth ambient light interpolation (`setAmbientLight`, previewed via `L`).

### Dual-Canvas Pipeline & Subpixel Entity Stamping (`Renderer.js`)
1. **Low-Res World Layer (`#pixelCanvas`, `242×146`)**:
   * Upscaled via CSS `image-rendering: pixelated` with a 2px margin shifted on the GPU via `translate3d(-fracX * stageScale, -fracY * stageScale, 0)` for smooth subpixel scrolling.
2. **Subpixel-Smooth Dithered Sprite & Entity Stamping (`SpriteRegistry.js`, `drawLitSpriteStamp`, `drawLitEntityStamp`)**:
   * `SpriteRegistry` loads `/data/sprites.json` hex-grid rows (`0`–`f` → `0..15`, `.` → `255` transparent) into `Uint8Array` frames, automatically feeding `tiles/*` into `LightingSystem.bakeFloorIndices()` and `entities/*` (2-frame animated heroes & monsters) into `drawLitSpriteStamp()` (supporting horizontal flip and arbitrary rotation).
   * Entities are shaded pixel-by-pixel via `sampleLitPixelU32()` into a contiguous `24×24` offscreen `ImageData` scratch buffer (`stampU32`), then blitted onto `#highResCanvas` with a single `drawImage()` call at exact floating-point subpixel screen coordinates `(wx - camera.x) * stageScale`.
   * Gives 60+ FPS subpixel-smooth entity motion with the exact same pixelated Bayer-dithered + additive colored lighting as the floor and zero internal grid seams.
3. **High-DPI UI Overlay (`#highResCanvas`)**:
   * Camera locks directly to the local player's interpolated position (`myP.rx`, `myP.ry`).
   * Renders crisp selection rings, monster health bars, player nametags, floating combat text (`DAMAGE`, `CRIT`, `HEAL`, `LEVEL UP!`, `Too Heavy!`), and hovered loot tooltips with 1px offset drop shadows.

### Lanthorn-PSG Audio & Interactive Music Engine (`AudioPSG.js`, `MusicDatabase.js`, `MusicPlayer.js`)
Sanctum embeds a sample-accurate, zero-dependency procedural audio engine ported directly from `Edwigeon/Lanthorn-PSG` (`Oscillator` + `Modifiers` + `.sfx.csv` / `.csv` project schema) into pure `Float32Array` DSP:

1. **Dual Oscillator & DSP Modifier Core (`Oscillator`, `Modifiers`)**:
   * **Oscillator (`Oscillator`)**: Continuous phase integration supporting `sine`, `square` (static or array PWM `duty_cycle`), `sawtooth`, `triangle`, and deterministic LFSR `noise`, with `wave_type_2` + `mix` dual-oscillator blending.
   * **Modifiers (`Modifiers`)**: `applyADSR`, `applyTremolo`, `generateVibratoProfile`, `generateSlideProfile`, `generatePitchSweep`, `generatePWMProfile`, `applySaturation` (`Math.tanh`), `applyBitcrush`, `applyRingMod`, `applyRetrigger`, and multi-tap `applyEcho`.
   * **Visual SFX Painter (`renderPainterPatch`)**: Supports PICO-8 / Lanthorn-style 3-layer 32-step `patch.painter` definitions (`step_ms`, `slide`, per-layer waveform/duty, 32-step MIDI pitch & `0..7` volume arrays) routed through the same FX chain and authored visually in `/dev`.
   * **Sequential `fx_chain` & Macro Overrides (`!CMD XX`)**: Implements sequential modifier chains (`SAT`, `BIT`, `ECH`, `RNG`, `RET`, `TRM`) with event-level `!CMD` overrides that dynamically replace specific effects without duplicating patches.

2. **Hierarchical Web Audio Routing & Game-State Macro FX**:
   * **Bus Topology**:
     $$\text{SFX Bus} + \text{Music Bus} \longrightarrow \text{Submix Bus} + \text{Environmental Delay Bus} \longrightarrow \text{Low-Health Filter} \longrightarrow \text{Master Gain} \longrightarrow \text{Destination}$$
   * **Low-Health Tension Macro**: When local player HP $\le 25\%$, an automated `BiquadFilterNode` (lowpass) sweeps from $22,000\text{ Hz}$ down to $450\text{ Hz}$ with resonance $Q = 2.2$, creating a tense, muffled heartbeat soundscape. Heals smoothly restore full frequency range.
   * **Environmental Echo / Reverb Macro**: In caverns or deep cathedral halls, a wet delay/reverb feedback send ($220\text{ ms}$ delay, $35\%$ feedback) engages dynamically.
   * **Dedicated Volume Controls**: Independent Master, SFX, and Music volume sliders with real-time numeric readouts, persistent `localStorage` synchronization (`sanctum_audio_settings`), and quick mute toggles (`🔊 / 🔇`, hotkey `M`).

3. **Player Proximity SFX & 2D Spatialization**:
   * Local player coordinates $(rx, ry)$ update the audio listener position each frame.
   * **Distance Attenuation**: World sound events (`hit`, `crit`, `potion`, player deaths) attenuate via non-linear Euclidean distance rolloff:
     $$\text{norm} = 1.0 - \frac{\text{dist}}{260\text{ px}}, \quad \text{gain} = \text{norm}^{1.4}$$
   * **Dynamic Stereo Panning**: Off-center sound sources pan naturally left-to-right through a `StereoPannerNode` ($\text{pan} \in [-0.85, 0.85]$).
   * **Distance Culling**: Sounds beyond hearing radius ($> 260\text{ px}$) cull immediately before node allocation, saving CPU and audio nodes.

4. **Multi-Rate DSP Switching (Hi-Fi vs. Lo-Fi Retro Mode)**:
   * **Lo-Fi Retro (`11,025 Hz`)**: Authentically recreates early 90s tracker grit while reducing CPU synthesis cycles and RAM usage by ~75%.
   * **Standard (`22,050 Hz`)**: Default balanced fidelity.
   * **Hi-Fi Studio (`44,100 Hz`)**: High-resolution studio reproduction.
   * Switching quality modes in the Pause Menu automatically re-instantiates DSP math, flushes cached buffers, updates the background worker, and persists settings.

5. **Client-Side 16-Bit Packed Audio Database & Idle Pre-Warming (`MusicDatabase.js`)**:
   * Uses browser IndexedDB (`sanctum_audio_db`, v3) to persist pre-rendered stereo audio as **16-bit signed integer PCM (`Int16Array`)**, cutting client storage footprint by **50%** while preserving full 96 dB CD-quality signal-to-noise ratio.
   * On subsequent loads, stereo pattern audio is retrieved and decoded in $\le 2\text{ ms}$, bypassing runtime DSP math.
   * Background pre-warming (`requestIdleCallback`) renders upcoming intensity patterns during idle frames between 60 FPS animation ticks, eliminating any main-thread CPU stutters during gameplay.

6. **Interactive Tracker Music Player (`MusicPlayer.js`, `PatternBufferCompiler.js`, `PatchRenderer.js`)**:
   * **Area & Natural Tonal Flow**: Music suites are anchored to distinct major areas (`town` for Sanctum lobby/menus, `cathedral` for the dungeon descent). Artificial floor-change crossfades and mid-phrase track cuts have been removed: the soundtrack plays continuously across floor descents, changing mood organically through the real-time tonal system.
   * **Stereo Equal-Power Panning & Macro FX (`PatternBufferCompiler.js`)**:
     * Synthesizes 2-channel stereo `AudioBuffer` instances applying equal-power panning ($panAngle = panNorm \times \pi / 2$) from tracker `PAN` automation (`PAN 0`..`PAN 255`), restoring full spatial ping-pong width to instruments like `BoneShaker` and `CryptBell`.
     * Translates `SDN <semitones>` tracker commands into downward dynamic pitch sweeps ($freq \to freq \times 2^{-semi / 12}$) and forwards `PRT`, `ARP`, and `ECH` macro overrides, restoring punchy pitch drops to `WarDrum` and custom FX.
     * Preserves dry attack transients by removing internal echo peak normalization and applying a master `Math.tanh` soft-limiter across the final pattern mix.
   * **Relative Portamento & Ring Mod Carrier Tuning (`PatchRenderer.js`)**:
     * `portamento`: Supports relative slides when `start_freq` is omitted (defaulting to $baseFreq \times 1.5$ over `slide_time`), allowing drum sweeps and expressive portamentos without hardcoded absolute frequencies.
     * `ring_mod`: Reads `carrier_freq` directly, ensuring instruments like `CryptBell` vibrate at their tuned carrier frequency (e.g. 415.0 Hz) rather than the default 500 Hz fallback.
   * **Natural Tonal Shift System (Beat-Quantized on Pattern Boundaries)**:
     * `explore`: Atmospheric ambient exploration patterns (e.g. `A`, `B`, `C`, `H`) when roaming safe or cleared halls.
     * `tension`: Heightened suspense patterns (`E`, `F`) when hostile mobs are lurking in shadow radius (95–155 px) or local player HP $\le 25\%$.
     * `combat`: Driving combat patterns (`F`, `G`) engaging smoothly during close-quarters combat (< 95 px or locked target) with a 3.5s hysteresis cooldown.
     * **Zero Crossfade Interruption**: Tone shifts are queued on pattern loop boundaries (`pendingSection`), transitioning sample-accurately on measure starts without dipping volume, ducking, or DC pops.
   * **Binary Audio Database & Sub-Millisecond Startup (`MusicDatabase.js`)**:
     * **IndexedDB 16-Bit Packed Stereo Storage (`sanctum_audio_db`, v3)**: Persists rendered stereo samples as compact 16-bit Int16 binary buffers directly into client-side IndexedDB (`rendered_pcm_stereo_16bit`), cutting storage by 50%. On subsequent sessions or page reloads, pattern buffers are retrieved and converted in $\le 2\text{ ms}$, bypassing runtime waveform synthesis entirely.
     * **Pre-Compiled Soundtrack Bundle (`/data/music/soundtrack.json`)**: Packed via `npm run pack:music` (`scripts/pack_soundtrack.js`), bundling all 6 project ASTs into a single fast-loading JSON payload and caching parsed suites in IndexedDB to avoid line-by-line CSV parsing on page boot.
     * **Instant User-Gesture Audio Unlock**: Captures `pointerdown`, `keydown`, `touchstart`, and `click` on the window during the capture phase, instantly resuming the browser's `AudioContext` without waiting for UI event bubbling.
     * **Immediate Startup Attack (50 ms)**: Initial boot applies a snappy 50 ms de-click attack ramp (`now + 0.05s`) rather than a slow 1.5s volume fade, ensuring the opening bell chime and 12-string guitar chord strike immediately.
     * **Eager Pattern Pre-Warming**: Background threads automatically pre-render and cache upcoming pattern buffers 12 seconds in advance, ensuring zero dropped samples or render pauses at loop boundaries.
     * `town` (`/data/music/sanctum_town.csv`): **D Dorian / D Minor** (76 BPM) — Warm campfire hearth, gentle lute, cello lament, mellow drone.
     * `wilderness` (`/data/music/sanctum_wilderness.csv`): **D Aeolian** (84 BPM) — Moorland mist, ruins horn calls, driving percussion, wind.
     * `crypts` (`/data/music/sanctum_crypts.csv`): **D Phrygian** (76 BPM) — Torchlit nave, bone ossuary, crypt cello, tension dread.
     * `caverns` (`/data/music/sanctum_caverns.csv`): **D Phrygian / D Harmonic Minor** (70 BPM) — Obsidian fault, tritone chasm, subterranean viola, echoing bells.
     * `cathedral` (`/data/music/sanctum_cathedral.csv`): **D Phrygian / D Harmonic Minor** (80 BPM) — Mist & toll, Cathedral dusk 12-string guitar, Slaughter hall, cathedral arpeggios.
     * `boss` (`/data/music/sanctum_boss.csv`): **D Harmonic Minor** (108 BPM) — Throne of ash, diminished wrath, doom bells, climactic boss decree.
   * **Universal Rhythm & Drone Anchoring**: Drum downbeats consistently strike on $D_2$ (73.4 Hz) with secondary fifth ghost taps on $A_1$ (55.0 Hz); root pedal drones anchor on $D_2$ across all suites.
   * **Seamless Inter-Pattern Looping**: Disables the per-pattern brickwall limiter to ensure seamless volume continuity across pattern loops and state transitions without ducking.

### Snapshot Interpolation (`Interpolator.js`)
* Buffers up to 6 incoming `WORLD_SNAPSHOT` packets (broadcast at 15 Hz).
* Maintains a continuous `renderTick` targeting `latest.tick - 1.25` ticks behind the server head with gentle two-tier proportional drift correction (`gain = 0.8` within normal bounds, `3.0` if drift exceeds `0.5` ticks).

### Controls & Input (`InputController.js`)
* **Visibility-Aware Hover Culling**: `findLootAt` and `findMonsterAt` ignore entities in unlit tiles (`sampleLightAtWorld <= 0.25`) so players cannot hover-scan dark rooms.
* **Left Mouse Button (LMB)**: Click ground loot to pick up; click/hold monster to pursue & auto-attack; click/drag floor for continuous movement steering (`66 ms` cadence).
* **Right Mouse Button (RMB)**: Cast active skill (`Spark` projectile, `10 MP` cost) toward cursor angle.
* **Keyboard Shortcuts**:
  * `1`: Drink Health Potion (`+40 HP`).
  * `T`: Toggle personal torch on/off.
  * `L`: Toggle smooth Daylight / Dungeon Darkness ambient lighting preview.
  * `C` / `I` / `ESC`: Toggle Character Sheet, Inventory & Paperdoll, or Pause/Invite Menu.

### In-Game HUD & Menus (`HUDController.js` & `MenuController.js`)
* **Dirty-Checked DOM Updates**: `HUDController` hashes vitals (`hp|maxHp|mp|maxMp|isDead`) and inventory JSON so DOM nodes are only mutated when values change.
* **Character Sheet (`C`)**: Level, XP bar, core attributes (`Might`, `Focus`, `Agility`, `Vitality`), interactive `+` stat allocation buttons, and derived combat stats.
* **Inventory & Paperdoll (`I`)**: 8 equipment sockets (`Helm`, `Amulet`, `Weapon`, `Armor`, `Off-hand`, `Gloves`, `Boots`, `Ring`) arranged in a Diablo-style sunken stone paperdoll with click-to-unequip, dynamic Carry Weight bar (`lb`), pack items list, and side-by-side comparative hover tooltips displaying green/red stat deltas.
* **Invite Links**: Every active room (including `Quick Play (Private)` rooms) has a 6-character uppercase `inviteCode` with **`Copy Invite`** buttons in both the top status bar and the `ESC` Pause Menu.

---

## 4. Authoritative Server & Simulation (`/server`)

### Simulation Loop (`GameRoom.js`)
Each active room runs an independent `15 Hz` (`66.67 ms`) update loop:
1. **Player Movement & Actions**:
   * Pursues locked monsters (melee range `<= 16 px`, attack cooldown `8 ticks`) or targeted ground loot (pickup range `< 18 px`).
   * Moves players toward `(targetX, targetY)` at `p.speed` with axis-separated wall-sliding collision (`isWalkable` with `3 px` radius).
   * Regenerates mana (`+0.1 MP/tick`) and decrements attack cooldowns.
   * Triggers `advanceFloor()` when any living player steps within `12 px` of `TILES.STAIRS_DOWN`.
2. **Projectiles**:
   * Moves `Spark` projectiles at `3.5 px/tick` (lifetime `40 ticks`), stopping on walls or dealing `p.spellDmg` upon hitting a monster within `10 px`.
3. **Monster AI**:
   * Scans for the closest living player within `aggroRange` (`85–90 px`).
   * Moves toward the target with wall-sliding collision or performs a melee strike within `10 px` (cooldown `18 ticks`).
4. **Progression, Stats & Encumbrance**:
   * Killing a monster grants XP to all living players in the room (`1.45×` XP curve per level, `+3 statPoints` and full HP/MP restore on level-up) and drops either a Health Potion (`33%`) or procedural gear (`67%`).
   * Derived stats recalculated on level-up, stat allocation, or gear change:
     * `maxHp = 50 + Vitality * 5 + (Level - 1) * 10 + bonus.hp`
     * `maxMp = 20 + Focus * 3 + (Level - 1) * 5`
     * `primaryStat`: `Might` (Vanguard), `Focus` (Arcanist), `Agility` (Shadow)
     * `armor = baseArmor + floor(Vitality * 0.25) + bonus.armor`
     * `critChance = min(0.65, baseCrit + Agility * 0.004 + bonus.crit)`
     * `speed = min(2.2, baseSpeed + Agility * 0.01)`
     * `spellDmg = round(14 + Focus * 0.8 + bonus.dmg * 0.6)`
     * `maxWeight = 30 + Might * 2` (picking up gear exceeding `maxWeight` emits an `OVERBURDENED` `"Too Heavy!"` event).
5. **Network Broadcast**:
   * Broadcasts `WORLD_SNAPSHOT` to all connected room sockets every tick.
   * Sends private `PLAYER_STATE_SYNC` packets only when `p.dirtyState === true`.

---

## 5. Multiplayer Lobby, Persistence & Cryptographic Invites

### Realm Lobby & Cryptographic Invites (`GameRoom.js`, `MenuController.js`, `HUDController.js`)
* **Dual-Pane Realm Browser**: Split-view realm lobby:
  * **Left Pane (Game Browser)**: Filterable, searchable table displaying active games, password locks (`🔒`), current occupancy (`2/4`), and dungeon floor/biome.
  * **Right Pane (Game Details & Roster)**: Inspects the selected game, showing dungeon depth, password prompt, and a live roster of players inside (`🛡️ Vanguard`, `⚡ Arcanist`, `🗡️ Shadow` with character levels).
  * **Tabbed Sub-Navigation**: Clean toggle between `[ ⚔ JOIN GAME ]` and `[ ⚒ CREATE GAME ]` with configurable party size (2–4 players) and visibility (`Public` / `Private`).
* **128-Bit CSPRNG Cryptographic Invites**:
  * In addition to human-friendly 6-character hex codes (`DEMO99`), each game room generates a 128-bit cryptographically secure token (`crypto.randomBytes(16).toString('base64url')`).
  * Eliminates invite brute-forcing; URL links formatted as `?invite=<token>` are immune to enumeration.
* **One-Click Clipboard & Query Parameter Auto-Join**:
  * In-game pause menu and HUD provide instant `"Copy Invite Link"` buttons that format full cryptographic URLs.
  * Opening an invite link automatically pre-resolves the room via `/api/invite?token=...`, validates character mode compatibility (`Classic` vs `Hardcore`), and presents a one-click entry banner.

### SQLite Database (`Database.js`)
Stored at `data/saves/sanctum.db` with `WAL` journaling and `FOREIGN KEY` cascades enabled:
* **`accounts`**: `id`, `username (NOCASE)`, `password_hash (scrypt)`, `salt`, `role ('player' | 'moderator')`, `is_banned`, `created_at`, `last_login_at`, `expires_at`.
* **`sessions`**: `token`, `account_id`, `expires_at` (30-day session TTL).
* **`characters`**: `id`, `account_id`, `name`, `class_id`, `mode`, `level`, `xp`, `next_xp`, `stat_points`, `potions`, `is_dead`, `highest_floor`, `data_json` (stats, equipment, inventory), `updated_at`.
* **`fallen_heroes`**: Permanent record of Hardcore deaths (`account_id`, `account_name`, `hero_name`, `class_id`, `level`, `floor`, `data_json`, `died_at`).
* **`hall_of_legends`**: Schema ready for permanent cross-season hall-of-fame inductions.

### 180-Day Rolling Retention & Moderator Portal (`AuthService.js` & `ModService.js`)
* Every login or authenticated session validation rolls the account's `expires_at` forward by **180 days** (`RETENTION_MS`).
* A daily background sweep (`pruneExpiredData`) deletes non-moderator accounts past `expires_at` (cascading their characters and sessions).
* **Default Moderator**: Bootstrapped automatically on first run (`username: "admin"`, `password: "sanctum-mod"`, or via `SANCTUM_MOD_USER` / `SANCTUM_MOD_PASS`).
* **Moderator Portal (`/mod`)**: View database counters, manually prune expired accounts, search/ban/promote/extend accounts, and inspect or edit any character's level, stats, hardcore death state, or raw inventory JSON.
We