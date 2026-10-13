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
  language (141 tables and ~1600 entries each, written separately in English and French rather than
  translated).
- *Another suggestion* draws another text, never another PF2e roll. *Send to chat* posts the text
  alone, publicly.

## Supported events

| Event | Specialisations |
|---|---|
| Strikes, melee | generic, slashing, piercing, bludgeoning; body part by target type |
| Strikes, ranged | generic, piercing (bows, crossbows), thrown weapons |
| Athletics | Trip, Grapple, Shove, Disarm, Escape |
| Acrobatics | Tumble Through (success / failure, as in the Remaster rules) |
| Deception, Intimidation, Stealth, Perception | Feint, Create a Diversion, Demoralize, Hide, Sneak, Seek |
| Medicine | Treat Wounds, Administer First Aid |
| Recall Knowledge | GM prompts on how to deliver the information, never invented facts |
| Saving throws | Reflex (fire, cold, electricity, acid), Fortitude (poison, disease, physical), Will (fear, mental) |
| Recovery checks | four degrees |
| Anything else | generic fallback per degree (other skill actions, and spells/misc rolls if enabled) |

## Settings

Enable, output (GM whisper / public chat / notification), narration language (UI language / English /
French; English when the UI language has no corpus), narrative source (module / world tables),
frequency (all / successes only / criticals only), event families, degrees of success, and a list of
disabled action slugs (`seek, hide, recall-knowledge`…). Narration about a secret roll or a Recall
Knowledge prompt always stays whispered.

## Development

```sh
npm install
npm test          # engine, extraction, Foundry glue (faked), corpus lint
npm run build     # src/data → packs/narration-<lang> (LevelDB, via @foundryvtt/foundryvtt-cli)
```

Symlink the repository into `Data/modules/pf2e-narrative-assistant` and run `npm run build` once.
`packs/` is generated, never edited by hand nor committed; table and result IDs are derived from table
keys, so rebuilds are reproducible.

Releases: publish a GitHub release tagged `vX.Y.Z`. `.github/workflows/release.yml` tests, builds the
compendiums, stamps `version`, `url`, `manifest` and `download` into `module.json`, and attaches
`module.json` and `module.zip` to the release. Install URL for Foundry:
`https://github.com/<owner>/<repo>/releases/latest/download/module.json`.

## How a narration is chosen

Every compendium table carries a key and a `when` condition (event, action, save, range, damage type,
traits, degree…), defined once in `src/data/rules.json` for all languages. The most specific matching table wins, so missing specialisations fall back by
themselves: `strike.melee.slashing.success` → `strike.melee.success` → `generic.success`.
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
- Area spells produce one save message per creature, hence one suggestion each.
- Names come from tokens and their gender is unknown: English text uses names or singular "their",
  French text avoids gendered pronouns and agreements; French elision and contraction are automatic
  (« d'Ezren », a token named « le kobold » gives « du kobold »). Naming generic NPC tokens with their
  article ("the kobold") reads best in both languages.
- Spell casts, damage, conditions, Dying/Wounded changes, initiative are not narrated yet; the
  extension points are described in the architecture doc.
- Written against the PF2e 8.6.1 source and the Foundry 14 type declarations it ships; not yet run in
  a live Foundry session. See
  [docs/MANUAL-TESTS.md](docs/MANUAL-TESTS.md) for the in-game checklist.
