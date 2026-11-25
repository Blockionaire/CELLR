# ADR-010 — Shared racks: one physical rack, several households, every bottle its own owner

Status: accepted for the foundation (2026-11-23). Builds on ADR-001 (slot identity), ADR-005 (API conventions) and
ADR-008 (conditional moves). Migration `20261204000056_shared_racks.sql`; **not applied to production**, and every
route is closed there (§9).

## 1. The problem

Three CELLR users from three separate households share one office rack of about sixty bottles. Each of them must see
and use the same physical rack while every bottle stays one person's own. Everything in CELLR is scoped to a
household: `bottles`, `cellar_locations` and the rest are readable and writable only by the members of the household
that owns the row (row level security through `private.my_household_ids()`), and `bottles` carries the composite
foreign key `(location_id, household_id) → cellar_locations (id, household_id)`, so a bottle can never stand in a
place of another household. Both stay exactly as they are. A shared rack is therefore **not** a shared household and
not a `cellar_locations` row.

## 2. Decisions

1. **A shared rack is its own entity** (`private.shared_racks`) with the layout vocabulary of a templated place:
   kind, template, slot semantics, rows, columns, cell capacity, appearance, under the same limits as migration 0043.
   The server validates a layout with the domain's `StorageConfigSchema`, and a rack is read through `resolveStorage`,
   so the existing renderer can draw it from a `ResolvedStorage`. A shared rack always has a template (it is new:
   there is no legacy form). Temperature zones are not part of this foundation (§10).
2. **A bottle in a shared rack stays an ordinary `public.bottles` row in its owner's household**, with
   `location_id` null. It stays in that person's cellar, statistics, export and drink flows under the untouched
   household policies. Where it stands in the shared rack is one row of `private.shared_rack_placements`.
3. **One authoritative occupancy model.** `shared_rack_placements` has a unique index on the whole spot
   `(rack_id, loc_row, loc_col, loc_index)` and a unique index on `bottle_id`: no spot holds two bottles and no
   bottle stands on two spots, whatever runs at the same moment. A trigger keeps every placement inside the rack's
   layout; the index is 1 while depth is off (the switch of migration 0043, `private.cellar_settings`).
4. **The tables are in the `private` schema, with row level security on, no policy and no grant to any API role.**
   PostgREST does not expose `private`. Every read and every write goes through a `SECURITY DEFINER` function in
   `public` (empty `search_path`) that takes the person from `auth.uid()` and nothing else, and checks that person's
   **active** membership inside the transaction.
5. **Four identities, four columns, never one standing in for another** (§3).
6. **Nobody passes an identity.** No function takes an actor or an owner as an argument. The owner of a placement
   is the person who placed the bottle, who must be a member of the household the bottle belongs to. There is no
   function that changes a placement's owner.
7. **Cross-household reads are a narrow projection** (§5): what a person standing at the rack sees.
8. **History is append-only and permanent** (`private.shared_rack_events`): no grant to anyone, and a trigger that
   refuses every update, delete and truncate, with one exception that proves itself (§6).
9. **The private cellar and the shared rack cannot disagree.** A trigger on `public.bottles` ends a shared placement
   in the same transaction in which the bottle is given a private place, leaves the cellar (opened, gifted, removed)
   or is deleted, and writes the attributed event. For a bottle that is not in a shared rack it is one index probe
   and nothing else; it takes no lock and cannot fail a private flow.
10. **A gate of its own, closed everywhere but a development server or a preview** (§9).

## 3. The four identities

| Identity               | Where                                                                         | Set by                                            | Can it change?                                |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| Household membership   | `public.household_members` (unchanged)                                        | household RPCs                                    | as today; unrelated to racks                  |
| Rack membership        | `private.shared_rack_members` (per **user**: role, status)                    | accepting an invitation; creating a rack          | role change, leave, removal: by function only |
| Bottle owner (in rack) | `shared_rack_placements.owner_user_id` (+ `owner_name`)                       | the placing call: always `auth.uid()`             | never; a placement ends, it is not re-owned   |
| Bottle creator         | `public.bottles.added_by` (unchanged)                                         | the insert default                                | no                                            |
| Actor                  | `shared_rack_events.actor_id` (+ `actor_name`), `placements.placed_by`        | `auth.uid()` of the call or of the private change | no (append-only)                              |
| Taker / consumer       | the actor of `bottle_taken_out`; of `bottle_opened` (and `bottles.opened_by`) | `auth.uid()`                                      | no                                            |

The owner of a bottle _record_ is still a household (as everywhere in CELLR). The owner _in the rack_ is a person:
the member who put it there. Someone else from that person's household can still act on the bottle through the
household's own cellar (they own the record too). If that person is in the rack, the change is attributed to them
as actor. If they are **not** in the rack, the rack's history names no actor at all: it says that it happened,
whose bottle it was, and `"by": "owners_household"`. People of other households are not told who in someone's
household opened a bottle at home (§14, S1).

## 4. Permissions

A plain member may reorganise the rack and record physical reality; only an owner manages the rack and its people;
nobody changes whose bottle it is.

| Action                                                      | Rack owner                                             | Member | Bottle's household (not a member) | Anyone else |
| ----------------------------------------------------------- | ------------------------------------------------------ | ------ | --------------------------------- | ----------- |
| Read rack, members, bottles (projection), events            | yes                                                    | yes    | no (404)                          | no (404)    |
| Rename, change layout, archive, restore                     | yes                                                    | 403    | 404                               | 404         |
| Invite, cancel an invitation, list the rack's invitations   | yes                                                    | 403    | 404                               | 404         |
| Change a role, remove a member                              | yes                                                    | 403    | 404                               | 404         |
| Leave                                                       | yes, unless the last owner                             | yes    | —                                 | —           |
| Place a bottle of **one's own household** on a free spot    | yes                                                    | yes    | 404                               | 404         |
| Move any bottle to a free spot of the same rack             | yes                                                    | yes    | 404                               | 404         |
| Record "I took this bottle out" (any bottle)                | yes                                                    | yes    | 404                               | 404         |
| Withdraw one's own bottle (end the placement)               | yes                                                    | yes    | **yes**                           | 404         |
| Mark a bottle opened / gifted / removed, edit it, delete it | only its household, through the existing private flows |        |                                   |             |
| Change a placement's owner, act as someone else             | nobody                                                 | nobody | nobody                            | nobody      |

- **Taking a bottle out is not consuming it.** `shared_rack_take_out` ends the placement and writes
  `bottle_taken_out` naming the actor and the owner. The owner's `bottles` row is not touched: status, household and
  every private column stay as they were, and the bottle shows in the owner's cellar without a place. The owner
  decides what happened to it, through their own flows.
- Anything the caller is not an active member of is **404, never 403**: an id says nothing about what exists.
- An **archived** rack is read-only except for taking bottles out, withdrawing, leaving and removing members.

## 5. The projection: what is shared and what is not

`shared_rack_bottles(rack)` returns, per placement: the placement id, the whole spot, the owner (user id, display
name, whether still a member), whether it is the caller's, who placed it and when, and of the wine: producer, name,
vintage year, type (colour), region, country code and bottle format.

Members see each other's display name and account name (`@name`), nothing else of a profile.

Deliberately **not** shared, by not being selected anywhere: purchase price, currency, where and when it was bought,
notes, ratings and tastings, drink windows and valuations, the household id, the private location, label photos, the
ids of the wine and vintage, and anything about a bottle that is not in this rack. The **bottle id** is returned only
to members of the bottle's own household; everyone else addresses a bottle by its **placement id**, a handle that
exists only inside the rack.

A wine someone entered themselves is private to their household in the catalogue; its name and producer are shown
to the other members for the bottles that person put in the rack, and for nothing else. That is the label on a
bottle they can pick up. Label photos are household files behind household-scoped storage policies; serving them
across households needs its own decision and is left out (§10).

## 6. History

`private.shared_rack_events`: `seq` (identity; the order and the paging cursor), rack, type, `occurred_at`
(`clock_timestamp()`), actor, bottle owner, subject (for membership events), placement id, bottle id, from and to
spot, and **snapshots**: the actor's, owner's and subject's display names, the wine as it read then, and a small
`detail` object (a reason, a new role, a new name).

Types: `rack_created`, `rack_renamed`, `rack_layout_changed`, `rack_archived`, `rack_restored`, `member_joined`,
`member_left`, `member_removed`, `member_role_changed`, `bottle_placed`, `bottle_moved`, `bottle_taken_out` (a member,
through the rack), `bottle_withdrawn` (the owner's side, without the rack), and from the owner's private cellar:
`bottle_relocated` (given a private place), `bottle_opened`, `bottle_gifted`, `bottle_removed` (status removed, or the
record deleted: `detail.reason`). Invitations are not events: the invitation rows are their own record, and a
decline is nobody else's business.

**Append-only**: no role has any privilege on the table, and a trigger refuses UPDATE, DELETE and TRUNCATE for every
role, the table's owner included. The one exception: `actor_id`, `owner_id` and `subject_id` reference `auth.users`
with `ON DELETE SET NULL`, so that **history never blocks deleting an account**. The trigger lets exactly that
through and nothing else: an update that changes only those columns, only to NULL, and only when the referenced
account no longer exists. The name snapshots stay (open decision 3).

A rack is never deleted (it is archived), so its history has no cascade to fall to.

## 7. Lifecycles

**Invitation.** An owner invites an existing user by user id; the id comes from the existing exact-match search
(`find_person`: an exact account name or friend code, rate limited). No new lookup exists, and inviting is not tied
to being friends (a friendship shares ratings by default; colleagues sharing a rack should not have to). `pending` →
`accepted` | `declined` | `cancelled`; a pending invitation past `expires_at` (14 days) is expired and can no longer
be accepted. One pending invitation per rack and person. After a decline that person is not asked again for 7
days: not for that rack by anyone, and not by the same inviter for any rack. One person has at most three open
invitations to another, over all racks (§14, S4). Before accepting, the invited person sees the rack's name and who invited them, nothing else.

**Membership.** `active` → `left` (own choice) | `removed` (by an owner). Either ends all access at once: the next
call, including one from a client that still shows the rack, is answered 404. A former member can be invited again.
Pending invitations issued by someone who stops being an owner are cancelled. Archiving a rack cancels its open invitations.

- **The last owner cannot leave.** They hand the role over explicitly (promote someone, then leave) or archive the
  rack. A role change that would leave no owner is refused. Nothing is ever transferred silently.
- **Leaving or being removed does not move bottles.** They stay that person's bottles in their own household. Their
  placements stay as physical facts, shown to the remaining members with the former member's name, until someone
  records taking them out, or the owner ends them from their own side: by `shared_rack_withdraw_bottle`, or simply by
  using the bottle in their own cellar (§2.9). No bottle is orphaned, none changes owner.
- **Account deletion.** The membership rows go with the account (a `member_removed` event with reason
  `account_deleted` is written from the name kept on the row). If the account was the last owner, the rack is
  **archived** in the same transaction (`rack_archived`, reason `owner_account_deleted`), whether or not other
  members remain: those who remain keep reading it and can take their bottles out, nobody is made owner behind their
  back, and a rack nobody is left in does not stay looking as if it were in use. Bottles of
  households that are deleted with the account end their placements through the bottle trigger. Deleting an account
  is never blocked by a shared rack.

**Placement.** `placed` → (`moved`)\* → ended by exactly one of: `taken_out`, `withdrawn`, `relocated`, `opened`,
`gifted`, `removed`. A placement row exists exactly while the bottle stands in the rack.

## 8. Threat model

The attacker is a signed-in user who calls PostgREST directly with their own token, and knows any id they like.

| Attack                                                          | What stops it                                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading or writing the new tables directly                      | `private` schema (not exposed), RLS without policy, no grant.                                                                                                                          |
| A non-member calling any function with a known rack id          | Every function checks active membership first; reads return nothing, writes answer `not_found`. Same answer as for an id that does not exist.                                          |
| A member reading another member's private cellar                | No existing policy, grant or function is changed. The projection selects named columns of bottles **that have a placement in this rack**, and nothing else joins to another household. |
| Placing a bottle one does not own (forged ownership)            | `shared_rack_place` requires the caller to be a member of the bottle's household; the owner is `auth.uid()`, not an argument.                                                          |
| Forging the actor or the owner                                  | No such parameters exist. PostgREST refuses unknown arguments.                                                                                                                         |
| Changing a bottle's owner, status or household through the rack | No function writes those. The only write to `bottles` is taking the caller's **own** bottle off its private place when it is put into the rack.                                        |
| A removed member's stale client or in-flight mutation           | Every write locks the rack row, then reads the caller's member row `FOR SHARE` requiring `active`. A removal holds the rack lock: a mutation either committed before it or is refused. |
| Two people on one spot; a move against a take-out               | All writes to one rack are serial (the rack row lock); a move and a take-out are conditional on the spot the caller saw (`stale`). The unique indexes are the backstop.                |
| Rewriting or deleting history                                   | No privilege, and the append-only trigger, for every role.                                                                                                                             |
| Accepting an invitation twice, or someone else's                | The invitation is re-read under the rack lock; only its addressee, only while pending and not expired.                                                                                 |
| Enumerating users through invitations                           | Invitations take a user id only (unguessable); the exact-match search is the existing rate-limited one; invitations are rate limited and capped per rack.                              |
| Flooding the permanent history                                  | A per-person write budget inside the database (`shared_rack_write`), a cap on racks, members and pending invitations.                                                                  |
| A malicious member taking out or moving everyone's bottles      | Allowed on purpose (the physical rack allows it too). It never changes anyone's bottle record, and it is attributed permanently. An owner removes the member.                          |
| Injecting SQL or hijacking a definer function                   | Static SQL only, `search_path = ''`, every object schema-qualified.                                                                                                                    |

Not defended here, by design: a member lying about physical reality (recording a take-out that did not happen); the
service role and the database owner (operators), who are trusted as everywhere in CELLR.

## 9. Rollout

- **The gate** `CELLR_SHARED_RACKS` (`lib/shared-racks-gate.ts`), read on the server only. Open only when it is
  exactly `1` **and** the deployment is `next dev` or a Vercel preview. Writes need, in addition, a database known
  not to be production (`lib/smart-cellar-write-target.ts`: loopback, or the declared test host). On a production
  deployment, and on any build that cannot be told, every route answers 404, whatever is set. Independent of the
  Smart Cellar gates.
- **Production is not authorised.** There is no code path that opens the gate on production. When the owner
  approves, the change is a reviewed pull request that adds one explicit clause in the style of
  `lib/smart-cellar-release.ts` (a Vercel production deployment that declares, exactly, the production database it
  connects to), plus applying the migration by `docs/MIGRATIONS.md` §2. Neither is part of this work.
- **The migration is additive**: new tables in `private`, new functions, one new trigger on `public.bottles` (a no-op
  for every bottle that exists). No existing table, policy, grant, constraint or function changes.
- **Rollback is the gate.** With `CELLR_SHARED_RACKS` unset the routes are 404 and nobody can create a rack; with no
  placement rows the trigger does nothing. The data stays. Removing the objects is spelled out in the migration's
  header and is only for a database where no rack was ever used.

## 10. Not in this foundation

- (Screens came in the second run: `SHARED-RACKS-REPORT.md` §9, and §13 below.)
- No temperature zones for a shared rack; no depth (cell capacity above 1 is refused while the switch is off).
  The switch is a kill switch for a rack that is already deep as well: with it off, `shared_rack_place` and
  `shared_rack_move` answer `depth_not_enabled` for any index above 1 and write nothing, and a layout cannot be
  made deep or deeper. The way out stays open: a bottle at the back still moves to an index-1 spot and is still
  taken out or withdrawn. A stored depth is left as it is (changing it would need the bottles moved first).
- No swap of two bottles in one step (two moves through a free spot do it).
- No label photos across households, no shared art by wine id.
- No push notifications for invitations or activity.
- The export does not yet say that a bottle stands in a shared rack (it is exported as a bottle without a place),
  and rack history is not part of a personal export.

## 11. Alternatives rejected

| Alternative                                                                  | Why not                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A shared **household** for the rack                                          | Bottles would be owned by the group, visible with price and notes, counted in nobody's own cellar; leaving would orphan them. The opposite of the requirement.                                          |
| A `cellar_locations` row readable by several households                      | Needs the composite foreign key gone and the household policies on `bottles` and `cellar_locations` widened: the global weakening that is ruled out.                                                    |
| Copies of each bottle in a rack-owned table                                  | Two records of one bottle that drift apart; consuming it at home would leave a ghost in the rack.                                                                                                       |
| Public tables with member `SELECT` policies                                  | Two authorisation layers (policies and functions) to keep in step; the convention that the service role has every privilege on public tables contradicts an append-only log; more exposed surface.      |
| Ownership as a parameter ("this is Bob's bottle")                            | Forgeable by construction. The owner is whoever placed it, and must own the record.                                                                                                                     |
| Requiring friendship to invite                                               | Couples a rack to sharing ratings and taste. The same exact-match search is reused without the friendship.                                                                                              |
| Ending a member's placements automatically when they leave                   | Would record something that did not physically happen. The bottles are still in the rack.                                                                                                               |
| Transferring the rack to the oldest member when the last owner disappears    | A silent transfer of control. Archiving changes nobody's rights upward.                                                                                                                                 |
| Blocking account deletion while someone is the last owner (as households do) | Possible, and friendlier to the others, but it needs the account screen to explain it; left as open decision 2. The database never blocks.                                                              |
| One optimistic `UPDATE` per move without a rack lock                         | Works for one bottle, but a removal racing a mutation, and layout changes racing placements, each need their own reasoning. One lock per rack makes every interleaving serial; a rack is a small thing. |

## 12. Open decisions for the owner

1. **Who may record taking out someone else's bottle?** Built: any member. Alternative: only the owner of the bottle
   and rack owners.
2. **Last owner deletes their account.** Built: the rack is archived. Alternatives: refuse the deletion until they
   hand over (as households do), or let a remaining member claim the rack explicitly.
3. **Names in history after an account is deleted (right to erasure).** Built: the reference to the account is
   cleared, but the display name as it read then stays in the history's snapshots (`actor_name`, `owner_name`,
   `subject_name`) and stays visible to the rack's members. That is personal data kept after the account is gone.
   Alternative: clear the names too when the account is deleted (the history then says "someone"); the append-only
   trigger would need one more proven exception for it. The owner decides, with whoever advises on privacy.
4. **Label photos in a shared rack**: never, opt-in per bottle, or always for members.
5. **Who may invite**: owners only (built), or every member.
6. **What a new member sees of history**: everything (built), or only from the day they joined.
7. **Limits**: 12 members and 20 pending invitations per rack, 20 racks per person, 14 days to accept.
8. **Production release**: when, and with which declaration (§9).

## 13. What the screens settled (second run)

- **Where a shared rack lives in the product**: in the cellar's 3D view, as one more place in the row of places,
  marked as shared in words. Not a separate area of the app: it is a rack one walks up to like one's own.
- **What a member sees of another's bottle** stayed exactly the projection of §5. The panel adds nothing: wine,
  vintage, kind, format, owner, who placed it and when. No photo.
- **The owner filter never moves or hides a fact**: it is local to the screen, a spot stays taken whatever the
  filter shows, and the flat grid says of a dimmed bottle that it is still in the rack.
- **Taking out is said to be what it is before it is recorded** (open decision 1 stays as built: any member may
  record it). The follow-up for one's own bottle is one's own cellar's flows, offered after, never merged into it.
- **The last-owner rule is explained before the request**: the Leave button is not offered to the last owner; the
  sentence in its place says what to do instead.
- **A removed member's screen shows nothing of the rack** once the server says so, not even what it had loaded.
- **Open decision 4 (label photos) stays open**: the screens draw labels from names.

## 14. After the independent security review

The review (red-team suite `supabase/tests/99_shared_racks_redteam.test.sql`, kept in the repository) found no
blocker. These were changed in migration 0056 itself (it is applied nowhere):

- **S1 Who is named in the history.** The trigger on `bottles` and `shared_rack_withdraw_bottle` wrote `auth.uid()`
  as the actor, also for someone of the owner's household who never joined the rack. Now the actor is recorded only
  when that person is an active member of the rack; otherwise `actor_id` and `actor_name` are null and
  `detail.by = "owners_household"`. The owner's name stays. A former member withdrawing their own bottle is such a
  case too: the history says it was withdrawn by the owner's household.
- **S4 Invitations nobody asked for.** Anyone who learns a user id through the exact search could put a rack name
  and their own name in that person's list. **Decision (owner-reversible): being friends stays NOT required.** A
  friendship in this app shares one's ratings, taste and (when chosen) cellar with the friend; requiring it would
  make colleagues who share a rack expose their own cellars to each other, the opposite of what a shared rack is
  for. Instead: a decline quiets that inviter for a week for all their racks (not only the rack declined), one
  person has at most three open invitations to another, and the hourly budget (30) stays. The alternative, friends
  only, is one condition in `shared_rack_invite` if the owner prefers it.
- **S3 A private action can wait for a rack call.** Contract: a household's own action on a bottle that stands in
  a shared rack (opening it, giving it a place, deleting it) can wait for **at most one** shared-rack call that is
  working on that same bottle at that moment; it is never refused and never deadlocks. Through the API each call is
  one short transaction. A bottle that is not in a shared rack never waits. The locking was not changed (no `nowait`
  in a private flow: that would turn a wait into an error); the concurrency script pins the contract with a rack
  call held open.
- **N1** The history's bottle-id filter answers only for the caller's own household's bottles (anyone else's bottle
  is followed by its placement id), so a row count cannot say whether a foreign bottle was ever in the rack.
- **N2** A rack whose last owner's account is deleted is archived also when nobody else is in it.
- **N6** The cap of 20 racks per person holds on accepting an invitation too (`too_many_racks`; the invitation
  stays open).
- **S2** (on the screens branch) A bottle of mine in a shared rack has no place in my own cellar, so my cellar
  offers it "without a place". The database rule stays as it is: giving it a place at home ends its stay in the
  shared rack, in the same transaction, and the rack's history says so (`bottle_relocated`). What changed is that
  the screens say where the bottle stands and ask before doing it. Rejected: refusing the placement at home in the
  database until the bottle is taken out of the rack first; the owner's own cellar would then depend on a rack they
  may no longer be a member of.
- **Depth kill switch** (from the review of the depth backend): the private trigger covers `public.bottles` only,
  so a shared rack made deep while depth was on would have kept accepting an index above 1 after the switch went
  off. Placing and moving now ask the switch themselves (§10).
