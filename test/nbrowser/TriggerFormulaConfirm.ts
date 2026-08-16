/**
 * Tests the "Ask for confirmation" option for trigger formulas: when enabled on a trigger
 * column, editing a watched column in the grid should prompt for confirmation before the
 * trigger formula recalculates. Declining keeps the edit but leaves the trigger column's value
 * untouched; confirming recalculates as usual. The prompt only applies to interactive
 * single-cell edits in the grid, not to actions applied directly (e.g. via the API).
 */
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("TriggerFormulaConfirm", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  // Sets up a fresh doc where column B is a trigger formula ($A) that recalculates on any
  // field change, with "Ask for confirmation" enabled. Returns with row 1 set to A="1", B="1".
  async function setUpConfirmTrigger() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup, "TriggerFormulaConfirm");

    await gu.getCell({ col: "B", rowNum: 1 }).click();
    await gu.toggleSidePanel("right", "open");
    await driver.find(".test-right-tab-field").click();
    await driver.find(".test-field-set-trigger").click();
    await gu.waitAppFocus(false);
    await gu.sendKeys("$A", Key.ENTER);
    await gu.waitForServer();

    await driver.findWait(".test-field-formula-apply-on-changes", 1000).click();
    await gu.waitForServer();
    await driver.findWait(".test-field-triggers-select", 3000).click();
    await driver.findContentWait(".test-field-triggers-dropdown label", "Any field", 100).click();
    await driver.find(".test-trigger-deps-apply").click();
    await gu.waitForServer();

    assert.equal(await driver.find(".test-field-formula-confirm").getAttribute("checked"), null);
    await driver.find(".test-field-formula-confirm").click();
    await gu.waitForServer();
    assert.equal(await driver.find(".test-field-formula-confirm").getAttribute("checked"), "true");

    await gu.sendActions([["AddRecord", "Table1", null, { A: "1" }]]);
    assert.equal(await gu.getCell({ col: "A", rowNum: 1 }).getText(), "1");
    assert.equal(await gu.getCell({ col: "B", rowNum: 1 }).getText(), "1");
  }

  // Starts editing cell A on row 1 with `value`, and commits with Enter, without waiting for
  // the server (a confirmation dialog is expected to appear and block the save).
  async function editCellA(value: string) {
    await gu.getCell({ col: "A", rowNum: 1 }).click();
    await driver.executeScript(() => {
      (window as any).gristApp.allCommands.input.run("");
    });
    await gu.waitForCellEditor();
    await gu.waitAppFocus(false);
    await gu.sendKeys(value, Key.ENTER);
  }

  it("should prompt for confirmation, and keep the edit while freezing the trigger on decline", async function() {
    await setUpConfirmTrigger();

    await editCellA("2");
    assert.match(await driver.findWait(".test-modal-title", 2000).getText(), /Recalculate trigger formula/);
    assert.match(await driver.find(".test-modal-dialog").getText(), /recalculate B/);

    await driver.find(".test-modal-cancel").click();
    await gu.waitForServer();

    // The edit to A went through, but B was not recalculated.
    assert.equal(await gu.getCell({ col: "A", rowNum: 1 }).getText(), "2");
    assert.equal(await gu.getCell({ col: "B", rowNum: 1 }).getText(), "1");
  });

  it("should recalculate normally when the user confirms", async function() {
    await setUpConfirmTrigger();

    await editCellA("3");
    await driver.findWait(".test-modal-dialog", 2000);
    await driver.find(".test-modal-confirm").click();
    await gu.waitForServer();

    assert.equal(await gu.getCell({ col: "A", rowNum: 1 }).getText(), "3");
    assert.equal(await gu.getCell({ col: "B", rowNum: 1 }).getText(), "3");
  });

  it("should undo a declined edit back to the pre-edit state", async function() {
    await setUpConfirmTrigger();

    await editCellA("4");
    await driver.findWait(".test-modal-dialog", 2000);
    await driver.find(".test-modal-cancel").click();
    await gu.waitForServer();
    assert.equal(await gu.getCell({ col: "A", rowNum: 1 }).getText(), "4");
    assert.equal(await gu.getCell({ col: "B", rowNum: 1 }).getText(), "1");

    await gu.undo();
    assert.equal(await gu.getCell({ col: "A", rowNum: 1 }).getText(), "1");
    assert.equal(await gu.getCell({ col: "B", rowNum: 1 }).getText(), "1");
  });

  it("should not prompt for edits applied directly, e.g. via the API", async function() {
    await setUpConfirmTrigger();

    // A non-interactive update (as if via the API) recalculates B without any prompt.
    await gu.sendActions([["UpdateRecord", "Table1", 1, { A: "5" }]]);
    assert.isFalse(await driver.find(".test-modal-dialog").isPresent());
    assert.equal(await gu.getCell({ col: "A", rowNum: 1 }).getText(), "5");
    assert.equal(await gu.getCell({ col: "B", rowNum: 1 }).getText(), "5");
  });
});
