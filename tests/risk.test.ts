import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assess, buildRows, DEFAULT_RULE, type Inventory } from "../app/inventory/model";

test("score follows the threshold and reorder uses signed available stock", () => {
  assert.deepEqual(assess(-2, true, DEFAULT_RULE), { status: "Out of stock", score: 100, reorder: 17 });
  assert.deepEqual(assess(0, true, DEFAULT_RULE), { status: "Out of stock", score: 100, reorder: 15 });
  assert.deepEqual(assess(1, true, DEFAULT_RULE), { status: "Low stock", score: 99, reorder: 14 });
  assert.deepEqual(assess(5, true, DEFAULT_RULE), { status: "Low stock", score: 20, reorder: 10 });
  assert.deepEqual(assess(6, true, DEFAULT_RULE), { status: "Healthy", score: 0, reorder: 9 });
  assert.deepEqual(assess(40, true, DEFAULT_RULE), { status: "Healthy", score: 0, reorder: 0 });
});

test("missing and untracked quantities have no risk or suggestions", () => {
  assert.deepEqual(assess(null, true, DEFAULT_RULE), { status: "Unavailable", score: null, reorder: null });
  assert.deepEqual(assess(null, null, DEFAULT_RULE), { status: "Unavailable", score: null, reorder: null });
  assert.deepEqual(assess(null, false, DEFAULT_RULE), { status: "Untracked", score: null, reorder: null });
});

test("SKU rules affect each known location and healthy stores cannot mask a shortage", () => {
  const inventory: Inventory = {
    locations: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    variants: [{ id: "v", sku: "CUP", title: "White", product: { id: "p", title: "Cup" },
      available: { a: 7, b: 50 }, tracked: true }],
  };
  const rules = [{ sku: "CUP", threshold: 8, target: 20 }];
  const [row] = buildRows(inventory, rules);
  assert.equal(row.status, "Low stock");
  assert.equal(row.score, 25);
  assert.equal(row.available, 57);
  assert.equal(row.covered, 2);
  assert.equal(row.reorder, 13);
  assert.equal(row.details[2].available, null);
  assert.equal(buildRows(inventory, rules, "b")[0].status, "Healthy");
  assert.equal(buildRows(inventory, rules, "c")[0].reorder, null);
});
