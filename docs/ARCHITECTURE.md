# Architecture

```text
PF2e chat message (createChatMessage, active GM only)
  → extractContext()          src/extract.mjs   PF2e flags → plain NarrativeContext
    or extractCastContext()                     spell cast without attack or save
  → combat memory             src/module.mjs    target health, Strike streak, last hit per victim
  → Hook "pf2e-narrative-assistant.context"     other modules may enrich or cancel
  → shouldNarrate()           src/engine.mjs    settings filters, chance per degree
  → save grouping             src/module.mjs    saves against one item wait for each other
  → candidates()              src/engine.mjs    tables whose `when` matches, most specific first
  → pickEntry()                                 weighted, avoids the last 5 texts of that table
  → interpolate() + contract()                  {placeholders}, component tables, French elision
  → output                    src/module.mjs    GM whisper card / panel / public card / notification, one line per roll
```

`engine.mjs`, `extract.mjs` and `languages.mjs` have no Foundry dependency and are unit-tested. `module.mjs` is the
only file touching Foundry; `tests/module.test.mjs` runs it against fakes.

## PF2e detection

Everything comes from `message.flags.pf2e.context`, written by PF2e's `Check.roll`
(`src/module/system/check/check.ts` in the PF2e repo, checked against PF2e 8.6.1 / Foundry 14.369).
No rendered HTML is parsed.

| Event | Detection |
|---|---|
| Strike | `type: "attack-roll"` and `identifier` = `<itemId>.<slug>.<melee\|ranged>` |
| Skill action | roll option `action:<slug>` (implicit for every PF2e action, e.g. `action:trip`) |
| Saving throw | `type: "saving-throw"` + `check:statistic:<fortitude\|reflex\|will>` |
| Recovery | `type: "flat-check"` + `check:statistic:dying-recovery` (from `CreaturePF2e#rollRecovery`) |
| Persistent damage | `type: "flat-check"` + `check:statistic:pd-recovery` (from `ConditionPF2e#rollRecovery`), damage type from `item:damage:type:*` → `persistent` |
| Spell attack | `type: "attack-roll"` without a strike identifier → `spell` |
| Spell cast | no `context`; `origin.type: "spell"`, `origin.rollOptions` has `origin:action:slug:cast-a-spell` and no `origin:item:defense:*` → `cast` |
| Finishing blow | `updateActor` hook, `system.attributes.hp.value` changed to 0, combat started → `finish` |
| Back from 0 HP | `deleteItem` of a PC's `dying` condition while its HP is above 0 → `revive` |
| Combat | `combatStart` hook (fires only on the GM client that started it) → `combat`, `phase: "start"`; `deleteCombat` of a started combat → `phase: "end"` |

Context fields come from roll options: `item:damage:type:*` → `damageTypes`, `item:trait:*` + action
traits → `traits`, `target:trait:*` → `targetTraits`, `item:group:*`, `item:category:*`,
`self:condition:*` → `actorConditions`, `target:condition:*` → `targetConditions` (values such as
`frightened:2` are dropped). Spells add their tradition as a trait (`item:trait:arcane`). Thrown
attacks: `altUsage: "thrown"` or `item:thrown` on a ranged strike → `thrown: true`.

`tools/check-pf2e.mjs` greps a PF2e checkout for every one of these assumptions;
`.github/workflows/pf2e-watch.yml` runs it weekly against the latest PF2e release.

`outcome` is the degree after PF2e's adjustments. When it is null (no target, no DC), nothing is
narrated: the module never guesses a result.

Duplicates: `createChatMessage` fires only for new documents (never for history loaded at startup),
only the active GM processes it, message ids are remembered, damage rolls are skipped (they carry the
outcome of their attack, checked on PF2e 8.6 data), and our
own cards carry a module flag. PF2e Hero Point rerolls create a new message with a new outcome and are
narrated again, which is intended.

Events that are not rolls (`cast`, `finish`, `revive`, `combat`) carry `rolled: false` and `degreeOfSuccess: "success"` so
the tables keep one shape; the chance settings do not apply to them.

Combat memory is the chat log, so it survives reloads and GM changes. `targetHealth` comes from the
target actor's `hitPoints` when the roll is made (`fresh`, `bloodied` ≤ 50%, `critical` ≤ 25%). The
streak reads the roller's Strikes among the last 200 messages since the combat was created;
`streakOf()` turns them into `streak: "hits" | "misses" | "comeback"` (a Hero Point reroll replaces the
last outcome). The finishing blow names whoever last hurt the creature (a successful Strike or spell
attack against it, or its last save): the active GM remembers it, and falls back to the same search in
the chat log after a reload. Toolbelt saves have no message, so only memory knows them. `updateActor`
only receives changed fields, so a creature already at 0 HP is never narrated twice. `revive` needs no
memory: PF2e 8.6 does not manage Dying itself, but the GM or a healing automation module removes it once
the HP is back above 0; Dying removed at 0 HP (stabilised) is not narrated.

The 🎭 icon (`renderChatMessageHTML`, GMs only) appears on every PF2e message `extractContext` or
`extractCastContext` accepts. A click builds the same context and narrates it, skipping the chance and
event settings, without waiting for Dice So Nice.

Save grouping: a save whose message carries `flags.pf2e.origin.uuid` (the spell, poison or effect item)
waits `saveGroupDelay` seconds; every save with the same origin and the same save type restarts the wait.
They are then narrated together on one card, one line per creature. A card stores
`flags["pf2e-narrative-assistant"] = { header, lines: [{ context, text, rawText, tableKey, gmOnly, sourceId }] }`,
so *Another suggestion* redraws every line, 🚫 redraws one, and ↰ scrolls to `sourceId`.

The *panel* output creates no message: cards (`{ header, lines }`) go to an in-memory list of three,
drawn as a `<section class="pf2e-na-panel">` prepended to `ui.chat.element` and redrawn on `renderChatLog`.
Buttons act on a card handle `{ header, lines, save(lines), close() }`, the same code for a chat card
(`save` updates the message) and a panel entry (`save` replaces the entry and redraws).

PF2e Toolbelt's target helper rolls saves with `createMessage: false`, so no chat message exists. Its
public hook `pf2e-toolbelt.rollSave` fires on the client that rolled, with the unsaved PF2e roll message.
The active GM narrates it directly; any other client sends the PF2e context, the target token UUID and the
spell card id to the active GM through the Foundry query `pf2e-narrative-assistant.toolbeltSave`. A query
is untrusted and Foundry does not say who sent it: it is only honoured for a visible, player-owned
token, once Toolbelt's own record of that save appears on the card
(`flags["pf2e-toolbelt"].targetHelper.saveVariants.*.saves[tokenId]`, written through the GM; waited
for up to 10 s), and the degree and secrecy come from that record. If Toolbelt changes this schema,
forwarded saves stop being narrated; saves rolled on the GM's client are not affected. The GM resolves every name from its
own documents (the token, the spell card's speaker as origin), treats the context like any chat flag
(outcome must be a known degree), keeps the narration whispered when the roll or the spell card is
secret, and dedupes per card and token. ↰ then jumps to the spell card. Toolbelt rerolls are not narrated.

## Tables and resolution

Sources: `src/data/rules.json` holds each category's `when` (shared), `src/data/narration/<lang>/` the
text. The build joins them into one compendium per language, `narration-en` and `narration-fr`. Each
RollTable carries `flags["pf2e-narrative-assistant"]`:

```json
{ "key": "strike.melee.slashing.criticalSuccess", "slot": "narration",
  "when": { "eventType": "strike", "range": "melee", "damageTypes": ["slashing"], "degreeOfSuccess": "criticalSuccess" },
  "priority": 0, "gmOnly": false, "lang": "en" }
```

The tables are the rules: there is no separate rule list. Matching (`matches`):

- context value is a list (`traits`, `damageTypes`, `targetTraits`): every wanted value must be present;
- context value is scalar: equal, or one of the wanted values if `when` gives a list;
- `{ "anyOf": [...] }`: at least one value present, whatever the shape.

Specificity = sum of the `when` key weights (`KEY_WEIGHTS` in `engine.mjs`) + `priority`. Broad keys
(event, range, save, degree) weigh 1, damage types and traits 2, weapon group and creature type 3, a
named action, a condition or a streak 4; target health 3. The fallback chain is therefore implicit:

```text
strike.vs.undead.criticalSuccess        (eventType 1, targetTraits 3, degree 1, priority 3 = 8)
strike.melee.slashing.criticalSuccess   (eventType 1, range 1, damageTypes 2, degree 1 = 5)
strike.melee.criticalSuccess            (3)
generic.criticalSuccess                 (1)
```

Use `priority` only to order two tables that may both match and weigh the same (an agile weapon is
also unarmed; a prone target may also be undead).

Tables with no usable entry are skipped, so an emptied world table falls back too. An entry may carry its
own `when` (stored on the TableResult flag, written from `needs` in the sources): it is only drawn where
that matches, e.g. texts about the target's guard only against armed creatures. Texts hidden with 🚫 (the
`banned` world setting) are removed when tables load, so a table whose texts are all hidden falls back
the same way.

`slot` other than `narration` defines a component: `{bodyPart}` picks the most specific matching
table of slot `bodyPart` (humanoid / beast / generic by `targetTraits`).

## Names

Token names, HTML-escaped. An NPC token from a compendium whose name is still its actor's ("Giant Rat",
"Giant Rat 2") is a stat block, not a name: the language's `npcName` adds an article, "the giant rat",
« le rat géant » (always « le »/« l' » since the gender is unknown; « du »/« au » follow from contraction). Renamed tokens, PCs and
NPCs created in the world keep their names.

## Languages

The *Narration language* setting (default: UI language) picks the pack; unknown languages fall back
to English. Fallback resolution stays inside one language: a missing French table falls back to a
less specific French table, never to English text. `src/languages.mjs` holds per-language fallback
words for missing names and a `fix` pass applied after interpolation (French elision/contraction;
identity for English). `{target's}` inserts an English possessive ("the kobold's", "Valeros'"); French
text uses « de {target} » instead.

## Overrides

Setting *Narrative source* = *World RollTables*: world tables with the same `key` flag replace the
module ones, and world tables with new keys join the pool. World tables flagged with another `lang`
are ignored; tables without `lang` apply to every language. Importing a table from the compendium keeps
the flags, so the GM just imports and edits. The cache is dropped on any RollTable/TableResult change.

## Extending

- New narration for an existing event: a rule in `rules.json` and one JSON file per language (see
  `docs/WRITING.md`).
- New event: return a context with a new `eventType` from `extractContext`, add a setting group in
  `EVENT_SETTINGS`, add rules and JSON files. The engine does not change.
- From another module: `Hooks.on("pf2e-narrative-assistant.context", (ctx, message) => …)` to add
  fields or return `false` to cancel; `game.modules.get("pf2e-narrative-assistant").api.suggest(ctx)`
  narrates any context you build yourself.
