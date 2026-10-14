import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESENCE_WINDOW_MS, PresenceBoard, readPresence } from "../presence";

test("someone who keeps saying hello is online, with the document they have open", () => {
    const board = new PresenceBoard();
    board.hello("d-a", "steward:1", 1000);
    board.hello("d-b", "", 1500);
    assert.deepEqual(board.snapshot(2000).online, [{ user: "d-a", viewing: "steward:1" }, { user: "d-b", viewing: "" }]);
});

test("someone who stops saying hello is gone after the window", () => {
    const board = new PresenceBoard();
    board.hello("d-a", "", 1000);
    board.hello("d-b", "", 1000);
    board.hello("d-b", "", 1000 + PRESENCE_WINDOW_MS);
    assert.deepEqual(board.snapshot(1001 + PRESENCE_WINDOW_MS).online.map(e => e.user), ["d-b"]);
});

test("one device is one person, however often it polls", () => {
    const board = new PresenceBoard();
    for (let t = 0; t < 5; t++) board.hello("d-a", "steward:2", t * 2000);
    assert.equal(board.snapshot(8000).online.length, 1);
});

test("malformed presence from the network reads as nobody", () => {
    assert.deepEqual(readPresence("nope"), { online: [], showing: null });
    assert.deepEqual(readPresence({ online: [{ user: 5 }, { user: "d-a" }], showing: { documentId: 1 } }),
        { online: [{ user: "d-a", viewing: "" }], showing: null });
});
