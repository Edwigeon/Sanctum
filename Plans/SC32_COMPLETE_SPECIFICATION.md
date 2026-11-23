# SC-32 VIRTUAL COMPUTING SYSTEM
## Complete Hardware, Runtime & Cartridge Architecture Specification
### Revision 1.0 — Comprehensive Master Reference

**Date:** November 22, 2026  
**Status:** Frozen Platform Baseline Specification  
**Architecture:** 32-Bit Logical Virtual Fantasy Console  
**Reference Debut Cartridge:** Sanctum (ARPG)  
**Host Implementation Language:** Rust  
**Scripting Environment:** Embedded QuickJS-NG (ES2020+)  
**Cartridge Format:** `.scart` (Format v1.0)  
**Audio Architecture:** Lanthorn-PSG (8-Voice Synthesizer)  
**Target Environments:** Desktop Native (Windows, Linux, macOS Universal) + Supported Web Edition

---

# Table of Contents
1. [System Vision & Platform Identity](#1-system-vision--platform-identity)
2. [SC-32 Virtual Hardware Specification](#2-sc-32-virtual-hardware-specification)
3. [Video Display Processor (VDP) & SANCTUM-48 Color Engine](#3-video-display-processor-vdp--sanctum-48-color-engine)
4. [Core Runtime, Dual-Rate Scheduler & World Streaming](#4-core-runtime-dual-rate-scheduler--world-streaming)
5. [Audio Processing Unit (APU) — Lanthorn-PSG](#5-audio-processing-unit-apu--lanthorn-psg)
6. [Native Interface, QuickJS-NG FFI Bridge & Buffer Sharing](#6-native-interface-quickjs-ng-ffi-bridge--buffer-sharing)
7. [Cartridge Container Specification (`.scart` v1.0) & BIOS POST](#7-cartridge-container-specification-scart-v10--bios-post)
8. [Desktop Distribution, Storefronts (Steam/GOG) & Platform Layer](#8-desktop-distribution-storefronts-steamgog--platform-layer)
9. [Official Hardware Branding, Logo & System Typography](#9-official-hardware-branding-logo--system-typography)
10. [Dual-Platform Migration Plan & Acceptance Criteria](#10-dual-platform-migration-plan--acceptance-criteria)

---

# 1. System Vision & Platform Identity

The **SC-32** is a fixed-specification, 32-bit logical virtual fantasy console implemented in Rust. Its hardware design evokes the transitional late 16-bit and early 32-bit computing eras (arcade boards such as Neo Geo MVS and Capcom CPS, alongside early RISC workstations and the first generation of 32-bit consoles), combining period-appropriate constraints with modern systems engineering.

### 1.1 Foundational Architecture Axioms
* **The Console is the Platform; Sanctum is the Application:** The engine does not contain hardcoded RPG mechanics or game-specific logic. SC-32 provides a reusable virtual hardware machine capable of executing any cartridge designed for its specifications.
* **One Fixed Hardware Specification:** All cartridges target an identical virtual machine specification. There are no expandable RAM/VRAM configurations or custom memory mapping chips.
* **Zero Host Bleed:** SC-32 hardware specifications are internal to the virtual console. Its CPU budget, system RAM, VDP VRAM, hardware quotas, and device behavior are fixed regardless of host capabilities. The Rust host provides the underlying implementation and backing resources, but host CPU, RAM, GPU, and operating-system capabilities cannot expand or alter the virtual hardware specification.
* **Hybrid Rust / JavaScript Architecture:** High-performance native Rust services own hardware emulation, rasterization, audio mixing, thread scheduling, storage, and server process supervision. Embedded QuickJS-NG executes game scripts against a strictly sandboxed virtual hardware API (`sanctum:engine`).
* **First-Class Dual-Platform Parity:** While native desktop execution is primary, the existing browser edition of Sanctum remains independently supported and maintained through Web-compatible platform adapters.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SC-32 VIRTUAL CONSOLE                           │
├────────────────────────────────────────────────────────────────────────┤
│ A. NATIVE HOST RUNTIME (Rust)                                          │
│    ├── Main Loop & Dual-Rate Scheduler ├── Platform Windowing (winit)  │
│    ├── VDP 3-Plane Graphics Pipeline   ├── WGPU Presentation Context   │
│    ├── APU 8-Voice Lanthorn-PSG Mixer  ├── OS Per-User Storage Dirs    │
│    ├── .scart Virtual Module Loader    └── Managed Node.js Supervisor  │
├────────────────────────────────────────────────────────────────────────┤
│ B. SCRIPT EXECUTION HOST (QuickJS-NG + FFI Bridge)                     │
│    └── Exposes native "sanctum:engine" (core, graphics, audio, input)  │
├────────────────────────────────────────────────────────────────────────┤
│ C. GAME APPLICATION LAYER (JavaScript ES Modules)                      │
│    ├── Game Rules & State Machines     ├── Combat & Stat Engine        │
│    ├── Spatial World Logic             └── High-Resolution UI Runtime  │
├────────────────────────────────────────────────────────────────────────┤
│ D. CARTRIDGE CONTAINER (.scart v1.0)                                   │
│    └── Binary Header | Section Table | Compressed Scripts, Sprites, SFX│
└────────────────────────────────────────────────────────────────────────┘
```

---

# 2. SC-32 Virtual Hardware Specification

The SC-32 defines authoritative physical resource reservations. Host systems allocate and enforce these budgets strictly.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          SC-32 HARDWARE MATRIX                         │
├────────────────────────────┬───────────────────────────────────────────┤
│ Virtual CPU Architecture   │ 32-bit logical, Little-Endian             │
│ Nominal Virtual Clock      │ 15 MHz                                    │
│ Authoritative Simulation   │ Fixed 15 Hz tick loop (66.67ms per tick)  │
│ Virtual Cycle Budget       │ 1,000,000 cycles per tick (Watchdog-gated)│
│ Logical System RAM         │ 32 MiB fixed allocation                   │
│ Logical VDP VRAM           │ 12 MiB fixed allocation (Double-buffered) │
│ APU Synthesizer            │ 8-Voice Lanthorn-PSG @ 22,050 Hz Stereo   │
│ Standardized Controller    │ 12-button virtual pad + dual-coord pointer│
│ Maximum Cartridge Size     │ 32 MiB on-disk (.scart container)         │
│ Maximum Loaded Active Data │ 16 MiB resident cartridge working memory  │
└────────────────────────────┴───────────────────────────────────────────┘
```

### 2.1 Virtual CPU (SC-32 Core)
The virtual CPU is a logical execution environment. It provides deterministic 32-bit integer arithmetic and instruction metering:
* **Nominal Clock:** 15 MHz.
* **Simulation Rate:** 15 Hz tick frequency (`TICK_INTERVAL_MS = 66.67ms`).
* **Cycle Metering:** 1,000,000 virtual cycles allocated per tick. Monitored via QuickJS instruction counting and weighted native dispatch.
* **Watchdog Protection:** Soft warning at 50ms; hard execution clamp at 66.67ms to prevent runaway scripts from hanging the host application.

### 2.2 System RAM Budget (32 MiB Fixed)
The SC-32 provides 32 MiB of fixed logical system RAM. This is an internal virtual hardware memory budget managed by the console runtime.

All cartridge-accessible and console-managed allocations must respect this limit. The Rust host implementation may require additional physical memory for executable code, operating-system integration, graphics drivers, audio infrastructure, and other native implementation details. Such host overhead is not part of the SC-32's logical RAM specification.

The virtual RAM budget is enforced independently of host memory availability. Host resources cannot be exposed to cartridges as additional system RAM.

| Subsystem Partition | Capacity | Scope & Ownership |
|:---|:---|:---|
| **Kernel & Runtime** | 4 MiB | Virtual kernel state, console bookkeeping, device state and runtime-managed structures |
| **Scripting Heap** | 8 MiB | QuickJS-NG game scripting heap |
| **Game State & Entities** | 6 MiB | Active pawn tables, inventory structs, combat buffers, player state |
| **World & Map Working Memory** | 6 MiB | Spatial chunk index, resident tile arrays, occlusion cache |
| **Audio Resources** | 2 MiB | Console-managed audio data and buffers |
| **Networking & I/O** | 2 MiB | Console-managed communication and I/O buffers |
| **Reserved & Headroom** | 4 MiB | Inter-subsystem message queues, emergency diagnostics |
| **Total System RAM** | **32 MiB** | **33,554,432 bytes** |

### 2.3 Hardware Quotas
* **Active Entities:** 512 total simulated entities (players, monsters, projectiles, ground loot).
* **Active AI Entities:** 128 simultaneous entities running behavior trees/pathfinding.
* **Active Map Chunks:** 64 resident spatial chunks ($32 \times 32$ or $40 \times 30$ tile cells).
* **Resident Sprite Assets:** 512 cached sprite stamps.
* **Max Sprite Size:** $64 \times 64$ pixels.
* **Max Animation Frames:** 64 frames per sequence.
* **Max Tile Dimensions:** $16 \times 16$ pixels (Sanctum defaults to $12 \times 12$).
* **Max Save File Size:** 4 MiB per slot.

---

# 3. Video Display Processor (VDP) & SANCTUM-48 Color Engine

The VDP is Sanctum’s dedicated graphics subsystem. It manages indexed-color processing, brightness quantization, colored-light remapping, 4×4 Bayer dithering, multi-plane compositing, and presentation scaling.

```
┌──────────────────────────────────────────────────────────────────┐
│ Plane 3 — Interface (HiRes 720×432, Screen-Space)                │
│ Menus, Inventory, Character Sheets, Tooltips, Vector Typography  │
├──────────────────────────────────────────────────────────────────┤
│ Plane 2 — Detail (HiRes 720×432, World-Space)                    │
│ Pawns, Monsters, Combat Spells, Floating Text, Subpixel Motion   │
├──────────────────────────────────────────────────────────────────┤
│ Plane 1 — World (LoRes 240×144, 8-Bit Indexed)                   │
│ Dungeon Floors, Walls, Doodads, Dynamic Lighting & Dithering     │
└──────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                     VDP Multi-Plane Compositor
                                 │
                                 ▼
                     WGPU Host Presentation
```

### 3.1 VDP VRAM Allocation (12 MiB Fixed)
The VDP allocation guarantees true hardware double-buffering across all three display planes at the $720 \times 432$ resolution:

| VRAM Partition | Allocated Capacity | Target Usage & Buffering Model |
|:---|:---|:---|
| **World Framebuffer (Double)** | **128 KiB** | Front + back buffer for 240×144 8-bit indexed plane ($2 \times 34{,}560 \text{ B} = 69{,}120 \text{ B} \approx 67.5 \text{ KiB}$) |
| **Detail Framebuffer (Double)** | **2,560 KiB** (2.50 MiB) | Front + back buffer for 720×432 RGBA32 ($2 \times 1{,}244{,}160 \text{ B} = 2{,}488{,}320 \text{ B} \approx 2.37 \text{ MiB}$) |
| **UI Framebuffer (Double)** | **2,560 KiB** (2.50 MiB) | Front + back buffer for 720×432 RGBA32 ($2 \times 1{,}244{,}160 \text{ B} = 2{,}488{,}320 \text{ B} \approx 2.37 \text{ MiB}$) |
| **Sprite & Tile Storage** | **2,048 KiB** (2.00 MiB) | Dedicated virtual VDP storage for sprite data, tile data, and resident sprite stamps |
| **Lighting Buffers** | **1,024 KiB** (1.00 MiB) | `lightGrid` (scalar), `lightR`, `lightG`, `lightB` grids + interpolation scratch |
| **Palette & Remapping LUT** | **128 KiB** | SANCTUM-48 (144 B) + $LUT[48][9][6][3]$ (7,776 B) + Bayer matrices (~8 KiB) |
| **Compositing & Scratch** | **1,024 KiB** (1.00 MiB) | Presentation scaler scratchpad, aspect-ratio letterboxing clear buffers |
| **Reserved / Alignment** | **800 KiB** | Base alignment and reserved VDP structures |
| **Dynamic VDP Headroom** | **2,016 KiB** | Unallocated capacity available to VDP-managed subsystems |
| **Total VDP Memory** | **12 MiB** | **12,288 KiB (12,582,912 bytes)** |

> [!NOTE]
> ### Sprite & Tile Storage Specification
> Dedicated virtual VDP storage for sprite data, tile data, and resident sprite stamps.
> Sprites are constructed from bit-array representations rather than being defined as conventional 8-bit-per-pixel bitmap allocations. Storage consumption is determined by the actual bit-array representation and its packed data size.
> The VDP supports up to 512 resident sprite stamps, with a maximum sprite dimension of 64×64 pixels. Tile assets share the designated sprite and tile storage allocation.
> The 2 MiB allocation represents the fixed virtual storage capacity, not an assumption that every resident sprite occupies a full 64×64 8-bit bitmap.

### 3.2 Master Palette — SANCTUM-48
World tile and sprite assets reference authoritative 8-bit palette indices (`0..=47`). Direct RGB hexadecimal strings in world definitions are strictly forbidden. Index `0` is a valid Slate tone (`#171A24`) and is never treated as transparent or pitch black.

```
Category: Muted (Indices 0–15)
├── Slate   [ 0.. 3]: #171A24, #29313D, #414B56, #606B70
├── Stone   [ 4.. 7]: #302B2A, #49413A, #65594A, #81735E
├── Earth   [ 8..11]: #382E2A, #554337, #765A42, #9A7956
└── Moss    [12..15]: #293B32, #405744, #5D7655, #82916A

Category: Vibrant (Indices 16–39)
├── Crimson [16..19]: #682D3B, #A53D4C, #DE5360, #F18476  (Health, combat, blood)
├── Amber   [20..23]: #78412F, #B65C35, #E58A3C, #F4B65E  (Gold, torches, UI gold)
├── Verdant [24..27]: #315B3C, #438A50, #69B96A, #A0D783  (Poison, nature, flora)
├── Azure   [28..31]: #245D68, #328B91, #50BDB4, #9ADBD0  (Mana, cold, lightning)
├── Arcane  [32..35]: #34345F, #594C9B, #8871C5, #C1A5E8  (Void, curses, magic)
└── Rose    [36..39]: #754052, #AC5C70, #D98996, #F0B9B1  (Potions, runes, charms)

Category: Neutral (Indices 40–47)
└── Monochromes & Parchment:
    40: #0D0E12 (Void Black)       41: #252831 (Deep Charcoal)
    42: #3A3E46 (Gunmetal)         43: #62666D (Stone Gray)
    44: #92969A (Silver Gray)      45: #C1C3BE (Pale Slate)
    46: #E5DFC9 (Warm Parchment)   47: #FFF8E8 (High-DPI Font White)
```

### 3.3 Brightness Processor & Quantization
The VDP quantizes continuous lighting into 9 discrete brightness bands:
$$\text{Bands: } 0 \text{ (Pitch Black)} \dots 4 \text{ (Dim)} \dots 5 \text{ (Normal)} \dots 8 \text{ (Full Illumination)}$$
$$48 \text{ Colors} \times 9 \text{ Brightness Bands} = \mathbf{432 \text{ Discrete Illumination States}}$$

### 3.4 Hybrid Colored Lighting & Palette Remapping ($LUT$)
The Core simulates light propagation and raycast occlusion into 4 authoritative buffers (`lightGrid`, `lightR`, `lightG`, `lightB`). The VDP interpolates these bilinearly and maps the resulting illumination through a precomputed, constant-time lookup table:
$$\text{Resolved Index} = LUT[P][B][T][S]$$
* $P$ = Base palette index ($0 \dots 47$)
* $B$ = Brightness band ($0 \dots 8$)
* $T$ = Tint category (0: Neutral, 1: Warm, 2: Red, 3: Green, 4: Cool, 5: Arcane)
* $S$ = Tint strength (0: None, 1: Subtle, 2: Strong)
$$\text{Dimensions: } 48 \times 9 \times 6 \times 3 = \mathbf{7{,}776 \text{ entries (7,776 bytes)}}$$

### 3.5 World-Anchored 4×4 Bayer Dithering
The VDP incorporates a unified $4 \times 4$ Bayer matrix to smooth transitions between brightness bands and overlapping colored lights:
$$D_4 = \frac{1}{16} \begin{bmatrix}
 0 &  8 &  2 & 10 \\
12 &  4 & 14 &  6 \\
 3 & 11 &  1 &  9 \\
15 &  7 & 13 &  5
\end{bmatrix}$$
* **World-Anchored:** Dither coordinates are calculated modulo 4 using absolute world tile coordinates ($\text{Matrix}_X = X_{\text{world}} \pmod 4$), guaranteeing zero "dither swimming" during camera panning.
* **Perceptual Range:** Expands the perceived tonal range of Plane 1 to **~450–600 optical shades** without introducing unindexed RGB colors.

---

# 4. Core Runtime, Dual-Rate Scheduler & World Streaming

### 4.1 Dual-Rate Execution Timing Model
The engine separates authoritative 15 Hz simulation from 60+ FPS presentation:
```rust
let mut accumulator = Duration::ZERO;
let sim_step = Duration::from_micros(66_667); // 15 Hz authoritative tick

while running {
    poll_platform_events();
    accumulator += frame_timer.elapsed();
    
    // Fixed-Step Simulation Loop (15 Hz)
    while accumulator >= sim_step {
        script_runtime.invoke_update(1.0 / 15.0);
        accumulator -= sim_step;
    }
    
    // Decoupled Presentation Loop (60+ FPS)
    let alpha = accumulator.as_secs_f32() / sim_step.as_secs_f32();
    vdp.render(&script_runtime, alpha);
    platform_services.update();
}
```

### 4.2 Large-World Chunk Streaming Subsystem (`WORLD`)
* **Signed Coordinate Space:** World coordinates use `i32` spatial coordinates.
* **Six-Stage Lifecycle:**
  $$\text{Unloaded} \longrightarrow \text{Queued} \longrightarrow \text{Loading (Worker)} \longrightarrow \text{Ready} \longrightarrow \text{Resident} \longrightarrow \text{Evicting}$$
* **Safe Integration:** Background worker threads read and decode chunk records from disk. Prepared chunks are mounted into active simulation memory strictly at 15 Hz tick boundaries.

---

# 5. Audio Processing Unit (APU) — Lanthorn-PSG

The APU provides native 8-voice programmable sound generation running on a dedicated audio callback thread (`cpal`) at 22,050 Hz stereo:

```
┌──────────────────────────────────────────────────────────────────┐
│                   LANTHORN-PSG 8-VOICE APU                       │
├─────────────────┬─────────────────┬──────────────────────────────┤
│ Voices 0–3      │ Voices 4–5      │ Voices 6–7                   │
│ General Synth   │ Percussion/Wave │ Reserved SFX                 │
│ Pulse/Triangle  │ White Noise &   │ Combat Hit Audio,            │
│ Melodies & Bass │ Metallic Noise  │ Chimes, UI Confirmations     │
└─────────────────┴─────────────────┴──────────────────────────────┘
```

* **Zero JavaScript Sample Computation:** QuickJS-NG never computes raw waveform samples. The native Rust APU loads and parses `data/music/soundtrack.json` presets directly.
* **Script Dispatch:** Games trigger audio via constant-time host commands:
  ```javascript
  audio.playSfx(sfxId, { note: 60, volume: 1.0, pan: 0.0 });
  audio.playMusic(trackId, { loop: true, fadeInMs: 500 });
  ```

---

# 6. Native Interface, QuickJS-NG FFI Bridge & Buffer Sharing

### 6.1 The Unified Import Specifier: `"sanctum:engine"`
Game code imports engine subsystems using standard ECMAScript syntax across both desktop and browser:
```javascript
import { core, graphics, audio, input, storage, world, network } from "sanctum:engine";
```
* **Desktop Console:** QuickJS-NG native module loader binds to Rust FFI exports.
* **Browser Sanctum:** `client/platform/browser_engine.js` resolves imports to HTML5 Canvas, Web Audio, and DOM event listeners.

### 6.2 Zero-FFI-Overhead Buffer Sharing
* **World Plane (`graphics.worldBuffer`):** Rust exposes Plane 1 directly into QuickJS as a persistent `Uint8Array(34560)`. JavaScript tilemap routines write palette indices directly to VRAM memory without FFI crossing penalties.
* **Detail & UI Planes (`graphics.drawSpriteBatch`):** JavaScript submits active entity batches as pre-packed `Float32Array` buffers in a single FFI call.

### 6.3 Dual Pointer Coordinates & Input Consumption
```javascript
const pointer = input.getPointer();

// 1. Plane 3 Screen Space (0..720, 0..432) for UI Hit-Testing
if (uiManager.handlePointer(pointer.screenX, pointer.screenY)) {
  input.consumePointer(); // Consumes click for this frame
}

// 2. Plane 1 World Space (Float world coordinates)
if (!input.isPointerConsumed()) {
  playerController.targetWorld(pointer.worldX, pointer.worldY);
}
```

### 6.4 Cross-Platform Server IPC Handshake
The native runtime launches the Node.js server child process with `PORT=0` and `SANCTUM_MANAGED=1`. Communication uses standard I/O to guarantee clean SQLite shutdowns on Windows:
* **Startup:** Node binds ephemeral port and writes: `SANCTUM_READY {"port": 54321}\n`.
* **Shutdown:** Rust writes `{"cmd":"shutdown"}\n` to Node's `stdin`. Server flushes SQLite WAL and closes rooms before exiting with Code 0.

### 6.5 Atomic Save State Serialization (`SSAV`)
Saves in `saves/` are wrapped with an 8-byte container:
$$\text{Header: } \text{Magic } (\texttt{b"SSAV"}) \mathbin{\Vert} \text{Version } (0x0100) \mathbin{\Vert} \text{Flags } (u16) \mathbin{\Vert} \text{CRC32 } (u32) \mathbin{\Vert} \text{Payload}$$
Written to `save_slot.tmp`, flushed to disk (`fsync`), and atomically renamed to `save_slot.dat`.

---

# 7. Cartridge Container Specification (`.scart` v1.0) & BIOS POST

### 7.1 Binary Container Layout
All integers are encoded in little-endian byte order:

| Offset | Field | Type | Size | Description |
|:---|:---|:---|:---|:---|
| `0x00` | `magic` | `[u8; 4]` | 4 bytes | Magic identifier: ASCII `b"SCAR"` (`0x53, 0x43, 0x41, 0x52`) |
| `0x04` | `format_version` | `u16` | 2 bytes | Container version (`0x0100` for v1.0) |
| `0x06` | `header_size` | `u16` | 2 bytes | Byte length of container header |
| `0x08` | `directory_offset` | `u64` | 8 bytes | Byte offset to Section Directory table |
| `0x10` | `auth_offset` | `u64` | 8 bytes | Byte offset to Authentication Area (EOF) |
| `0x18` | `auth_reserved_size`| `u32` | 4 bytes | Exactly `1024` bytes in Format 1.0 |
| `0x1C` | `package_flags` | `u32` | 4 bytes | Bitmask flags (e.g. Developer Signed) |
| `0x20` | `reserved` | `[u8; 32]` | 32 bytes | Zero-filled padding |

### 7.2 Hashing & Integrity
* **Content Hash ($H_c$):** $H_c = \text{SHA256}(\text{file}[0 : \text{auth\_offset}])$. Covers all header, manifest, directory, and section payloads, while strictly excluding the mutable 1,024-byte authentication area.
* **Section Hash ($H_s$):** $H_s = \text{SHA256}(\text{stored section bytes})$. Verifies stored bytes prior to Zstandard decompression.

### 7.3 Multi-Core Cartridge Portability (DRM-Free GOG Model)
* When a `.scart` cartridge is copied to a new machine or laptop:
  1. Core computes $H_c$ and validates container integrity.
  2. Seeing a valid $H_c$ but a different `core_id`, **the new Core re-registers the cartridge to itself in-place**, re-signing the 1,024-byte record with its local identity key.
  3. Guarantees 100% DRM-free portability with zero machine locking.

### 7.4 Virtual Module Paths
Every `CODE` section advertises a canonical path:
```
CODE: /game/main.js
CODE: /game/player.js
CODE: /game/systems/inventory.js
```
The QuickJS module loader resolves relative imports (`import { Player } from "./player.js"`) directly against in-memory binary sections via the console's VFS—eliminating temporary files.

### 7.5 Revised Functional BIOS POST Sequence
The BIOS executes a deterministic, multi-stage hardware and cartridge self-test before transferring execution to `/game/main.js`. Each line represents a real synchronous initialization step in Rust rather than a timed splash screen:

* **Stage 1 — SYS RAM : 32768 KB (System Memory & VM Sandbox)**
  * **Action:** Allocates the deterministic subsystem pools (33,554,432 bytes total), initializes the QuickJS-NG runtime with a hard 8,192 KB (8,388,608 bytes) heap ceiling, and loads or generates the Core's persistent Ed25519 identity keypair.
  * **Readout:** Counts `00000 KB -> 32768 KB -> OK`.
* **Stage 2 — VDP VRAM: 12288 KB (Graphics Buffers & SANCTUM-48 LUT)**
  * **Action:** Allocates double-buffered framebuffers for Plane 1 (240×144 indexed), Plane 2 (720×432 RGBA), and Plane 3 (720×432 RGBA), builds the 7,776-byte `LUT[48][9][6][3]` lighting and tint table, initializes the 4×4 Bayer matrix, and unpacks the 1,024-byte embedded 8×8 BIOS bitmap font.
  * **Readout:** Counts `00000 KB -> 12288 KB (SANCTUM-48 LUT) ... OK`.
* **Stage 3 — APU PSG : 8-CH 22050 HZ (Audio Synthesizer)**
  * **Action:** Opens the host audio stream at 22,050 Hz stereo and initializes the 8-voice Lanthorn-PSG mixer.
  * **Readout:** Displays `OK` (or `NO AUDIO` in Amber 23 `#F4B65E` on headless setups without halting boot).
* **Stage 4 — CART ROM: <TITLE> [<SIZE> KB] (.scart Verification & Core Registration)**
  * **Action:** Reads the container header (`SCAR` v1.0), streams `[0 .. auth_offset]` through SHA-256 to verify the content hash $H_c$, validates or writes the Ed25519 ownership record in the 1,024-byte Authentication Area, decompresses Zstd sections (PALT, SPRT, AUDD, MUSD, CODE), and mounts virtual `/game/*.js` modules into QuickJS-NG.
  * **Readout:** Displays cartridge title and resident KB size (e.g., `CART ROM: SANCTUM [1312 KB] ... OK`), flashing `REGISTERING CORE ID...` on first-boot registration. Halts with `HASH MISMATCH` in Crimson 18 (`#DE5360`) if integrity fails.
* **Stage 5 — NET LINK: ... (Conditional Online / Local Loopback Check)**
  * Triggered only when the cartridge manifest declares `"network"` in `required_capabilities` or `optional_capabilities` (completely skipped for pure offline cartridges):
    * **Local / Singleplayer Mode:** Spawns the managed Node.js server on 127.0.0.1 (`PORT=0`), awaits the `SANCTUM_READY {"port": ...}` stdout handshake, and verifies an active loopback socket.
      * **Readout:** `NET LINK: LOOPBACK 127.0.0.1:<PORT> .... OK`
    * **Online Multiplayer Mode:** Performs a non-blocking TCP/TLS handshake (with a strict ~1,500 ms timeout) against the configured server endpoint (e.g., `sanctum.schahn.duckdns.org` or a user-specified LAN/WAN host) to verify reachability and latency before launching the game client.
      * **Readout (Success):** `NET LINK: ONLINE (24 MS) ............. OK`
      * **Readout (Unreachable, optional_capabilities):** `NET LINK: OFFLINE (FALLBACK LOCAL) ... WARN` (in Amber 23 `#F4B65E`)
      * **Readout (Unreachable, required_capabilities):** `NET LINK: UNREACHABLE (ERR_NO_LINK) .. HALT` (in Crimson 18 `#DE5360`)

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                            SC-32                                 │
│                                                                  │
│  SYS RAM : 32768 KB ..................................... OK     │
│  VDP VRAM: 12288 KB (SANCTUM-48 LUT) .................... OK     │
│  APU PSG : 8-CH 22050 HZ ................................ OK     │
│  CART ROM: SANCTUM [1312 KB] ............................ OK     │
│  NET LINK: LOOPBACK 127.0.0.1:44303 ..................... OK     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

# 8. Desktop Distribution, Storefronts (Steam/GOG) & Platform Layer

### 8.1 Standalone is the Canonical Product
Storefront integrations are layered on top via the `PlatformServices` trait. Sanctum Core never links storefront libraries directly:

```rust
pub trait PlatformServices: Send + Sync {
    fn storefront(&self) -> StorefrontKind;
    fn initialize(&mut self) -> Result<(), PlatformError>;
    fn update(&mut self);
    fn unlock_achievement(&mut self, id: &str) -> Result<(), PlatformError>;
    fn set_presence(&mut self, state: &str, details: &str);
    fn save_cloud_file(&mut self, filename: &str, data: &[u8]) -> Result<(), PlatformError>;
    fn load_cloud_file(&mut self, filename: &str) -> Result<Option<Vec<u8>>, PlatformError>;
    fn shutdown(&mut self);
}
```

* **`PlatformStandalone`:** Canonical DRM-free build (local saves in OS user directories, null presence).
* **`PlatformSteam`:** Safe Rust FFI wrapper around Steamworks (Overlay, Auto-Cloud, Achievements, Friends).
* **`PlatformGOG`:** GOG Galaxy SDK integration with strict offline DRM-free operation.

### 8.2 Native Release Matrix
* **Windows:** 64-bit `.exe` portable + installer, Authenticode signed.
* **Linux:** 64-bit native binary + AppImage, Steam Runtime (Scout/Sniper) compliant.
* **macOS:** Universal Binary (`x86_64` + `arm64`), signed and notarized `.app` / `.dmg`.

---

# 9. Official Hardware Branding, Logo & System Typography

### 9.1 The Official SC-32 Hardware Logo
```
  ███████╗ ██████╗       ██████╗  ██████╗ 
  ██╔════╝██╔════╝       ╚════██╗╚════██╗
  ███████╗██║      █████╗ █████╔╝ █████╔╝
  ╚════██║██║      ╚════╝ ╚═══██╗██╔═══╝ 
  ███████║╚██████╗       ██████╔╝███████╗
  ╚══════╝ ╚═════╝       ╚═════╝ ╚══════╝
    S        C     ───      3       2   
```
* **Lockup:** `[ SC-32 ] VIRTUAL COMPUTING SYSTEM`
* **Canonical Colors:** Amber 23 (`#F4B65E`) and Amber 20 (`#78412F`) on Void Black (`#0D0E12`).

### 9.2 Embedded BIOS 8×8 Bitmap Font
* 1-bit uncompressed binary array embedded in native Rust ($128 \text{ ASCII characters} \times 8 \text{ bytes} = \mathbf{1{,}024 \text{ bytes}}$).
* Includes dedicated controller glyphs: `[▲]`, `[▼]`, `[◀]`, `[▶]`, `(A)`, `(B)`, `(X)`, `(Y)`, `[L]`, `[R]`, `[ST]`, `[SE]`, and status icons: `♥` (Health), `◆` (Mana), `★` (XP), `●` (Gold), `☠` (Fallen Hero).

### 9.3 Multi-Tier Hi-Res Font Scaling (Planes 2 & 3)
* **$1\times$ HiRes ($8 \times 8$ px):** Micro-labels, stack numbers (`x20`), belt slot keys.
* **$2\times$ HiRes ($16 \times 16$ px):** Inventory titles, dialogue text, button labels.
* **$3\times$ HiRes ($24 \times 24$ px):** World-aligned headers (1 font pixel equals exactly 1 low-res world pixel).
* **Smooth Subpixel Motion:** Glyphs float at continuous floating-point velocities for 60+ FPS combat text.

---

# 10. Dual-Platform Migration Plan & Acceptance Criteria

### 10.1 Phased Implementation Sequence
1. **Phase 1 — Workspace & Platform Separation:** Initialize Cargo workspace (`crates/sanctum-core`, `sanctum-vdp`, `sanctum-apu`, `sanctum-scart`). Isolate browser dependencies in `client/`.
2. **Phase 2 — Native CORE:** Embed QuickJS-NG, implement dual-rate 15Hz/60Hz scheduler, build `"sanctum:engine"` module loader.
3. **Phase 3 — Managed Server:** Implement Node.js supervisor with stdin/stdout IPC handshake.
4. **Phase 4 — VDP & Palette Remapping:** Build 240×144 indexed framebuffer, 7,776-entry LUT, 4×4 Bayer dithering, and WGPU presentation surface.
5. **Phase 5 — APU & Input:** Implement 8-voice Lanthorn-PSG native synthesizer; integrate `gilrs` virtual gamepad and dual pointer coordinates.
6. **Phase 6 — SCART Cartridge Builder:** Implement `scart-pack` CLI; pack Sanctum scripts and assets into `sanctum.scart`.
7. **Phase 7 — Packaging & Storefront Validation:** Build Windows, Linux, and macOS release packages; verify Standalone, Steam, GOG, and Web editions.

### 10.2 Final Acceptance Criteria
The migration is complete when:
1. SC-32 native binary boots without browser or external engine dependencies.
2. The system executes the authentic BIOS POST memory check and launches `sanctum.scart`.
3. The VDP outputs the 48-color palette with performant hybrid lighting and world-anchored dithering.
4. Audio synthesizes through native Lanthorn-PSG voices without Web Audio dependencies.
5. Input operates seamlessly across physical controllers, keyboards, and dual-plane mouse hit-testing.
6. The managed Node.js server launches automatically via loopback IPC.
7. Standalone builds operate 100% DRM-free offline.
8. The browser client remains fully operational and supported.
