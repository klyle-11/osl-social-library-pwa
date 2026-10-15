import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, mergeOps } from "../merge";
import { validateOp } from "../ops";
import type { Op } from "../types";
import phoneA from "../fixtures/phone-a.json";
import phoneB from "../fixtures/phone-b.json";
import phoneC from "../fixtures/phone-c.json";

const A = phoneA as Op[], B = phoneB as Op[], C = phoneC as Op[];
const same = (x: Op[][], y: Op[][]) => assert.equal(canonical(mergeOps(...x)), canonical(mergeOps(...y)));

test("fixtures are valid ops", () => {
    for (const op of [...A, ...B, ...C]) assert.ok(validateOp(op).ok, op.id);
});

test("union by id: the shared op appears once", () => {
    const { ops } = mergeOps(A, B);
    assert.deepEqual(ops.map(o => o.id), ["d-a:1", "d-a:2", "d-b:1", "d-b:2", "d-b:3"]);
});

test("commutative", () => same([A, B], [B, A]));

test("associative", () => {
    const ab = mergeOps(A, B).ops, bc = mergeOps(B, C).ops;
    same([ab, C], [A, bc]);
});

test("idempotent", () => {
    const ab = mergeOps(A, B).ops;
    same([ab, A], [A, B]);
    same([ab, ab], [ab]);
});

test("every ordering of every op gives the same result", () => {
    const all = [...A, ...B, ...C];
    const expected = canonical(mergeOps(all));
    for (let i = 0; i < 20; i++) {
        const shuffled = [...all].sort(() => Math.random() - 0.5);
        assert.equal(canonical(mergeOps(shuffled)), expected);
    }
});

test("same id, different payload is a reported conflict, never a silent overwrite", () => {
    const altered = { ...B[0], body: "Someone changed this." } as Op;
    const one = mergeOps(A, [altered]);
    const two = mergeOps([altered], A);
    assert.equal(one.conflicts.length, 1);
    assert.equal(one.conflicts[0].id, "d-b:1");
    // and both sides pick the same winner
    assert.equal(canonical(one), canonical(two));
});

test("key order doesn't make a conflict", () => {
    const reordered = JSON.parse(JSON.stringify(A[1], Object.keys(A[1]).reverse())) as Op;
    assert.equal(mergeOps(A, [reordered]).conflicts.length, 0);
});

// The same cases are checked by the drop point's firmware (firmware/test/node_test.cpp),
// so the two can't drift apart about what a valid op is.
import validation from "../fixtures/validation.json";
import { validateOp as validateShared } from "../ops";

test("shared validation fixtures", () => {
    for (const c of validation as { case: string, op: unknown, valid: boolean }[]) {
        assert.equal(validateShared(c.op).ok, c.valid, c.case);
    }
});
