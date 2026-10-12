# Writing narration entries

`npm test` lints every entry (see `tests/corpus.test.mjs`); `npm run build` turns the sources into one
RollTable compendium per language.

## Where things live

```text
src/data/rules.json                when each category applies (shared by all languages)
src/data/narration/en/**.json      English text
src/data/narration/fr/**.json      French text
```

A rule:

```json
{ "key": "skill.athletics.trip", "when": { "eventType": "skill-check", "actionSlug": "trip" } }
```

- `key`: stable internal id, never shown to users. Tables get `<key>.<outcome>`.
- `when`: conditions on the context (see `docs/ARCHITECTURE.md`). The outcome is added automatically.
- Optional: `priority` (win ties), `gmOnly` (GM prompts, never sent to players), `slot` (component).

A text file (one definition or an array), same `key` in every language:

```json
{
  "key": "skill.athletics.trip",
  "label": ["Skills", "Athletics", "Trip"],
  "outcomes": {
    "criticalSuccess": ["…"],
    "success": ["…"],
    "failure,criticalFailure": ["…"]
  }
}
```

- `label`: path shown in the compendium; the first element is the folder.
- An outcome key may group degrees: `"failure,criticalFailure"`. Use the same groups in every language.
- An entry is a string, or `{ "text": "…", "weight": 3 }` to make it more likely.
- Missing outcomes are fine: resolution falls back to a less specific table.
- Languages are written independently, not translated line by line; entry counts may differ.

Component tables (fragments inserted into sentences) have a `slot` in their rule and `entries` instead
of `outcomes`: `{ "key": "component.body-part.humanoid", "label": [...], "entries": ["the shoulder", …] }`.

## Placeholders

| Placeholder | Value | English fallback | French fallback |
|---|---|---|---|
| `{attacker}` / `{actor}` | token name of the roller | the attacker / the character | l'assaillant / le personnage |
| `{target}` | token name of the target | their opponent | son adversaire |
| `{weapon}` | item name (already in the card header, rarely useful) | their weapon | son arme |
| `{origin}` | token name of the creature behind a save | the effect | l'effet |
| `{bodyPart}` | component table: "the shoulder", « l'épaule »… | — | — |

Names are whatever the GM typed on the token ("Valeros", "the kobold"), and their gender is unknown.

**English**
- Never put an article before a name: no `the {target}`. Possessives as `the guard of {target}`, which
  works for "Valeros" and "the kobold" alike.
- No he/she/him/her/his/himself/herself anywhere (the test enforces it); use the name or singular
  "their/themselves".
- `{bodyPart}` carries its article ("the shoulder"): use it after `on`, `in`, `into`, `across`.

**French**
- Names go where no article is needed: subject, object, after `de`, `que`, `sur`, `contre`, `vers`,
  `pour`. Elision and contraction are automatic (« de Arwyn » → « d'Arwyn », « de le kobold » →
  « du kobold »). Never `le {target}`, `du {target}`, `un {target}`, `l'{target}`.
- `{bodyPart}` carries its article (« l'épaule »): use it after `sur`, `vers`, `contre`, `sous`.
- Avoid pronouns and agreements that assume a gender (« il », « le », « surpris »): prefer the name,
  « l' », possessives, or a body/gear focused sentence.

In both languages a sentence may start with a placeholder: the first letter is capitalised.

## Style

- Tabletop narration, readable at a glance. One sentence, sometimes two short ones.
- Sensory and cinematic: sounds, motion, the feel of the impact, the reaction.
- Vary openings and verbs. Overused adverbs are capped by the tests ("violently", "brutally",
  "precisely", "barely"; « violemment », « brutalement », « avec précision », « de justesse »).
- Strikes, saves, recovery and generic text never state a mechanical consequence PF2e did not apply:
  no broken limb, no prone, no push, no dropped weapon, no bleeding/persistent damage, no condition,
  no death, no destroyed armour, no damage numbers, no immunity/resistance.
  "The blade bites deep into their defense" rather than "the blade severs their arm".
- Skill actions may describe the rules result of that degree, since PF2e determined it (Trip success:
  the target falls; Grapple success: the target is held). Never add more.
- Recall Knowledge entries are prompts to the GM, not facts about creatures.
