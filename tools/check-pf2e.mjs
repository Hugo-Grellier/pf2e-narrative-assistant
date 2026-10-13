/**
 * Early warning for PF2e changes: checks that the PF2e source still writes the data this module reads
 * (see src/extract.mjs and docs/ARCHITECTURE.md). Run by .github/workflows/pf2e-watch.yml against the
 * latest PF2e release.
 *
 *   node tools/check-pf2e.mjs <path to a foundryvtt/pf2e checkout>
 */
import fs from "node:fs";
import path from "node:path";

const CHECKS = [
    ["src/module/system/check/check.ts", /options: Array\.from\(rollOptions\)/, "flags.pf2e.context.options"],
    ["src/module/system/check/check.ts", /outcome: context\.outcome/, "flags.pf2e.context.outcome"],
    ["src/module/system/check/check.ts", /identifier: context\.identifier/, "flags.pf2e.context.identifier"],
    ["src/module/system/check/check.ts", /isReroll: context\.isReroll/, "flags.pf2e.context.isReroll"],
    ["src/module/system/check/check.ts", /origin: item\?\.getOriginData\(\)/, "flags.pf2e.origin (save grouping)"],
    ["src/module/actor/character/document.ts", /identifier: `\$\{weapon\.id\}\.\$\{weaponSlug\}\.\$\{meleeOrRanged\}`/, "PC strike identifier"],
    ["src/module/actor/helpers.ts", /identifier: `\$\{item\.id\}\.\$\{attackSlug\}\.\$\{meleeOrRanged\}`/, "NPC strike identifier"],
    ["src/module/system/statistic/statistic.ts", /`check:statistic:\$\{this\.parent\.slug\}`/, "check:statistic:<slug> roll option"],
    ["src/module/system/statistic/statistic.ts", /getSelfRollOptions\("target"\)/, "target:* roll options"],
    ["src/module/actor/creature/document.ts", /slug: "dying-recovery"/, "recovery check statistic"],
    ["src/module/item/abstract-effect/document.ts", /`self:\$\{this\.type\}:\$\{this\.rollOptionSlug\}`/, "self:condition:<slug> roll options"],
    ["src/module/item/spell/document.ts", /`\$\{prefix\}:trait:\$\{spellcasting\.tradition\}`/, "spell tradition trait"],
    ["src/module/system/action-macros/athletics/trip.ts", /action:trip/, "action:<slug> roll options"],
];

const root = process.argv[2];
if (!root) {
    console.error("usage: node tools/check-pf2e.mjs <pf2e checkout>");
    process.exit(2);
}
const failures = CHECKS.filter(([file, pattern]) => {
    const full = path.join(root, file);
    return !fs.existsSync(full) || !pattern.test(fs.readFileSync(full, "utf8"));
});
for (const [file, pattern, what] of failures) console.error(`✗ ${what}: ${pattern} not found in ${file}`);
console.log(`${CHECKS.length - failures.length}/${CHECKS.length} PF2e assumptions hold`);
process.exit(failures.length ? 1 : 0);
