# Bill-ieve It — Congress Tracker

A web app for searching bills before the US Congress, reading their action history, browsing the members who sponsor them, and saving the ones you care about to a personal watchlist.

`React 18` `TypeScript` `Vite` `TanStack Query` `Tailwind` `Recharts` `Firebase Auth` `Cloud Firestore` `Congress.gov API v3`

---

## What it does

The app reads from the **Congress.gov API v3** (`https://api.congress.gov/v3`), the Library of Congress's official legislative data service. You search by keyword, year, status and chamber; you get back a list of bills with their latest summary, a bar chart of how those bills break down by stage, and a detail page per bill showing actions, summaries and cosponsors sorted newest first. Member pages show a legislator's terms and the bills they have sponsored.

Signing in with Firebase Auth (email and password) unlocks a watchlist. Tracked bills, per-bill notes and a per-bill notification flag live in Firestore under `users/{uid}/trackedBills/{billId}`.

## Architecture

```
React 18 + Vite  ──►  TanStack Query cache  ──►  src/lib/api.ts  ──►  api.congress.gov/v3
      │                                              (axios, key on every request)
      │
      └──►  src/lib/firebase.ts  ──►  Firebase Auth  (email/password, local persistence)
                                 └──►  Cloud Firestore
                                         users/{uid}
                                         users/{uid}/trackedBills/{billId}
                                         users/{uid}/preferences/{prefId}
                                         admins/{uid}
```

| Route | Page | Source |
| --- | --- | --- |
| `/` | search, filters, status chart, results | `src/pages/Dashboard.tsx` |
| `/bill/:congress/:type/:number` | actions, summaries, cosponsors | `src/pages/BillDetails.tsx` |
| `/members` | member directory | `src/pages/Members.tsx` |
| `/member/:bioguideId` | terms and sponsored legislation | `src/pages/MemberDetails.tsx` |
| `/dashboard` | tracked bills | `src/pages/UserDashboard.tsx` |
| `/settings` | account and preferences | `src/pages/UserSettings.tsx` |

## The interesting part: the API has no search, so the client became one

Congress.gov exposes bills at `/bill/{congress}/{billType}` — one endpoint per bill type. There are eight types (`HR`, `S`, `HJRES`, `SJRES`, `HCONRES`, `SCONRES`, `HRES`, `SRES`), no cross-type endpoint, and no full-text query parameter. So `getBills()` in `src/lib/api.ts` fans out:

1. Issue eight requests in parallel, one per bill type, sorted by `updateDate desc`.
2. `Promise.all` with a per-request `.catch` so a single 404 or rate-limit does not sink the page — failed responses are filtered out and the rest still render.
3. Merge, then dedupe into a `Map` keyed on `congress-type-number`.
4. Re-sort by `updateDate`, then slice the requested page **client-side**.
5. Issue one more request per visible bill to `/summaries`, again with individual catches, and stitch the results back in by ID.

A twenty-bill page therefore costs roughly 28 HTTP requests. The upside is that partial failure degrades gracefully instead of blanking the page, and search and status filtering work at all. The cost is real and worth stating: filtering happens over whatever those eight requests returned, not over Congress. A keyword that appears only in an older bill will not be found.

The second half of the same problem is that the API returns no normalized status field. `src/components/BillStatistics.tsx` derives one by regex over the concatenation of `status` and `latestAction.text`, bucketing into seven ordered stages — Introduced, Referred, Reported, In Progress, Passed, Failed, Enacted — with `In Progress` as the fallback when nothing matches. Clicking a bar filters the results list to that bucket. It is a heuristic over prose written by clerks, not a parser, and it will mislabel unusual procedural language.

**A bug worth fixing first.** The fan-out sets each request's page size as:

```ts
limit: Math.floor(params.limit || 20 / BILL_TYPES.length)
```

`/` binds tighter than `||`, so this reads as `params.limit || 2.5`. When a limit is passed it is applied in full to each of the eight types instead of being divided among them; when it is not, each type gets 2. The intended expression is `Math.floor((params.limit || 20) / BILL_TYPES.length)`.

## Running it

Prereqs: Node 18+, a Congress.gov API key, and a Firebase project with Email/Password auth and Firestore enabled.

```bash
npm install
```

Create `.env` in the repo root:

```
VITE_CONGRESS_API_KEY=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

`src/lib/api.ts` throws at import time if `VITE_CONGRESS_API_KEY` is missing, so the app will not boot without it.

Then:

```bash
npx vite            # dev server
npm run build       # production build
```

Deploy `firestore.rules` with the Firebase CLI before letting anyone else sign in.

Note that `npm run dev` and `npm start` both invoke `server/index.js`, which is **not in this repository** — use `npx vite` for the frontend.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/lib/api.ts` | all Congress.gov calls — fan-out, dedupe, pagination, summary stitching |
| `src/lib/apiTypes.ts` | `Bill`, `Action`, `Cosponsor`, `Summary`, `Member`, `Term` |
| `src/lib/firebase.ts` | Firebase init, auth persistence, tracked-bill CRUD, admin check |
| `src/lib/firebaseTypes.ts` | Firestore document shapes |
| `src/lib/apiTest.ts` | ad-hoc console script for poking the API by hand |
| `src/components/BillStatistics.tsx` | status derivation and the Recharts bar chart |
| `firestore.rules` | owner-scoped access rules |

## Limitations

- **The server half is missing.** `package.json` depends on Express, Twilio, `node-cron`, `firebase-admin`, Helmet and Morgan, and its `dev`/`start` scripts point at `server/index.js`. No `server/` directory exists here. Whatever was going to send SMS alerts on a schedule is not in this repo, which is why the notification flag on a tracked bill currently sets a field and nothing else.
- **`TrackBillButton.tsx` is a stub.** It toggles a local `useState` and never calls `trackBill()`. The working tracking path is in `src/lib/firebase.ts`.
- **`PhoneNumberModal.tsx` is an empty file** — zero bytes, imported by nothing.
- **The admin check and the security rules disagree.** `firestore.rules` treats a user as admin if `admins/{uid}` exists; `isUserAdmin()` in `firebase.ts` queries the `admins` collection for a document whose `userId` field matches. A document that satisfies one will not necessarily satisfy the other.
- **Firestore rules cover users and admins only.** There is no rule block for any other collection, so anything added later is denied by default — correct, but it means new collections need rules written before they work.
- **No tests, no CI.** Nothing in this repo verifies the fan-out, the dedupe, or the status regex. `src/lib/apiTest.ts` is a manual console script, and it does not currently compile — it imports `getBillActions` and `getBillCosponsors`, neither of which `api.ts` exports.
- The API key is a Vite `VITE_` variable, which means it is compiled into the client bundle and visible to anyone who loads the page. That is acceptable for a demo key on a public dataset and not acceptable for anything with a quota you care about — it is the main reason a small proxy server belongs in front of this.
