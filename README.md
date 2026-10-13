# PF2e Narrative Assistant

Foundry VTT v14 module for the Pathfinder 2e system. After a meaningful PF2e roll, it whispers the GM
a short narration idea, in English or French:

```text
🎭 Inspiration — Critical Hit · Longsword
The blade slips under the guard of the kobold and opens a long gash across the shoulder.
[Another suggestion] [Send to chat]
```

- Read-only: it never changes rolls, damage, conditions or degrees of success.
- No LLM, no network: narration comes from RollTables shipped in the module compendiums, one per
  language (302 tables and ~2400 entries each, written separately in English and French rather than
  translated).
- *Another suggestion* draws another text, never another PF2e roll. *Send to chat* posts the text
  alone, publicly. Each line also has a ↰ button that scrolls the chat to the PF2e roll it narrates,
  and a 🚫 button that hides that text for good in this world and draws another
  (`game.modules.get("pf2e-narrative-assistant").api.unbanAll()` brings them all back).
- Saves against the same spell or effect that arrive within a couple of seconds share one card, one
  line per creature, instead of one card per creature.
- In a started combat, a creature dropping to 0 HP gets a finishing-blow card naming whoever dealt the
  last hit (a PC gets a "collapse" text, never a death).
- Strikes notice the scene: a target below half or a quarter of its HP, three hits or misses in a row,
  a critical right after a fumble.
- Every PF2e roll the module understands gets a 🎭 icon in its chat header, for the GM: click it to get a
  narration for that roll, even if the chance setting skipped it or its event family is off.
- A PC who loses Dying while above 0 HP (healed, whether the GM or a healing automation module removes
  the condition) gets a "back on their feet" card; starting and ending a combat each get a scene-setting
  line.

## Supported events

| Event | Specialisations |
|---|---|
| Strikes, melee | generic, slashing, piercing, bludgeoning, unarmed, shield bash, agile/finesse weapons; body part by target type |
| Strikes, ranged | generic, piercing (bows, crossbows), thrown weapons, firearms |
| Strikes, by target | undead, constructs, swarms, incorporeal creatures |
| Strikes, by condition | target prone, frightened, grabbed/restrained; attacker frightened or sickened |
| Strikes, by situation | target bloodied (≤ 50% HP) or near collapse (≤ 25%); 3 hits / 3 misses in a row; crit after a fumble |
| Finishing blows | NPC (melee, ranged, magic; undead, construct, swarm, incorporeal), player character |
| Back from 0 HP | a PC losing Dying while above 0 HP |
| Combat | start, end |
| Spell attacks | by tradition (arcane, divine, occult, primal) and damage (fire, cold, electricity, acid, force, void) |
| Spell casts without attack or save | by tradition, healing |
| Athletics | Trip, Grapple, Shove, Disarm, Escape, Reposition, Force Open, Climb, Swim |
| Acrobatics | Tumble Through (success / failure, as in the Remaster rules) |
| Deception, Diplomacy, Intimidation, Performance | Feint, Create a Diversion, Lie, Request, Demoralize, Perform |
| Stealth, Perception, Thievery | Hide, Sneak, Seek, Steal, Palm an Object, Disable a Device |
| Medicine | Treat Wounds, Administer First Aid |
| Recall Knowledge | GM prompts on how to deliver the information, never invented facts |
| Saving throws | Reflex (fire, cold, electricity, acid), Fortitude (poison, disease, physical, void, vitality), Will (fear, mental) |
| Recovery checks | four degrees |
| Persistent damage flat checks | fire, bleed, acid, poison, other (ends / goes on) |
| Anything else | generic fallback per degree (other skill actions, and misc rolls if enabled) |

## Compatibility

- **PF2e Toolbelt**: saves rolled from its target helper (on the spell card, without chat messages) are
  narrated like any other save, grouped per spell. A player's save is forwarded to the active GM.
- **Dice So Nice**: public narration waits for the dice animation.
- Translated compendiums (Babele, pf2-fr) and renamed tokens work: the module uses item and token names.

## Settings

Enable, output (GM whisper / panel above the chat / public chat / notification), narration language (UI language / English /
French; English when the UI language has no corpus), narrative source (module / world tables), event
families, a chance per degree of success (e.g. 100% of criticals but 30% of plain successes, to keep
long fights readable), the save grouping delay (0 turns it off), and a list of disabled action slugs
(`seek, hide, recall-knowledge`…). Narration about a secret roll or a Recall Knowledge prompt is never
public.

The *panel* output keeps the chat clean: the last three cards sit at the top of the chat sidebar on the
GM's screen, with the same buttons (another suggestion, send to chat, ↰, 🚫) and a close button. Nothing
is written to the chat until *Send to chat*. The panel lives on the client that narrates (the active GM)
and is emptied by a reload.

## Development

```sh
npm install
npm test          # engine, extraction, Foundry glue (faked), corpus lint
npm run build     # src/data → packs/narration-<lang> (LevelDB, via @foundryvtt/foundryvtt-cli)
```

Symlink the repository into `Data/modules/pf2e-narrative-assistant` and run `npm run build` once.
`packs/` is generated, never edited by hand nor committed; table and result IDs are derived from table
keys, so rebuilds are reproducible.

`.github/workflows/pf2e-watch.yml` runs `tools/check-pf2e.mjs` every week against the latest PF2e
release: it fails when PF2e stops writing one of the chat flags or roll options this module reads.

Releases: publish a GitHub release tagged `vX.Y.Z`. `.github/workflows/release.yml` tests, builds the
compendiums, stamps `version`, `url`, `manifest` and `download` into `module.json`, and attaches
`module.json` and `module.zip` to the release. Install URL for Foundry:
`https://github.com/<owner>/<repo>/releases/latest/download/module.json`.

## How a narration is chosen

Every compendium table carries a key and a `when` condition (event, action, save, range, damage type,
traits, creature type, conditions, degree…), defined once in `src/data/rules.json` for all languages.
The most specific matching table wins, so missing specialisations fall back by themselves:
`strike.melee.slashing.success` → `strike.melee.success` → `generic.success`.
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Adding or changing narration

Edit or add JSON files in `src/data/narration/<lang>/`, following [docs/WRITING.md](docs/WRITING.md),
then `npm test && npm run build`. A new category is one rule plus one file per language:

```json
// src/data/rules.json
{ "key": "skill.athletics.reposition", "when": { "eventType": "skill-check", "actionSlug": "reposition" } }

// src/data/narration/en/skills/athletics/reposition.json (same key in fr/)
{ "key": "skill.athletics.reposition", "label": ["Skills", "Athletics", "Reposition"],
  "outcomes": { "success": ["…"], "failure": ["…"] } }
```

A new language is a folder under `src/data/narration/`, an entry in `src/languages.mjs` (fallback words,
grammar fix-ups) and a pack in `module.json`; the tests require every rule to have text in every language.

GMs can also customise in Foundry: import a table from the compendium into the world, edit it, and set
*Narrative source* to *World RollTables*.

## Limitations

- Narration exists in English and French; the UI is localised in both.
- Attacks without a target or DC have no degree of success in PF2e, so they are not narrated.
- Save grouping relies on timing: saves rolled one by one by players, further apart than the grouping
  delay, still get one card each.
- Names come from tokens and their gender is unknown: English text uses names or singular "their",
  French text avoids gendered pronouns and agreements; French elision and contraction are automatic
  (« d'Ezren », a token named « le kobold » gives « du kobold »). A monster token still named after its
  stat block ("Giant Rat 2") becomes "the giant rat" and « le rat géant » (always « le », even for a
  feminine name); rename the token (« la harpie », "Squeaker") to choose the wording.
- Texts about a guard, armour or gear are only used against creatures that have them, not animals.
- Damage, condition changes, Dying/Wounded changes, initiative are not narrated; the extension points
  are described in the architecture doc.
- Streaks and "who hit whom last" are read back from the chat log, so they survive a reload (except saves
  rolled through PF2e Toolbelt, which have no chat message).
- "Back on their feet" needs the Dying condition: PF2e does not add or remove it by itself, the GM or a
  module does. A module that removes Dying before raising the HP gets no card.
- Written against the PF2e 8.6.1 source and the Foundry 14 type declarations it ships; not yet run in
  a live Foundry session. See
  [docs/MANUAL-TESTS.md](docs/MANUAL-TESTS.md) for the in-game checklist.
