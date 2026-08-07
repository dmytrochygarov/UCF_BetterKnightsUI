"use strict";

/**
 * Loads the manifest's content-script list the way a browser does: as classic
 * scripts sharing one global scope, in manifest order. Catches what per-file
 * require() cannot — e.g. top-level const/let redeclarations across files —
 * and pins the three manifests to lockstep.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const MANIFESTS = ["chrome.json", "firefox.json", "safari.json"].map((f) => [
  f,
  JSON.parse(fs.readFileSync(path.join(ROOT, "manifests", f), "utf8")),
]);

describe("manifest lockstep", () => {
  it("keeps js, css, matches, and version identical across the three manifests", () => {
    const [, chrome] = MANIFESTS[0];
    for (const [name, m] of MANIFESTS.slice(1)) {
      assert.deepEqual(
        m.content_scripts[0].js,
        chrome.content_scripts[0].js,
        `${name} js list`
      );
      assert.deepEqual(
        m.content_scripts[0].css,
        chrome.content_scripts[0].css,
        `${name} css list`
      );
      assert.deepEqual(
        m.content_scripts[0].matches,
        chrome.content_scripts[0].matches,
        `${name} matches`
      );
      assert.equal(m.version, chrome.version, `${name} version`);
    }
  });
});

describe("content scripts in one shared scope", () => {
  it("evaluates the full manifest js list in order without errors", () => {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "https://my.ucf.edu/psp/IHPROD/EMPLOYEE/CSPROD/h/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const ctx = dom.getInternalVMContext();
    const w = dom.window;

    // Extension-environment stubs (see CLAUDE.md "Verifying without a UCF
    // login"). browser.runtime.id makes the polyfill keep this stub.
    const browserStub = {
      runtime: {
        id: "test-extension",
        getURL: (p) => "chrome-extension://test/" + p,
        sendMessage: () => Promise.resolve({}),
        onMessage: { addListener: () => {} },
      },
      storage: {
        sync: {
          get: (keys, cb) => {
            const data = { extensionEnabled: true };
            if (typeof cb === "function") cb(data);
            return Promise.resolve(data);
          },
        },
      },
    };
    w.chrome = { runtime: { id: "test-extension" } };
    w.browser = browserStub;
    Object.defineProperty(w.navigator, "clipboard", {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
    w.document.execCommand = () => true;

    const jsList = MANIFESTS[0][1].content_scripts[0].js;
    for (const rel of jsList) {
      const code = fs.readFileSync(path.join(ROOT, "src", rel), "utf8");
      assert.doesNotThrow(
        () => vm.runInContext(code, ctx, { filename: rel }),
        `loading ${rel} as a classic script`
      );
    }

    for (const name of [
      "myscan",
      "buildCalendarExport",
      "isMyClassScheduleListView",
      "extractEnrolledMeetings",
      "injectCalendarExportControl",
      "runCalendarExport",
    ]) {
      assert.equal(typeof w[name], "function", `window.${name}`);
    }

    // One scan tick on an empty non-myUCF-looking DOM must be a no-op.
    assert.doesNotThrow(() => w.myscan());
    assert.equal(w.document.querySelector(".betterknightsui-calendar-export"), null);

    dom.window.close();
  });
});
