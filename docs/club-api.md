# Club REST API

All responses JSON, errors `{message}`. Session cookies sent automatically with same-origin fetch. All mutations require same-origin `Origin` (browser supplies it), or configured `FOOTBALL_PUBLIC_ORIGIN`. No public signup. CLI `FOOTBALL_ADMIN_USERNAME=owner FOOTBALL_ADMIN_PASSWORD='at least 10 chars' node server/bootstrap-admin.mjs` bootstraps first admin only.

- POST `/api/auth/login` `{username,password}` -> session below
- GET `/api/auth/me` -> `{user:{id,username,role:'admin'|'player',playerId:string|null,teamId:number},team:{id,name}}`; 401 logged out
- POST `/api/auth/logout` `{}` -> 204
- PUT `/api/auth/password` `{currentPassword,newPassword}` -> 204, sessions revoked (login again)
- GET `/api/players` -> Player[]
- POST `/api/players` Player fields -> Player (admin)
- PUT `/api/players/:id` partial Player fields -> Player (admin)
- POST `/api/players/:id/account` `{username,password}` -> `{id,username,role,playerId,teamId}` (admin; creates player login)
- PUT `/api/players/:id/password` `{newPassword}` -> 204 (admin; resets password, revokes sessions)
  Player = `{id:string,name,number:number|null,positions:string[],preferredFoot:string,status:'active'|'inactive',note:string,avatar:string|null,hasAccount:boolean}`. Existing legacy string IDs preserved. New IDs generated. No destructive player delete: archive via inactive. Tactical desk and club roster reconcile by stable ID. Club profile edits increment tactical desk edition, so stale desk saves return 409 instead of overwriting newer profiles. Archiving revokes player sessions.

- GET `/api/seasons` -> Season[]
- POST `/api/seasons` `{name,startDate,endDate}` -> Season (admin)
- PUT `/api/seasons/:id` same fields, partial -> Season (admin)
  Season = `{id:number,name,startDate:'YYYY-MM-DD',endDate:'YYYY-MM-DD'}`. Inclusive arbitrary date ranges; overlaps allowed.

- GET `/api/matches` -> Match[] (players see published/completed/cancelled only; admin also drafts)
- POST `/api/matches` Match editable fields -> Match (admin)
- GET `/api/matches/:id` -> Match
- PUT `/api/matches/:id` partial Match editable fields -> Match (admin)
- PUT `/api/matches/:id/rsvp` `{response:'yes'|'no'|'maybe'}` -> Match (own player only; published matches only)
- PUT `/api/matches/:id/roster` `{roster:[{playerId:string,position:string,appeared:boolean|null,goals:number|null,assists:number|null}]}` -> Match (admin, full replacement)
  Match = `{id:number,opponent:string,date:'YYYY-MM-DD',kickoff:string,location:string,status:'draft'|'published'|'completed'|'cancelled',homeScore:number|null,awayScore:number|null,analysis:string,tacticIds:number[],rsvps:[{playerId,response}],roster:[{playerId,position,appeared,goals,assists}]}`. Required create fields opponent/date; other defaults empty, draft, null, []. Only completed matches count in statistics. RSVP never counts as appearance. Goals/assists must be null unless appeared=true. `kickoff` is optional local HH:mm string. Tactic IDs validated against team's tactics. Score accepts null unknown, and explicit 0. homeScore is our team score. Known goals and assists totals may not exceed a known homeScore; both score edits and roster edits validate this.

- GET `/api/statistics?year=2026` or `?seasonId=1` -> `{filter:{startDate,endDate,label},matches:number,matchesWithoutRoster:number,players:[{playerId,name,appearances:number,unknownAppearances:number,unrecordedMatches:number,goals:number|null,assists:number|null,goalsKnownMatches:number,assistsKnownMatches:number}]}`. No filter defaults current calendar year. Only one filter allowed. Sums are sums of known records; null when no known record; coverage fields indicate completeness. Appearance counts require appeared=true. unknownAppearances counts explicit roster rows with appeared=null. matchesWithoutRoster counts completed matches with no roster rows. Each player’s unrecordedMatches counts completed matches without any roster row for that player, including matches with a partial roster. Missing rows are unrecorded, not confirmed nonappearances; an explicit appeared=false row is a confirmed nonappearance. All coverage counts use the same team and inclusive date filter as matches. All players retained in stats including inactive.

Legacy `/api/tactics`, `/api/coaching-desk`, `/api/tactic-collections`, tactic versions retain payload contract; reads authenticated, writes admin only. Legacy board resource belongs to original team; other team identities cannot access it. Club tables all team scoped.

### Tactical roster reconciliation

Desk PUT returns the canonical roster in persisted desk order, followed by active club-only profiles. Clients must adopt the canonical response when no newer local edit is pending. Saving a non-null desk archives player IDs present in the previous canonical roster and explicitly omitted from the new roster, including appended club-only profiles. Before the first board is created there is no previous canonical roster, so pre-existing club profiles are retained and appended. Creating or editing a club profile increments the existing desk edition; an older client that has not received the new roster cannot silently remove it. Archiving revokes sessions but preserves accounts and match history. Explicitly adding an archived ID back to a current-edition desk restores active membership. A null desk resets the board without archiving membership. Desk write, roster synchronization, and archive/session changes commit atomically.
