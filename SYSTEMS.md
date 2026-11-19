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
│   ├── app.js                  # Client coordinator: WebSocket lifecycle, event routing, rAF loop
│   ├── mod.html                # Moderator Portal UI (/mod)
│   ├── mod.js                  # Moderator Portal controller
│   └── systems/
│       ├── LightingSystem.js   # Merged-wall analytical 2D lighting, 9-band Bayer dither, additive 16-color RGB
│       ├── Renderer.js         # Dual-canvas rendering pipeline, camera lock, subpixel entity stamping, UI overlay
│       ├── Interpolator.js     # 15 Hz snapshot buffer -> smooth 60+ FPS entity interpolation
│       ├── HUDController.js    # In-game DOM HUD, Character Sheet (C), Inventory (I), Pause/Invite
│       ├── InputController.js  # Mouse world projection, LMB move/attack lock, RMB skill, visibility culling, hotkeys
│       └── MenuController.js   # Auth flow, Hero Roster, Multiplayer Lobby Browser, Invite links
└── data/                       # Moddable JSON content tables & SQLite storage
    ├── classes.json            # Playable archetypes (VANGUARD, ARCANIST, SHADOW)
    ├── monsters.json           # Monster definitions (crawler, brute)
    ├── items.json              # Base equipment definitions across 4 slots (weapon, armor, gloves, ring)
    ├── affixes.json            # Item prefixes and suffixes
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
2. **Additive 16-Color RGB Light Accumulation**:
   * Every light source resolves its color directly from the canonical 16-color palette (`PALETTE_INDEX`):
     * Players & Co-op Allies: `ORANGE` (warm torchlight)
     * `Spark` Projectiles: `BLUE` (`#29ADFF` electric glow illuminating dark corridors)
     * `STAIRS_DOWN` & `Unique ★` Loot: `YELLOW`
     * `Rare` Loot: `PINK`
     * Glowing/Elite Monsters: `RED`
   * Overlapping lights combine additively in both intensity (`lightGrid`) and colored photons (`lightR/G/B`), ensuring colored lights always brighten and tint rather than darkening existing torchlight.
3. **9-Band `SHADE_U32` + World-Locked `1×1` Bayer Dithering**:
   * Bilinearly interpolates `lightGrid` across every `1×1` pixel of the `242×146` `pixelCanvas` buffer and quantizes transitions with a world-locked `4×4` Bayer matrix (`(wx & 3, wy & 3)`).
4. **Static Object Occluders, Torch Toggles & Ambient Transitions**:
   * Supports toggleable static lights (`setStaticLight` / `toggleStaticLight`), static object shadow occluders (`setStaticOccluder` for future chests/pillars/shrines), personal torch toggle (`T`), and smooth ambient light interpolation (`setAmbientLight`, previewed via `L`).

### Dual-Canvas Pipeline & Subpixel Entity Stamping (`Renderer.js`)
1. **Low-Res World Layer (`#pixelCanvas`, `242×146`)**:
   * Upscaled via CSS `image-rendering: pixelated` with a 2px margin shifted on the GPU via `translate3d(-fracX * stageScale, -fracY * stageScale, 0)` for smooth subpixel scrolling.
2. **Subpixel-Smooth Dithered Entity Stamping (`drawLitEntityStamp`)**:
   * Entities (players, monsters, projectiles, loot) are shaded pixel-by-pixel via `sampleLitPixelU32()` into a contiguous `24×24` offscreen `ImageData` scratch buffer (`stampU32`), then blitted onto `#highResCanvas` with a single `drawImage()` call at exact floating-point subpixel screen coordinates `(wx - camera.x) * stageScale`.
   * Gives 60+ FPS subpixel-smooth entity motion with the exact same pixelated Bayer-dithered + additive colored lighting as the floor and zero internal grid seams.
3. **High-DPI UI Overlay (`#highResCanvas`)**:
   * Camera locks directly to the local player's interpolated position (`myP.rx`, `myP.ry`).
   * Renders crisp selection rings, monster health bars, player nametags, floating combat text (`DAMAGE`, `CRIT`, `HEAL`, `LEVEL UP!`, `Too Heavy!`), and hovered loot tooltips with 1px offset drop shadows.

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
* **Inventory & Paperdoll (`I`)**: 4 equipment slots (`Weapon`, `Armor`, `Gloves`, `Ring`), dynamic Carry Weight bar (`lb`), and pack list (Left-click to equip/swap, Right-click to drop).
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

## 5. Persistence, Authentication & Moderation

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
