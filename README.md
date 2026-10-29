# MachStrike

An offline, single-player fighter flight simulator for **webxdc** chat hosts, built with **Angular 22**, **SCSS**, and **Three.js**. Desktop keyboard controls and a multi-touch cockpit drive the same simulation.

## Run and package

Requires Node.js 26+ and npm.

```sh
npm install
npm start
```

`npm start` builds the app and launches **`@webxdc/webxdc-dev`**, serving `dist/machstrike-<version>.xdc` in the chat-host simulator (default UI: `http://localhost:7000`). Restart it after source changes; this deliberately previews the actual packaged app rather than `ng serve`. `npm start` packages an unoptimized development build with source maps for debugging, and reuses the current build version without incrementing it. Use `npm start -- --open` to open the simulator automatically, or `npx webxdc-dev run --help` to inspect runner options. `npm run preview -- --port 7450` serves the current version without rebuilding or incrementing it.

```sh
npm test             # flight dynamics, landing states, and combat regression tests
npm run typecheck
npm run build        # optimized Angular build + verified ZIP-format .xdc package
```

For browser smoke coverage, run `npm start -- --port 7450`, then `npm run test:browser` in another terminal. It exercises desktop, portrait-touch, and landscape-touch layouts against the packaged app in webxdc-dev. It uses `/usr/bin/google-chrome` by default; set `CHROME_PATH` to another Chromium executable and `APP_URL` to the first instance URL if needed.

Send **`dist/machstrike-<version>.xdc`** into a Delta Chat or compatible webxdc chat and launch it there. Archive filenames replace the version's `+` with `.`: version `0.1.0+3` produces `machstrike-0.1.0.3.xdc`. Before each `npm run build` or `npm run build:debug`, the numeric build suffix increments and is retained even if compilation fails; `npm start` does not increment it. `package.json`, root metadata in `package-lock.json`, `public/manifest.toml`, and the generated root `version.js` stay aligned and retain the `+` version format. Previous versioned archives are preserved. The archive has `index.html`, `manifest.toml`, `icon.png`, local bundles, and dependency license notices at its root. No runtime network, fonts, textures, models, telemetry, service workers, or CDN are required. No webxdc API is needed: each recipient plays an independent sortie; this is **not multiplayer**. Personal best scores are stored locally where the host permits storage.

## Flying

The briefing's aircraft thumbnail renders the selected 3D model and updates immediately when an aircraft option is clicked. It is rendered only on selection or resize, with no external image downloads.

Choose an aircraft in the mission briefing before launching: the original **F/A-27**, **F-14 Tomcat**, **F-15E Strike Eagle**, **F-22 Raptor**, or **Northrop YF-23 Black Widow II**. Each has a distinct procedural silhouette, finish and gameplay-balanced mass, fuel capacity, wing area, thrust, drag and angular inertia. The Tomcat is a heavier swept-wing interceptor; the Strike Eagle emphasizes power, the Raptor agility, and the YF-23 low drag with diamond wings and a V-tail. These are simplified representations, not certified real-world performance models; variable wing sweep, thrust vectoring and radar-stealth simulation are not modeled. Weapons and controls remain shared.

Selection takes effect on the next launch; resuming an existing sortie keeps its current aircraft. Autopilot trim and thrust calculations use the active profile, and the fuel gauge scales to its capacity. Procedural models use aircraft-specific fuselage sections, wing/tail planforms, canopy proportions, intakes, exhausts and landing gear: the Tomcat has widely spaced nacelles and swept wings, the Eagle broad wings and upright twin tails, the Raptor angular wings and rectangular exhausts, and the YF-23 diamond wings, canted V-tail and aft exhaust troughs. These are lightweight visual approximations rather than photorealistic scanned models.

| Action | Desktop | Touch |
|---|---|---|
| Pitch | Down / S pulls up; Up / W pushes down | Drag stick down to pull up |
| Roll | Left / A; Right / D | Drag stick sideways |
| Rudder / nosewheel | Q / E | Yaw pedals |
| Flight-path trim | [ / ] lower / raise the held flight path 1° (hold to repeat); \ levels it | — |
| Throttle | Hold Shift / Ctrl, or use slider | Throttle slider |
| Gear / flaps | G / L | Gear / flaps buttons |
| Wheel brakes | Hold B | Hold BRAKE |
| Select target | Tab or click a target box | NEXT or tap a target box |
| Radar range | Z cycles 3 / 6 / 12 / 25 km (Shift+Z reverses), or click the radar | Tap the radar |
| Missile | M | FOX TWO |
| Cannon | Hold Space | Hold GUN |
| Flares | F | FLARES |
| Camera / pause | V / P or Escape | Header buttons |
| Autopilot hold / disconnect | H | AP settings, Capture & Hold / Disconnect |
| Wings-level recovery | R | AP settings, Wings Level |
| Stall recovery | T | AP settings, Stall Recovery |

Use the in-game **flight manual** for instrumentation, combat, and recovery instructions. Mobile landscape gives the widest view, but portrait layouts also include all flight controls. Losing focus or hiding the app releases held inputs without pausing the simulation or disconnecting autopilot. Use **P / Esc** or the pause button to pause explicitly. Browsers and webxdc hosts may throttle or suspend background animation and audio.

Manual pitch uses a fighter-style fly-by-wire law (`src/app/sim/fly-by-wire.ts`) once airborne. Releasing the stick holds the current flight-path angle at any speed, with bank compensation up to 60°. Pitch input commands a flight-path rate of up to 0.20 rad/s nose up or 0.15 rad/s nose down, limited to +7.5/−3 g. Hands-off flight is held below the stall angle of attack. Sustained hard pulls at low speed or low thrust can still stall. On the ground, pitch input drives the elevator directly for rotation. The HUD shows the held flight-path angle (FPA HOLD).

The touch stick has an 8% dead zone and a progressive response for fine pitch/roll adjustments near center, while retaining full authority at its edge. Sideways input commands roll, not a held bank angle: release to stop rolling and apply opposite input to level the wings. Passive directional stability opposes sideslip during manual flight as well as autopilot flight.

**Flight School** displays step-by-step instructor guidance in the existing notification area. Keyboard/touch lessons advance as you pitch up, level off, bank, roll out and adjust thrust, followed by a 12-second instrument scan and an automatic landing demonstration. Instructions stay visible until the maneuver is performed, with contextual guidance for takeoff, configuration cleanup, stalls, low approaches, automatic flight and landing. Aircraft/action notifications temporarily take priority; guidance returns when they expire. Pausing freezes lesson progress, and a new sortie resets it. Other scenarios retain their normal communications.

Corrective instructions interrupt lessons for stalls, low descending flight, steep bank, excessive pitch/sink/speed, low airspeed, gear-down overspeed and accelerating against brakes. They explain how to recover using the current input device; lesson progress waits until the unsafe condition is corrected.

### Sorties

- **Flight school:** no enemies; practice flight, stalls, takeoff, and landing.
- **Coastal intercept:** three armed bogeys, deliberate missile cadence.
- **Overwhelming odds:** five faster bogeys with more frequent missile attacks.

Every sortie can begin airborne or on runway 36. Loadout: six infrared missiles, 640 cannon rounds, 24 flares. Acquisition requires the target within 9 degrees and 6.5 km for 1.8 seconds. Missiles have finite turn rate and fuel/time limits; cannon rounds use swept collision tests. Enemy missiles can be decoyed by flares within 1.6 km; separation and evasive maneuvering still matter. Neutralize every bogey, then return to the airbase. Kills score 1,000 points; a runway landing scores 500.

## Simulation and rendering

The fixed **120 Hz six-degree-of-freedom rigid body** integrates three translational and three rotational degrees of freedom, with quaternion attitude and Euler gyroscopic coupling. Body axes: +X right, +Y up, -Z forward. Forces include altitude-dependent density, angle-of-attack lift and stall loss, induced/parasitic/configuration drag, sideslip, gravity, throttle/afterburner thrust, fuel consumption, and ground friction/brakes. Elevator, aileron, and rudder have response lag and drive aerodynamic moments; visible surfaces are mapped to the same deflections. This is a plausible, simplified fictional fighter, **not an F/A-18 performance model, certified trainer, or CFD simulator**.

The primary display includes true airspeed (not calibrated/indicated airspeed), MSL and terrain-relative altitude, heading, pitch ladder, bank arc, vertical speed, G, angle of attack, and velocity vector. A gridded landscape, hills, procedural clouds, a marked 3.2 km runway, airbase buildings, radar, and RTB distance/bearing provide spatial references. Calm conditions mean ground speed equals true airspeed.

Takeoff/landing states are `parked → takeoff → airborne → landed`, with repeat departures supported. Safe touchdown requires gear down, a position inside the runway, sink rate below 5.5 m/s, bank below 0.18 rad, and pitch between -0.07 and 0.30 rad. Gear-up impacts, off-runway contact, or an exceeded landing envelope destroy the aircraft. Takeoff and landing can be flown manually or by the optional autopilot; stalls, excessive speed, fuel exhaustion, and enemy damage have consequences.

**Three.js** is used instead of a heavier game engine: it bundles locally, requires no model pipeline, and offers explicit control over WebGL resource use. This renderer requires **WebGL 2**; older or GPU-disabled embedded webviews show an explicit error. Geometry, runway textures, and the app icon are generated locally. Resolution is capped, lighting avoids shadow maps, and the view uses low-poly geometry for mobile GPUs.

## Project layout

- `src/app/sim/flight.ts`: aircraft physics, control mapping, terrain and runway logic.
- `src/app/sim/autopilot.ts`: physics-driven hold, wings-level/stall recovery, automatic departure, return navigation, approach, flare, rollout and go-around.
- `src/app/sim/combat.ts`: bogey AI, target lock, weapons, countermeasures, damage.
- `src/app/sim/renderer.ts`: Three.js world, aircraft, camera, effects and projections.
- `src/app/sim/sound.ts`: throttle-responsive turbine/roar synthesis and prioritized warning alarms.
- `src/app/sim/warnings.ts`: shared warning thresholds and priority for the HUD and audio.
- `src/app/sim/music.ts`: original offline-rendered score and music playback lifecycle.
- `src/app/app.component.*`: Angular cockpit, input handling, pause, briefing and manual.
- `src/styles.scss`: responsive cockpit and briefing styles, compiled by Angular's Sass pipeline. New Angular components default to SCSS.
- `scripts/package.mjs`: deterministic icon generation, release metadata and `.xdc` packaging.

Browser-based development checks cannot guarantee compatibility with every embedded GPU driver or host-specific policy. Test the final archive in the intended desktop and mobile chat hosts before distribution.

## Background music

The original **Northstar** cue uses cinematic synth brass, layered strings, bass, and marching field drums. It evokes a broad military-aviation atmosphere without using any film recordings, samples, or existing theme melodies. Web Audio renders a roughly 42-second stereo loop locally after the first launch gesture; no audio downloads or additional dependencies are needed.

Open **Music settings** (the musical-note button in the header) to mute or adjust volume, initially 35%. Music and effects volume levels are saved locally and restored on the next launch; mute toggles remain specific to the current app instance. Storage failures are reported in the settings panel without blocking playback or flight. Playback follows flight: menus, the manual, pause, and the end of a sortie suspend audio. Losing focus does not stop playback, though the host may suspend background audio. Resume or relaunch after a pause to continue. Hosts without usable Web Audio display an explicit message in music settings; the simulator remains playable.

### Engine and warning effects

The cannon plays a short synthesized report for each round actually fired, matching the 20-round-per-second firing cadence. Gun audio shares effects volume/mute, stops producing reports when firing stops or ammunition runs out, and cancels active reports on pause, menus, or a crash. It uses no downloaded recordings.

Successful missile launches play a synthesized rocket ignition and 1.1-second departing whoosh. Failed launch attempts (no lock, cooldown, or depleted missiles) remain silent apart from communications. Launch audio shares effects volume/mute and is canceled on pause, menus, or a crash.

The same panel has independent **effects mute and volume** controls (55% initially). A synthesized twin-turbine whine and filtered jet roar track throttle, with extra roar above 88% afterburner power. Fuel exhaustion silences the engine. Warnings duck the engine and play distinct looping tones: rapid alternating missile alert, pulsed terrain alarm, sustained stall horn, and separate over-G, overspeed, low-fuel, and gear-speed alerts. The audible priority matches the HUD: missile, terrain, stall, G, speed, fuel, gear. Only the highest-priority warning sounds at a time; it stops when the condition clears.

All effects are generated locally with Web Audio, unlocked by launch/resume gestures and suspended with the simulation. Music and effects mute independently; **muting effects also mutes warning tones**, but never the HUD. Unsupported audio is reported in the panel without blocking flight. These are game cues, not recordings or certified aircraft warning signals.

Aircraft destruction triggers a single synthesized impact, explosion, and debris-rumble tail (2.4 seconds), including terrain impacts, failed landings, and shoot-downs. Engine and alarm audio stop while the crash sound finishes over the results screen. Effects mute/volume also govern crashes; opening a menu/manual or starting another sortie cancels the tail.

## Autopilot

Open **AP** beside the aircraft callsign, or press **H**, to capture heading, MSL altitude, and true airspeed. Edit the three targets in AP settings: heading 000–359°, altitude 1,000–30,000 ft, speed 220–550 kt. Captured targets are clamped to these limits. Heading turns use the shortest direction with a 25° bank limit. The controller applies elevator, aileron, rudder, and throttle through the same 120 Hz physics and actuator lag as manual flight; it never teleports or overrides aircraft attitude/velocity.

**R / Wings Level** rolls level, commands zero vertical speed, and holds captured airspeed instead of heading or altitude. This arrests moderate departures, not inverted/extreme-attitude flight. It remains engaged until disconnected or another mode is selected. **H** disconnects any active mode. Keyboard flight inputs, touch stick/yaw/brake inputs, or manual throttle changes immediately return all axes to manual control. Weapons and camera controls do not disconnect AP. Pause/menu freezes the controller and preserves its mode; a new sortie resets it.

Hold / wings-level engagement requires airborne, non-stalled flight at 175–642 kt, pitch within ±57°, bank within ±149°, fuel available, and at least 150 m (approximately 500 ft) terrain clearance. These modes disconnect below 120 m clearance, on fuel exhaustion, crash/ground contact, or an exceeded flight envelope. A detected stall automatically enters stall recovery instead of disconnecting. Monitor the green AP annunciation and communications messages. Ordinary hold/recovery has no terrain avoidance or combat AI; selected targets may be unattainable in some configurations. The pilot remains responsible for safety.

### Stall recovery

Press **T**, or select **Stall Recovery** in AP settings, to engage directly even while stalled. An already-engaged AP enters this mode automatically when the flight model detects a stall. Recovery prioritizes lowering the magnitude of angle of attack toward a small positive value, leveling the wings, damping sideslip, and commanding full thrust, rather than trying to preserve altitude or the previous heading. This works through the normal aerodynamic controls; altitude loss is expected.

After **three uninterrupted seconds** with no stall, angle of attack below 0.12 rad (~7°), speed above 115 m/s (~224 kt), bank below 0.15 rad (~9°), and sideslip below 0.12 rad, it switches to **wings-level / speed hold**, with a minimum 280 kt speed target. It does not resume a potentially unsafe previous climb/turn. Manual inputs and H always disconnect.

Direct engagement needs at least 30 m (~100 ft) terrain clearance, 45–330 m/s speed, fuel, pitch within ±83°, and bank within ±149°. Once engaged, recovery continues unloading and leveling even if speed falls below 40 m/s or attitude crosses the ordinary autopilot limits; these upset conditions no longer cause it to abandon recovery. It still disconnects below 20 m terrain clearance, above 350 m/s, on ground contact or engine/airframe failure, and for manual overrides. Disconnect messages identify the specific condition. Transition to wings-level hold also requires at least 150 m clearance and pitch within ±57° to avoid immediately tripping that mode's stricter limits. It is not a spin-recovery system or a guarantee against terrain impact; insufficient altitude, extreme attitude, or lost control authority can prevent recovery. Gear and flaps remain pilot-controlled.

For debugger investigations, `npm start -- --port 7450` packages and serves an unoptimized archive with source maps using the current version; attach the JavaScript debugger to the app at port 7451. `npm run build:debug` produces the same kind of archive but increments the build number. Run `npm run build` to create the next production package afterward.

### Automatic takeoff and return-to-base landing

Select **Start on runway**, launch, open **AP**, and choose **Auto Takeoff**. This mode requires a position within 15 m of centerline, heading 000° or 180° within 15°, speed below 45 m/s (~87 kt), at least 1,600 m of runway ahead, and at least 100 kg fuel. It sets gear/flaps down, releases brakes, applies takeoff thrust, steers along centerline, rotates above 78 m/s (~152 kt), climbs, and retracts gear/flaps after positive clearance and sufficient speed. Beyond 300 m terrain clearance and 120 m/s, it captures heading, altitude, and speed into ordinary hold. A lost centerline or inadequate acceleration triggers an abort with idle thrust and brakes. Takeoff is not a taxi/navigation mode: reposition manually or restart if the runway-start checks fail.

While airborne, choose **Return & Land**. It uses the same safe initial engagement envelope as hold, chooses **runway 36** from the north side of the base (`z ≥ 0`) or **18** from the south, and flies offset return/entry fixes before intercepting the extended centerline. Allow several minutes for the circuit; it is not an instant final-approach shortcut. Navigation normally targets about 900 m MSL and 270 kt, reducing to 230 kt during alignment. The final path is a **4.5° descent** over this procedural airbase's hills, slowing to **175 kt**, with automatic gear/flaps, a flare below 30 m over the runway approach, and wheel braking after touchdown. The heading/altitude/speed fields are read-only during automatic departure/landing.

An unaligned final fix, low terrain margin outside the runway, unstable close-in lateral/heading/bank/speed/sink conditions, or an overshot runway triggers a **go-around**. **Go Around** in the AP panel also commands one manually. The controller climbs on runway course, retracts configuration with safe speed/clearance, and rejoins the approach after at least 30 seconds and 450 m terrain clearance. Approach/departure stalls cancel that sequence in favor of stall recovery. Engine loss, aircraft destruction, or an exceeded flight envelope disconnects AP explicitly.

Keyboard/touch flight controls, manual throttle, or gear/flap overrides disconnect automatic flight immediately; weapons do not. H disconnects every mode. Autoland is specific to the existing runway and calm procedural environment, not a general terrain planner or certified landing system. It cannot guarantee a landing after fuel exhaustion, hostile damage, extreme initial states, or insufficient clearance; supervise and override when needed.
