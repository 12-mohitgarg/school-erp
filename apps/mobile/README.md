# EduSphere Mobile — Parent · Student · Driver

The three mobile apps the PRD specifies (§2.5 Parent App, §2.4 Student Panel,
§2.8 Bus Driver App), built with **Expo / React Native** against the same ERP
core the web portal uses. No new endpoints, no second source of truth — the API
was already mobile-ready (`push.channel.ts` targets Expo, `/auth/refresh`
accepts a body token "for mobile clients", `/tracking/location/batch` exists for
the driver's offline queue).

```bash
# from the repo root
npm install
npm run build --workspace=@erp/shared

# Terminal 1 — API on :4000
npm run dev:api

# Terminal 2 — Metro
npm run dev:mobile
```

Then press `a` for Android or `i` for iOS, or scan the QR with a development
build. Password for every demo account is `Password@123`:

| App | Email |
|---|---|
| **Parent** | `parent.1a@example.com` |
| **Student** | `student@dpsdelhi.edu.in` |
| **Driver** | `driver@dpsdelhi.edu.in` |

A staff account signs in successfully and is then told, plainly, that their role
belongs on the web portal — `ROLE_SURFACE` in `@erp/shared` already records
which surface each role is designed for, so this is not a second opinion.

> **Expo Go will not work.** MapLibre and background location are native
> modules, so the app needs a development build. You need one **once**; after
> that the normal fast-refresh workflow applies.

### Getting a development build

`npx expo run:android` compiles locally, so it needs a JDK and the Android SDK.
Two scripts set that up with **no administrator rights and no Android Studio** —
everything lands in `%LOCALAPPDATA%`:

```powershell
cd apps\mobile

# JDK 17 + Android SDK 36 + platform-tools  (~400 MB, one-off)
powershell -ExecutionPolicy Bypass -File scripts\setup-android.ps1

# Only if you have no physical phone  (~1.5 GB, one-off)
powershell -ExecutionPolicy Bypass -File scripts\create-emulator.ps1
```

Both are safe to re-run; each step is skipped if already in place. The versions
are not arbitrary — the generated project pins Gradle 9.3.1 and
`compileSdkVersion 36`, which forces JDK 17 and SDK 36.

**Then open a new terminal** so the persisted `JAVA_HOME` / `ANDROID_HOME` are
in scope, and run `npx expo run:android`.

#### Or build in the cloud instead

If you would rather not install a local toolchain at all:

```bash
npx eas login                 # free Expo account
npx eas init                  # writes EAS_PROJECT_ID, also enables push tokens
npx eas build --profile development --platform android
```

Install the resulting APK on a phone, then run the API and Metro on your
machine with the phone on the **same Wi-Fi**. `src/config/env.ts` rewrites
`localhost` to the LAN address Metro served the bundle from, so there is
nothing to configure per device.

Two things that bite on a physical device:

- **Windows Firewall** blocks inbound connections to port 4000 by default. Allow
  Node through it, or the phone will sit on "No connection".
- If the machine has **several network adapters** (Hyper-V, VirtualBox, Docker),
  Metro sometimes advertises the wrong one. Force it:
  `$env:EXPO_PACKAGER_HOSTNAME="192.168.1.x"; npm start`

The API listens on all interfaces already (`httpServer.listen(PORT)` with no
host argument), so nothing needs changing server-side.

> `npm run dev:mobile` is a **root** script. From inside `apps/mobile` the
> equivalent is `npm start` — though `npm run dev` and `npm run dev:mobile` are
> aliased here too, so either directory works.

---

## One codebase, three products

The PRD names three apps. This is one Expo project that ships three
experiences, selected by role at sign-in, with **no shared screens between
roles that should not share them** — a driver's tree contains no fee screen at
all, and TypeScript enforces it: each role has its own navigation param list, so
`navigate('Fees')` does not compile inside the driver app.

```
apps/mobile/
  app.config.ts          APP_VARIANT=parent|student|driver|all
  src/
    config/env.ts        API URL, socket path, GPS cadence
    core/
      api/               client (refresh queue) · endpoints · types · queryClient
      auth/              secure session · AuthProvider
      realtime/          socket.io + authorised room subscriptions
      offline/           durable write queue · connectivity
      push/              Expo push registration, emergency channel
      storage/           direct-to-Cloudinary upload
      utils/             format · geo (polyline codec, bounds)
    design/              tokens · ThemeProvider · 14 components
    features/            shared: map, auth, chat, fees, homework, results,
                         attendance, library, timetable, calendar, sos, account
    apps/
      parent/            home · live tracking · trip history
      student/           home
      driver/            trip control · manifest · GPS broadcast
    navigation/          root · per-role param lists · chrome
```

### Shipping separate binaries

`APP_VARIANT` changes the bundle id, the display name, the accent colour and —
the part that matters — **which native permissions the binary declares**:

```bash
npx eas build --profile production-parent   # io.edusphere.parent
npx eas build --profile production-student  # io.edusphere.student
npx eas build --profile production-driver   # io.edusphere.driver
```

A parent's phone should never ship a background-location entitlement it has no
use for, and app stores reject binaries that ask for more than they
demonstrably need. Verified:

```
driver: EduSphere Driver | io.edusphere.driver | bg-location: True
parent: EduSphere Parent | io.edusphere.parent | bg-location: False
```

The default `all` variant serves every role from one binary, which is what you
want in development and for a single store listing.

---

## Live GPS: how the Parent App stays honest

```
Driver app ──every 12s──▶ POST /tracking/location/update ──▶ geofence · ETA · alerts
     │                              │                              │
     └─ no signal? ──▶ disk queue   └─ socket fan-out ─────────────┴──▶ Parent app
        flushed as one batch            vehicle:{id} room only
        in chronological order
```

Three things this screen is careful about, because each one is how a tracking
feature loses a parent's trust:

1. **It says whether it is actually live.** A map that has silently stopped
   updating looks identical to a bus that has stopped moving. The connection
   state *and* the age of the last ping are on screen at all times; past 90
   seconds it says "the tracker has gone quiet" rather than showing a stale
   position as current.

2. **It degrades rather than lies.** The socket is the fast path; a 30-second
   REST poll runs underneath as a fallback — the same belt-and-braces the web
   app uses.

3. **It respects the privacy boundary.** A guardian may only join the room for
   the vehicle currently carrying their child (PRD §6.3, enforced in
   `socket.ts`), and a non-custodial guardian is shown an explanation instead of
   an unexplained 403.

The screen also states, in plain words, who can see the location, how long it is
kept, and that every view is audited — at the point of consent, not in a policy
document.

---

## Offline mode (PRD gap: "Offline mode for Driver & Teacher apps")

Rural routes lose signal for minutes at a time. Two kinds of work are queued to
disk, and they are queued differently because they fail differently:

| Queued | Why | Flush |
|---|---|---|
| **Position pings** | High volume, individually worthless — what matters is the shape of the journey | Batched to `/tracking/location/batch`, replayed in chronological order so geofence transitions still fire in sequence |
| **Boarding events** | Low volume, each one matters — "did my child get on the bus" is the question the feature exists to answer | One at a time; the server upserts on `(tripId, studentId, event)` so a retry is idempotent |

The queue is written on every change, not on a timer, so it survives a
force-quit — a driver whose phone dies at the far end of a route still delivers
the trip once it charges. Capped at 3,000 pings (a full school day at 12s
intervals) with the *oldest* dropped first, because a recent position is worth
more than an ancient one and an unbounded queue eventually fails to write at
all.

The driver's trip screen shows the pending count and a **Sync now** button.
Queued work is never silent.

---

## SOS

PRD §6.1 asks for a one-tap SOS. A single unguarded tap on a phone in a
driver's pocket would fire false alarms all day, and a service whose alerts are
usually false is a service nobody responds to. The resolution is a **press and
hold**: still one gesture, no dialog to read, impossible to trigger by accident.
The ring fills over 1.5 seconds with escalating haptics; releasing early
cancels.

Position is captured at the moment of trigger — cached fix first, since a
high-accuracy lock can take 20 seconds under a bus roof. If no fix is available
the alert still goes out. An alert with a poor position beats no alert.

---

## Two things worth knowing about the API

Both were found while wiring these screens. Neither is fixed here — they are
server changes, and this is a client — but both changed what the apps do.

**`GET /tracking/alerts` is not scoped by data scope.** It filters on
`tenantId` alone, so a PARENT token (which holds `tracking:view`) would be
served every safety alert for every bus in the school, not just the one
carrying their child. That is wider than PRD §6.3 allows. None of these apps
calls it for a guardian; they use the per-user notification inbox, which is
correctly scoped. The endpoint is defined in `core/api/endpoints.ts` with a
warning comment so it is not wired up by accident.

**Route-deviation and over-speed alerts never reach the driver's inbox.**
`raiseSafetyAlert` emits `safety:alert` over the socket but does not call
`notify()`, so no push and no notification row is created — yet PRD §2.8 says
the driver *"receives alerts for route deviation and speed-limit violations"*.
The driver app therefore listens on the socket directly and shows the warning
on the trip screen, filtered to their own vehicle (the server also broadcasts
to the whole tenant, which would otherwise warn every driver about every bus).
If a driver's phone is asleep they will still miss it — that needs the server
to add a `notify()` call.

---

## Design

The tokens in `src/design/tokens.ts` are the **same values** as
`apps/web/src/styles/globals.css`, converted from Tailwind's `r g b` triples to
hex. A parent who checks the fee balance on the web portal and then on their
phone is looking at one product, not two that share a logo.

Both themes define every colour — nothing is declared only inside the dark
block, which is how a screen ends up with black text on a black card at 9pm.
Dark is built from a navy base, not black: pure black surfaces make elevation
impossible to read.

**Every waiting screen shows the shape of what is coming — never a spinner,
never the word "Loading…".** Carried over from the web app, and the reason
nothing shifts when data lands.

---

## Technology

| Concern | Choice | Why |
|---|---|---|
| Runtime | Expo SDK 57 (RN 0.86, React 19) | The API's push channel already targets Expo's service |
| Navigation | React Navigation 7 | Per-role param lists give compile-time route safety |
| Data | TanStack Query | Retries only on transient errors; a 403 is not retried three times |
| Maps | MapLibre + OSM raster tiles | No API key, matching the web app's Leaflet choice |
| State | React Context (auth, theme, socket, network) | Nothing here needs Redux |
| Storage | `expo-secure-store` for tokens, AsyncStorage for cache | Tokens never touch JavaScript-readable storage |
| Animation | RN `Animated` + `LayoutAnimation` | Native-driver where it counts; one fewer native module than Reanimated |
| Files | Direct-to-Cloudinary | Same as web — no binary transits the API |

### Deviations, and why

- **MapLibre rather than the Google Maps SDK.** PRD §8.1 names Google Maps
  Platform. MapLibre with OSM tiles needs no API key, so the map renders on a
  fresh checkout with nothing provisioned. Routes are already stored as
  Google-encoded polylines and `GOOGLE_MAPS_API_KEY` is wired server-side, so
  swapping is a change to `features/map/` and nothing above it.
  ⚠️ **Before go-live**, point `TILE_SOURCES` in `features/map/mapStyle.ts` at
  your own tile server — openstreetmap.org's tiles are a volunteer resource with
  a usage policy that forbids heavy apps. It is the only file that names a tile
  URL.
- **No Reanimated.** RN's `Animated` with the native driver covers every
  animation here, and skipping it removes a native module and its worklets
  toolchain from the build.
- **Payment hands off to a gateway page.** PARENT holds `fees:view` and
  deliberately *not* `fees:create` — that would also authorise recording
  arbitrary payments, issuing refunds and granting concessions. So the "Pay now"
  button hands off rather than pretending to settle. Wire the school's
  Razorpay / Stripe / PayU checkout URL into `openCheckout` in
  `features/fees/FeesScreen.tsx` when the gateway is provisioned.

---

## Verified

`npx tsc --noEmit` and `npx eslint apps/mobile/src` both pass clean, and the app
bundles for **both platforms**:

```
› android bundles (1): index-…hbc (3.9MB)
› ios bundles (1):     index-…hbc (3.9MB)
```

`npx expo-doctor` passes 20 of 21 checks. The one failure is expected and
benign: the repo contains two Reacts, 18 for the web app and 19 for this one.
`metro.config.js` pins React and React Native to this workspace's copies
explicitly, so the resolution cannot go wrong regardless of hoisting order.

Not yet done: no automated test suite, and no run against a physical device or
a live GPS trip — both need a development build and a school's real data.

---

## Configuration

Nothing here is a secret; every privileged operation is authorised server-side
against the bearer token.

```bash
EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1
EXPO_PUBLIC_WS_URL=http://localhost:4000
EXPO_PUBLIC_WS_PATH=/socket.io
EAS_PROJECT_ID=…      # required only to mint push tokens on a real build
```

In development `localhost` is rewritten automatically — to the LAN address Expo
served the bundle from, or `10.0.2.2` on the Android emulator. No file to edit
per machine.

Push notifications need `EAS_PROJECT_ID`; without it the app runs normally and
falls back to the in-app inbox, which the server treats as always-delivered
anyway.
