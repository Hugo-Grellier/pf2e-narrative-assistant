// Replays real `flags.pf2e` captured in Foundry (see docs/MANUAL-TESTS.md, "Capturing fixtures").
// Each fixture: { note, flags, expect }. `expect` lists context fields the extraction must produce;
// null means "not narrated". Fixtures without an `expect` key only have to extract without throwing.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { extractCastContext, extractContext } from "../src/extract.mjs";

const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/pf2e-flags.json", import.meta.url), "utf8"));

for (const [index, { note, flags, expect }] of fixtures.entries()) {
    test(`fixture ${index}: ${note ?? "unnamed"}`, () => {
        const context = extractContext(flags.pf2e) ?? extractCastContext(flags.pf2e);
        if (expect === undefined) return;
        if (expect === null) return assert.equal(context, null);
        assert.ok(context, "expected a narratable context");
        for (const [key, value] of Object.entries(expect)) assert.deepEqual(context[key], value, key);
    });
}
