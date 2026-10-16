import { test } from "node:test";
import assert from "node:assert/strict";
import { mayAdminister, mayOpen, mayPresent, mayUpload, rolesOf, stewardsOf, type Account, type LibraryConfig, type Session } from "../policy";
import { hashAccountPassword, hashLibraryPassword, verifyPassword } from "../passwords";

const lib = (o: Partial<LibraryConfig> = {}): LibraryConfig => ({
    id: "poetry", name: "Poetry", created: "", password: null, passwordSet: null,
    upload: ["guests"], watch: null, roles: {}, groups: [], ...o
});
const account = (id: string, o: Partial<Account> = {}): Account =>
    ({ id, username: id, name: id, hash: "", admin: false, created: "", devices: [], ...o });
const session = (unlocked: Record<string, string> = {}): Session => ({ account: null, unlocked, created: "", seen: "" });

test("an open library opens for anyone; a protected one for its members, the node admin, or its password", () => {
    assert.equal(mayOpen(lib(), null, null), true);
    const locked = lib({ password: "pbkdf2…", passwordSet: "t1", roles: { "a-rosa": ["member"] } });
    assert.equal(mayOpen(locked, null, null), false);
    assert.equal(mayOpen(locked, account("a-rosa"), null), true);
    assert.equal(mayOpen(locked, account("a-boss", { admin: true }), null), true);
    assert.equal(mayOpen(locked, null, session({ poetry: "t1" })), true);
    // a new password locks out everyone who opened it with the old one
    assert.equal(mayOpen({ ...locked, passwordSet: "t2" }, null, session({ poetry: "t1" })), false);
});

test("a disabled account has no roles", () => {
    const l = lib({ roles: { "a-rosa": ["admin"] } });
    assert.equal(rolesOf(l, account("a-rosa", { disabled: true })).size, 0);
    assert.equal(mayAdminister(l, account("a-rosa")), true);
});

test("admin includes every role; any role includes member", () => {
    assert.deepEqual([...rolesOf(lib({ roles: { a: ["admin"] } }), account("a"))].sort(), ["admin", "digitizer", "member", "presenter", "steward", "uploader"]);
    assert.deepEqual([...rolesOf(lib({ roles: { a: ["presenter"] } }), account("a"))].sort(), ["member", "presenter"]);
});

test("who may add documents: any combination of who, and admins and stewards always", () => {
    const only = (upload: LibraryConfig["upload"], roles: LibraryConfig["roles"] = {}) => lib({ upload, roles });
    assert.equal(mayUpload(only(["guests"]), null), true);
    assert.equal(mayUpload(only(["accounts"]), null), false);
    assert.equal(mayUpload(only(["accounts"]), account("a")), true);
    assert.equal(mayUpload(only(["presenters"]), account("a")), false);
    assert.equal(mayUpload(only(["presenters"]), null, { presenter: true, station: false }), true);   // paired with the code
    assert.equal(mayUpload(only(["presenters", "digitizers"], { a: ["digitizer"] }), account("a")), true);
    assert.equal(mayUpload(only(["digitizers"]), null, { presenter: false, station: true }), true);
    assert.equal(mayUpload(only(["uploaders"], { a: ["member"] }), account("a")), false);
    assert.equal(mayUpload(only(["members"], { a: ["member"] }), account("a")), true);
    assert.equal(mayUpload(only([], { a: ["steward"] }), account("a")), true);
    assert.equal(mayUpload(only([]), account("boss", { admin: true })), true);
    assert.equal(mayUpload(only([]), null), false);
});

test("presenting: a paired presenter, or the presenter role", () => {
    assert.equal(mayPresent(lib(), null, { presenter: true, station: false }), true);
    assert.equal(mayPresent(lib({ roles: { a: ["presenter"] } }), account("a"), { presenter: false, station: false }), true);
    assert.equal(mayPresent(lib(), account("a"), { presenter: false, station: false }), false);
});

test("stewards are the steward and admin accounts, and the node admins", () => {
    const all = [account("a"), account("b"), account("c"), account("boss", { admin: true })];
    assert.deepEqual(stewardsOf(lib({ roles: { a: ["steward"], b: ["admin"], c: ["uploader"] } }), all), ["a", "b", "boss"]);
});

test("passwords: scrypt for accounts, PBKDF2 for libraries; a wrong one or a strange hash fails", async () => {
    const a = await hashAccountPassword("correct horse");
    assert.match(a, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verifyPassword(a, "correct horse"), true);
    assert.equal(await verifyPassword(a, "Correct horse"), false);
    const l = await hashLibraryPassword("poems", 1000);
    assert.match(l, /^pbkdf2-sha256\$1000\$/);
    assert.equal(await verifyPassword(l, "poems"), true);
    assert.equal(await verifyPassword(l, "poem"), false);
    assert.equal(await verifyPassword("md5$abc", "x"), false);
    assert.equal(await verifyPassword("pbkdf2-sha256$999999999$AA$AA", "x"), false);
});

test("a PBKDF2 hash the drop point can check: the same answer as the RFC 7914 test vector", async () => {
    // PBKDF2-HMAC-SHA256("passwd", "salt", 1, 64) starts 55ac046e56e3089f
    const { pbkdf2Sync } = await import("node:crypto");
    assert.equal(pbkdf2Sync("passwd", "salt", 1, 64, "sha256").toString("hex").slice(0, 16), "55ac046e56e3089f");
});
