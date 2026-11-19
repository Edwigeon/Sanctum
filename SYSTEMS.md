# PROJECT: SANCTUM — Current Systems Architecture

> **Motto:** Small. Fast. Efficient. Moddable.  
> **Architecture:** 15 Hz Server-Authoritative Simulation • Dual-Resolution 60+ FPS Browser Client • Zero Build Step ES Modules

---

## 1. Directory & Module Overview

```text
Sanctum/
├── shared/                     # Deterministic modules shared by Node.js server & browser client
│   ├── Constants.js            # Engine specs, tile IDs, rarities, modes, WebSocket packet types
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
│       ├── Renderer.js         # Dual-canvas rendering pipeline & offscreen floor buffer
│       ├── Interpolator.js     # 15 Hz snapshot buffer -> smooth 60+ FPS entity interpolation
│       ├── HUDController.js    # In-game DOM HUD, Character Sheet (C), Inventory (I), Pause/Invite
│       ├── InputController.js  # Mouse world projection, LMB move/attack lock, RMB skill, hotkeys
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

## 3. Dual-Resolution Client Architecture (`/client`)

### Dual-Canvas Pipeline (`Renderer.js`)
Sanctum separates world tile rendering from high-DPI entities and typography:
1. **Offscreen Floor Baking (`mapBufferCanvas`)**:
   * When `ROOM_INIT` arrives (or the party descends a floor), `bakeDungeonBuffer()` renders the entire `40×30` floor (`480×360` pixels) once onto an offscreen canvas (`alpha: false`) using the 16-color PICO-8 palette (`PAL`).
2. **Low-Res World Layer (`#pixelCanvas`, `242×146`)**:
   * Upscaled via CSS `image-rendering: pixelated`.
   * Includes a 2px margin over the `240×144` internal viewport so fractional subpixel camera offsets can be shifted smoothly on the GPU via CSS `translate3d(-fracX * stageScale, -fracY * stageScale, 0)`.
   * **Dirty-Checked Blit**: `pixelCanvas` is only redrawn when the integer camera coordinate (`Math.floor(camera.x)`, `Math.floor(camera.y)`) changes, performing a single `pCtx.drawImage(mapBufferCanvas, ...)` copy.
3. **High-DPI Entity & Typography Layer (`#highResCanvas`)**:
   * Sized to the physical display resolution (`stageW * devicePixelRatio` × `stageH * devicePixelRatio`).
   * **Camera-to-Player Lock**: The camera locks directly to the local player's interpolated position (`myP.rx`, `myP.ry`) clamped to dungeon bounds, preventing player/camera phase jitter.
   * **Subpixel-Anchored Pawns (`drawAnchoredRect`)**: Entities are positioned at their exact floating-point screen anchor `(ax - camera.x) * stageScale`, while internal multi-block body offsets (`ox`, `oy`, `w`, `h`) are integer-rounded relative to that anchor so multi-part sprites glide smoothly across pixels without internal seams.
   * **Crisp Text Shadows**: Renders player nametags, floating combat text (`DAMAGE`, `CRIT`, `HEAL`, `LEVEL UP!`, `Too Heavy!`), and hovered loot tooltips with crisp 1px offset drop shadows (avoiding expensive Canvas 2D Gaussian `shadowBlur`).

### Snapshot Interpolation (`Interpolator.js`)
* Buffers up to 6 incoming `WORLD_SNAPSHOT` packets (broadcast at 15 Hz).
* Maintains a continuous `renderTick` targeting `latest.tick - 1.25` ticks behind the server head.
* Advances `renderTick` by `dt * 15` each animation frame with a gentle two-tier proportional drift correction (`gain = 0.8` within normal bounds, `3.0` if drift exceeds `0.5` ticks) to eliminate networkarrival micro-stutter.

### Controls & Input (`InputController.js`)
* **Left Mouse Button (LMB)**:
  * Clicking ground loot sends `PICKUP_LOOT` (walking to the item automatically if out of range).
  * Clicking/holding on a monster locks onto `targetMonsterId` (`INPUT_ATTACK` with `hold: true`), pursuing and auto-attacking until mouse release or monster death.
  * Clicking/dragging empty floor enters continuous move steering (`holdMode = 'move'`), sending `INPUT_MOVE` packets every `66 ms` toward the cursor.
* **Right Mouse Button (RMB)**: Casts the active projectile skill (`INPUT_SKILL`) toward the cursor angle (`10 MP` cost).
* **Keyboard Shortcuts**:
  * `1`: Drink Health Potion (`+40 HP`).
  * `C`: Toggle Character Sheet & Attribute Allocation panel.
  * `I`: Toggle Inventory & Equipment Paperdoll panel.
  * `ESC`: Close open side panels, or toggle the In-Game Pause & Invite Menu.

### In-Game HUD & Menus (`HUDController.js` & `MenuController.js`)
* **Dirty-Checked DOM Updates**: `HUDController` hashes vitals (`hp|maxHp|mp|maxMp|isDead`) and inventory JSON so DOM nodes are only mutated when values change.
* **Character Sheet (`C`)**: Displays level, XP bar, core attributes (`Might`, `Focus`, `Agility`, `Vitality`), interactive `+` allocation buttons when `statPoints > 0`, and derived combat stats (`Melee Dmg`, `Spell Power`, `Armor`, `Crit Chance`, `Move Speed`).
* **Inventory & Paperdoll (`I`)**: Displays 4 equipment slots (`Weapon`, `Armor`, `Gloves`, `Ring`) color-coded by rarity, a dynamic Carry Weight bar (`lb`), and the pack list (Left-click to equip/swap, Right-click to drop onto the floor).
* **Invite Links**: Every active room (including `Quick Play (Private)` rooms) has a 6-character uppercase `inviteCode`. Players can click **`Copy Invite: <CODE>`** in the top bar or inside the `ESC` Pause Menu to copy a `http://.../?join=<CODE>` link, or paste a friend's code directly in the Pause Menu to hop rooms.

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
   * Moves Spark projectiles at `3.5 px/tick` (lifetime `40 ticks`), stopping on walls or dealing `p.spellDmg` upon hitting a monster within `10 px`.
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
* **Moderator Portal (`/mod`)**: Allows moderators to view database counters, manually prune expired accounts, search/ban/promote/extend accounts, and inspect or edit any character's level, stats, hardcore death state, or raw inventory JSON.
