# Project: Sanctum — Master Feature Roadmap & Architecture Plan

> **Development Motto:** *Small. Fast. Efficient. Moddable.*  
> **Simulation:** 15 Hz Server-Authoritative Engine • **Client:** Dual-Resolution 60+ FPS Vanilla ES Modules • **Footprint:** < 100 KB Zero-Build Web Distribution

---

## 1. Status Legend & Summary Dashboard

| Status Indicator | Meaning |
| :--- | :--- |
| 🟢 **COMPLETED** | Fully implemented, architecturally modularized, verified in test suite. |
| 🟡 **IN PROGRESS** | Active implementation, decomposition, or testing in flight. |
| 🔵 **PLANNED** | Core feature defined in master plan, scheduled for implementation. |
| 🟣 **SUGGESTED ADDITION** | High-value enhancement aligned with engine ethos and retention. |

### Milestone Progress Overview

```text
[████████████████████░░░░░░░░░░░░░░░░░░░░] ~50% Core Milestones Implemented
```

* **Core Engine & Deterministic Math (Phase 1):** 100% 🟢
* **Modes, Persistence & Moderation (Phase 2A):** 100% 🟢
* **Lighting, Audio PSG & Studio (Phase 2B/3A):** 85% 🟢
* **UI, Paperdoll & Consumables (Phase 2D):** 75% 🟡
* **Interactive World Objects (Phase 2B):** 10% 🔵
* **World Graph & Biome Generation (Phase 2C):** 0% 🔵
* **Class Skills, Physics & Elites (Phase 3B):** 15% 🔵
* **Latency Prediction & Reconciliation (Phase 3C):** 0% 🔵
* **Shared Stashes & Production Homelab (Phase 4):** 20% 🔵
* **Narrative, Juice & Offline PWA (Phase 5):** 10% 🔵

---

## 2. Detailed Roadmap by Phase

### Phase 1: Core Engine & Deterministic Simulation 🟢
* 🟢 **Deterministic 32-Bit PRNG (`shared/MathUtils.js`)**: Seeded Mulberry32 integer generator; identical maps with 32-bit seed transmission.
* 🟢 **Procedural Dungeon Generator (`shared/DungeonGen.js`)**: Non-overlapping rectangular rooms, dual-corridor loops for kiting, BFS connectivity flood-fill.
* 🟢 **Combat Math (`shared/CombatMath.js`)**: Base weapon rolls, primary attribute multipliers, hyperbolic armor mitigation, NG+ Torment scaling.
* 🟢 **Dual-Resolution Rendering (`client/systems/Renderer.js`)**:
  * 240×144 low-res tile canvas with nearest-neighbor upscaling and subpixel GPU translate.
  * High-DPI vector overlay for pawn sprites, health bars, loot labels, and razor-sharp floating combat text.
* 🟢 **15 Hz Server-Authoritative Loop (`server/systems/GameRoom.js`)**:
  * Monster AI states (IDLE, AGGRO, ATTACK, RETURN), projectile ticks, authoritative hit detection, and snapshot broadcasts.

---

### Phase 2A: Game Modes, Persistence & Administration 🟢
* 🟢 **Classic Mode**: Respawn at floor entrance with 10% XP penalty and potion restock; public and private 6-char invite lobbies.
* 🟢 **Hardcore (Permadeath) Mode**: Isolated matchmaking; server-authoritative death prevention against disconnect exploits; permanent Fallen Spirit state.
* 🟢 **Secure Authentication & SQLite Storage (`server/systems/AuthService.js`, `Database.js`)**:
  * Scrypt password hashing, rolling 180-day TTL token refresh, WAL mode SQLite backend.
* 🟢 **Moderator Portal (`/mod` -> `client/mod.html`, `server/systems/ModService.js`)**:
  * Web-based dashboard for account role updates, bans, live session inspection, and character JSON state repair.
* 🟢 **Automated Demo Seeder (`server/systems/DemoSeeder.js`)**:
  * Zero-config mock lobby generation (`SANCTUM_DEMO_LOBBIES=1`) with live simulated bots for instant multiplayer testing.

---

### Phase 2B: Real-Time Lighting, Asset Studio & World Objects 🟡
* 🟢 **Analytical 2D Shadowcast Lighting (`client/systems/LightingSystem.js` & `lighting/`)**:
  * Continuous merged wall segment raycasting (zero 12×12 tile notches).
  * 9-band warm `SHADE_U32` palette ramp + world-locked 1×1 Bayer 4×4 dither matrix.
  * Modularized into `FloorBaker`, `LightPropagator`, `LitRasterizer`, `VisibilityOcclusion`, and `LightingTables`.
* 🟢 **Additive 16-Color Palette Lighting**:
  * Clean additive RGB photon propagation (`ORANGE` torch, `BLUE` spark, `YELLOW` stairs/uniques, `RED` elites).
  * Subpixel entity stamping (`drawLitEntityStamp`) with zero tile-grid seams.
* 🟢 **Personal Torch (`T`) & Daylight Toggle (`L`)**: Ambient lighting controls and distance-based visibility culling.
* 🟢 **Developer Asset & PSG Studio (`/dev` -> `client/dev.html`, `dev/SpriteStudio.js`, `dev/SoundLab.js`)**:
  * Image-to-Sanctum 16-color digitizer with contrast, alpha, and Bayer dither controls.
  * Interactive pixel/frame animation editor with 0°–360° rotation and 8 DOOM shade band previews.
  * Visual SFX Painter (3-layer 32-step piano roll) & Parametric Synth workbench with authenticated live disk export.
* 🟢 **Palette-Indexed Micro-Sprites (`client/systems/SpriteRegistry.js`, `/data/sprites.json`)**:
  * Compact 16-color hex-grid definitions baked directly into lighting stamps without PNG image bloat.
* 🔵 **Interactive Static World Objects**:
  * [ ] **Interactive Doors (`TILES.DOOR`)**: Walk-to-open or click-to-toggle doors acting as analytical shadowcasters when closed (blocking line-of-sight and sound).
  * [ ] **Chests & Containers**: Static occluders that clear their shadows upon opening and burst procedural loot.
  * [ ] **Breakable Props**: Ceramic urns, pots, and wooden crates (1 HP colliders that shatter on attacks/projectiles, dropping gold or potions).
  * [ ] **Shrines**: Interactive monoliths providing timed buffs (Speed, Conduit, Frenzy) while toggling off their glowing beacon light.
  * [ ] **Toggleable Braziers & Wall Sconces**: Environmental light sources that can be lit or extinguished.

---

### Phase 2C: Interconnected World Graph, Biomes & Day/Night Cycle 🔵
* 🔵 **Spatial Cell / Chunk Streaming**:
  * Stitch adjacent deterministic 32×32 or 40×30 cells into an interconnected world graph streamed on demand around players without loading screens.
* 🔵 **Constrained Biome Procedural Generation (`/data/biomes.json`)**:
  * **Overworld Cells**: Clearings, roads, rivers, ruined fences, campsite hubs.
  * **Crypt / Keep**: BSP rooms, stone pillars, iron-barred doors.
  * **Caverns / Catacombs**: Organic cellular automata tunnels and subterranean chasm bridges.
  * **Set-Piece Landmarks**: Fixed layouts for Town Camp, Boss Arenas, and Ancient Shrines.
* 🔵 **Overworld Day/Night Cycle**:
  * Time-of-day ambient light curve with outdoor palette shifts (bright daylight vs. torch-dependent nightfall with aggressive nocturnal spawns) contrasting with pitch-black dungeons.
* 🔵 **Seamless Transitions & Portals**:
  * Two-way stairs (Up & Down), Town Portals (`TILES.PORTAL_TOWN`), and Torment New Game+ (`ngCycle`) scaling transitions.

---

### Phase 2D: UI Refactor, Custom Dark-Fantasy CSS & Paperdoll Overhaul 🟡
* 🟢 **Handcrafted Dark-Fantasy CSS (`client/style.css`)**:
  * Purged external CDN frameworks (Tailwind) in favor of a zero-dependency stylesheet (< 25 KB) using PICO-8 CSS custom properties.
* 🟢 **Paperdoll & Equipment Architecture**:
  * Visual 8-slot paperdoll layout (Helm, Amulet, Weapon, Armor, Shield, Gloves, Boots, Ring 1, Ring 2).
  * Dynamic Carry Weight meter with overburden warnings.
  * Side-by-side comparative hover tooltips showing colored stat deltas (+4 Armor, -2 Focus).
  * Server-authoritative 1-click equip/swap and click-to-unequip back to bag.
* 🟢 **Canvas-Native ARPG Action HUD (`client/systems/CanvasHUD.js` & `hud/`)**:
  * Glass Life & Mana globes with fluid wave meniscus, forged-iron belt slots, and gold counter.
  * Modularized into `BeltRenderer`, `PotionRenderer`, `HUDConfig`, and `TooltipRenderer`.
* 🟡 **Consumable Stacks & Potion Integration**:
  * 🟢 Health & Mana potion drinking (`1` and `2` hotkeys), server recovery events, and floating combat text (`+30 MP`).
  * [ ] Full stackable architecture in bags: `{ stackable: true, count: 5, maxStack: 20 }` for potions, antidotes, and scrolls.
* 🔵 **Character Sheet (`C`) Deepening**:
  * Interactive uncommitted attribute point allocation preview (+/- points before saving).
  * Comprehensive derived combat stats panel (physical mitigation %, spell power multiplier, crit chance/mult, move speed, HP/MP regen rates).
* 🔵 **Socketable Gem / Rune Crafting**:
  * Gear rolling 1–2 sockets accepting chipped gems (Ruby = HP, Sapphire = MP/Spell, Topaz = MF/Crit) for early crafting depth.

---

### Phase 2E: Visual Customization, Palette Swaps & Visible Weapons 🔵
* 🔵 **Unique Archetype Micro-Sprites (`/data/sprites.json`)**:
  * Distinct 2-frame 12×12 animated sprites for Vanguard (iron plate & greathelm), Arcanist (hooded robes), and Shadow (sleek masked cowl).
* 🔵 **Visible Held Weapons**:
  * Layered weapon micro-sprite stamping composited directly onto pawn stamps, dynamically oriented by player facing direction or combat attack vector.
* 🔵 **Dynamic Gear Palette Swapping**:
  * Dynamic index color remapping on base sprites based on item rarity (Normal, Magic, Rare, Unique) or armor material tier (Iron, Bronze, Shadowsilk, Voidplate).
* 🔵 **Expanded Environment Sprites**:
  * Sprite definitions for closed/open chests, broken urn fragments, wooden/iron doors, active/spent shrines, and bone piles.

---

### Phase 3A: Audio Core, DSP Modifiers & Tracker Soundtrack 🟢
* 🟢 **Lanthorn-PSG Synthesis Core (`client/systems/AudioPSG.js` & `audio/`)**:
  * Dual-oscillator math waveforms, ADSR envelopes, pitch sweeps, vibrato/tremolo/PWM LFOs, saturation, bitcrush, ring modulation, and 3-layer SFX painter playback.
  * Modularized into `AudioMath`, `Oscillator`, `Modifiers`, and `PatchRenderer`.
  * Spatial audio panning, low-health muffled DSP macro filter, and HiFi/LoFi sample rate toggles.
* 🟢 **Interactive Tracker Engine (`client/systems/MusicPlayer.js`, `MusicDatabase.js`)**:
  * 6 full music suites (`town`, `wilderness`, `crypts`, `caverns`, `cathedral`, `boss`) anchored in D Dorian/Phrygian.
  * Beat-quantized tonal shifts (`explore`, `tension`, `combat`) on loop boundaries.
  * 16-bit Float32 PCM IndexedDB client-side audio caching for zero-latency playback.

---

### Phase 3B: Class Skills, Entity Physics, Status Effects & Elites 🔵
* 🔵 **Class-Distinct Active Skills**:
  * **Vanguard**: Cleave (cone melee slash), Shield Bash (short stun + knockback), Whirlwind (spinning radial strike), Iron Will (armor/resist fortification).
  * **Arcanist**: Spark (piercing electric dart), Frost Nova (radial chill & freeze slow), Teleport (instant phase blink), Arcane Beam (sustained channel).
  * **Shadow**: Shadow Step (dash through enemies), Fan of Knives (radial blade spread), Poison Blade (stacking DoT), Smoke Screen (aggro drop + stealth).
* 🔵 **Server-Authoritative Collision & Separation Physics**:
  * **Monster Soft Separation**: Circle-circle repulsion vectors preventing mob swarms from stacking into a single pixel.
  * **Player-to-Monster Body Blocking**: Solid entity bounds enabling tactical corridor choke-point holding.
  * **Impact Knockback**: Velocity impulses on crits, heavy melee hits, and Shield Bash.
* 🔵 **Spatial Partitioning Broadphase Grid**:
  * 144×144 px spatial hash grid inside `GameRoom`, reducing aggro scans, projectile raycasts, and repulsion loops from $O(N \times M)$ down to $O(1)$ neighborhood lookups.
* 🔵 **Standardized World Event Bus**:
  * Typed network events (`SFX_TRIGGER` with spatial rolloff, `PARTICLE_BURST` with palette index colors, `SCREEN_SHAKE`, `FLOAT_TEXT`).
* 🔵 **Status Effect Pipeline**:
  * Tick-based debuff array (`bleed`, `poison`, `chill`, `freeze`, `ignite`, `stun`) with tick damage and dithered entity sprite tinting.
* 🔵 **Elite Affixes & Champion Packs**:
  * Champions rolling prefixes ([Vampiric], [Molten], [Fast], [Stonehide], [Vortex]) with dynamic colored light auras (RED, INDIGO, ORANGE).
* 🔵 **3 Act Boss Encounters**: Multi-phase attack telegraphs, arena hazards, and guaranteed high-tier loot.

---

### Phase 3C: Network Latency Compensation 🔵
* 🔵 **Client-Side Movement Prediction**:
  * Instant local player movement on click using shared `isWalkable()` and speed constants, storing an unacknowledged input ring buffer.
* 🔵 **Authoritative Snapshot Reconciliation**:
  * Smooth decay of minor network discrepancies (< 4 px) over 3 frames, hard-snapping on severe desyncs (stuns, wall collisions).

---

### Phase 4: Persistence, Stashes & Production Hosting 🔵
* 🔵 **Mode-Partitioned Shared Stashes**: Classic and Hardcore account stashes persisted in SQLite.
* 🔵 **In-Client Hall of Fallen Heroes & Hall of Legends**: UI browser consuming `/api/fallen` and `/api/legends`.
* 🔵 **Single-Command Homelab Deployment**:
  * Production Dockerfile and `docker-compose.yml` with persistent volume mounts for `/data/saves` (< 50 MB RAM baseline).
* 🔵 **Node.js Cluster Multithreading (`server/cluster.js`)**:
  * Worker process distribution across multi-core server hardware for thousands of concurrent rooms.

---

### Phase 5: Narrative, Combat Juice & Offline PWA 🔵
* 🔵 **Narrative Campaign & Camp Interactions**: 3 thematic acts, camp NPC dialogue, and readable dungeon lore tablets (`/data/acts.json`).
* 🔵 **Combat Feel Polish**: Hit-stop freeze frames, directional screen shake, and floating crit typography.
* 🔵 **Binary Production Asset Packing**:
  * Compile JSON sprites and sound patches into a compact binary packfile for sub-millisecond single-fetch loading while preserving `/data/` mod overrides.
* 🔵 **PWA Offline Solo Play**: Service worker caching and offline browser simulation mode.

---

## 3. High-Value Suggested Additions 🟣

These suggested expansions enhance Project Sanctum's core motto (*Small. Fast. Efficient. Moddable.*):

### 1. Gamepad & Mobile Touch Control Mapping 🟣
* **Concept:** Seamless twin-stick ARPG gamepad mapping via the HTML5 Gamepad API (Left Stick = Move, Right Stick/Face Buttons = Aim & Skills, Bumpers = Potions).
* **Ergonomics:** Add a low-profile virtual thumbstick and skill buttons on touch devices, enabling instant mobile and Steam Deck browser play with zero install footprint.

### 2. Dedicated Headless Server CLI Flags 🟣
* **Concept:** Homelab-first CLI runner (`node server/server.js --port=8080 --db=/data/saves/sanctum.db --headless --benchmark`).
* **Benefits:** Simplifies systemd service creation, automated health-checks, and headless performance benchmarking on low-power homelab servers.

### 3. Pluggable Community Mod Packs (`/mods` Registry) 🟣
* **Concept:** Structured subfolder loading (`/mods/<mod_name>/mod.json`) allowing third-party creators to inject custom classes, items, monster tables, biomes, or soundfonts without modifying core vanilla JSON tables.
* **Benefits:** Delivers 100% on the *Moddable* pillar with zero danger of overwriting vanilla save states or core assets.

### 4. Torment Dungeon Map Mutators (Endgame Affixes) 🟣
* **Concept:** Procedural floor mutators rolled on Torment/NG+ tiers:
  * *Abyssal Gloom:* Torch radius reduced by 35%, ambient light locked to pure darkness.
  * *Volatile Brood:* Slain monsters explode in a radius after 1.5 seconds.
  * *Frenzied Swarm:* Mob movement speed +30%, loot magic find +25%.
* **Benefits:** Massive endgame replayability with zero asset bloat (driven entirely by mathematical rules).

### 5. Sensory & Accessibility Control Panel 🟣
* **Concept:** User-facing accessibility toggles in the Options modal:
  * Screen shake intensity slider (0% to 100%).
  * High-contrast entity outline shaders.
  * Photosensitivity strobe damper (disables rapid light flicker).
  * Colorblind-friendly palette adaptations for item rarity beams.

---

*Document generated for Sanctum Live Progress Tracking • Available directly at `/roadmap` in the game server.*
