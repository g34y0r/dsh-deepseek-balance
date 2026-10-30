/**
 * Browser-half smoke test (lib/client.js).
 *
 * Validates the lazy-CJS bundle contract the dsh client module system depends
 * on, then drives `apply()` against a fake slot registry and server-renders the
 * widget to prove the hand-compiled JSX produces the expected DOM.
 *
 * React is browser-side only (the shell seeds it through PLATFORM_MODULES), so
 * SSR for this test borrows a self-consistent react + react-dom pair from the
 * dsh profile when one is available and skips the render assertions otherwise.
 *
 * Run: node tests/smoke-client.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

let pass = 0;
const ok = (label) => {
  pass += 1;
  console.log("  ok -", label);
};

const PKG = "dsh-deepseek-balance";
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ---- 1. bundle contract --------------------------------------------------------
console.log("# bundle contract");
let registration = null;
globalThis.window = {
  __ModuleLoader__: {
    load(r) {
      registration = r;
    }
  },
  localStorage: { getItem: () => null, setItem: () => {} }
};
const injectedStyles = [];
globalThis.document = {
  querySelector: () => null,
  createElement: () => {
    const el = { dataset: {}, textContent: "" };
    injectedStyles.push(el);
    return el;
  },
  head: { appendChild: () => {} }
};

(0, eval)(source);
assert.ok(registration, "bundle calls window.__ModuleLoader__.load");
assert.equal(registration.id, PKG, "load id equals the package name (boot-graph row key)");
assert.equal(typeof registration.factory, "function", "registration carries a factory");
ok("registers under the package name with a factory");

// The factory must be lazy-CJS: it returns exports and needs only react modules.
const myRequire = (spec) => {
  if (spec !== "react" && spec !== "react/jsx-runtime") throw new Error("unexpected require: " + spec);
  return reactRequire !== null ? reactRequire(spec) : {};
};
let reactRequire = null;
const exports_ = registration.factory(myRequire);
assert.equal(typeof exports_.apply, "function", "exports.apply");
assert.ok(Array.isArray(exports_.inject), "exports.inject is an array");
assert.deepEqual(exports_.inject, ["locale", "slots"], "injects the locale and slot registries");
ok("factory returns { inject, apply } requiring only react modules");

// The style tag is injected as a module side effect at materialization.
assert.equal(injectedStyles.length, 1, "one style tag injected");
assert.equal(injectedStyles[0].dataset.plugin, PKG);
assert.ok(injectedStyles[0].textContent.includes("backdrop-filter"), "glassmorphism CSS present");
assert.ok(!/transition:|animation:|@keyframes/.test(injectedStyles[0].textContent), "no transitions or animations");
ok("injects one <style> with glassmorphism and no animation");

// ---- 2. apply() against a fake slot registry -----------------------------------
console.log("# apply()");
let ns = null;
let dicts = null;
let injection = null;
let entry = null;
exports_.apply({
  effect: (fn) => fn(),
  locale: {
    register(namespace, dictionaries) {
      ns = namespace;
      dicts = dictionaries;
    }
  },
  slots: {
    inject(name, cb) {
      injection = { name, cb };
    },
    register(opts, component) {
      entry = { opts, component };
      return () => {};
    }
  }
});
assert.equal(ns, "deepseek-balance", "locale namespace");
assert.ok(dicts !== null && dicts.zh !== undefined && dicts.en !== undefined, "zh + en dictionaries");
assert.equal(dicts.zh["tip.balance"], "账户余额");
assert.equal(dicts.zh["tip.granted"], "赠金");
assert.equal(dicts.zh["tip.toppedUp"], "充值");
assert.equal(dicts.zh["tip.updated"], "更新时间");
assert.equal(dicts.zh["tip.auto"], "自动刷新");
assert.equal(dicts.en["tip.granted"], "Granted");
assert.equal(dicts.en["tip.toppedUp"], "Topped up");
// The retired statistics keys stay gone.
for (const gone of ["tip.today", "tip.settled", "tip.tokens", "tip.quota", "tip.remaining"]) {
  assert.equal(dicts.zh[gone], undefined, `${gone} removed`);
}
ok("registers zh/en dictionaries: balance + breakdown + updated + auto");

assert.equal(injection.name, "conversation.input.right", "waits for the composer slot declaration");
const disposed = injection.cb();
assert.equal(typeof disposed, "function", "registration returns a disposer");
assert.equal(entry.opts.name, "conversation.input.right");
assert.equal(entry.opts.id, "deepseek-balance");
assert.equal(entry.opts.order, 0);
assert.equal(entry.opts.locale, "deepseek-balance");
ok("registers into conversation.input.right (id deepseek-balance, order 0)");

// ---- 3. server render (when a consistent react pair is available) --------------
console.log("# render");
let req = null;
for (const anchor of [
  "C:/Users/g34y0r/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json",
  "C:/Users/g34y0r/.dsh/profiles/web/package.json"
]) {
  try {
    const candidate = createRequire(anchor);
    candidate("react");
    candidate("react-dom/server");
    req = candidate;
    break;
  } catch {
    /* try the next anchor */
  }
}

if (req === null) {
  console.log("  skip - react/react-dom unavailable; render assertions skipped");
} else {
  reactRequire = (spec) => req(spec);
  const exports2 = registration.factory(myRequire);
  let entry2 = null;
  exports2.apply({
    effect: (fn) => fn(),
    locale: { register() {} },
    slots: {
      inject(_name, cb) {
        cb();
      },
      register(opts, component) {
        entry2 = { opts, component };
        return () => {};
      }
    }
  });
  const React = req("react");
  const { renderToStaticMarkup } = req("react-dom/server");
  const t = (key) => dicts.zh[key] ?? key;

  // Initial state: no data yet (SSR never runs effects).
  const initial = renderToStaticMarkup(React.createElement(entry2.component, { t }));
  for (const token of ["dsau-chip", "dsau-toggle", "dsau-tip", 'role="tooltip"']) {
    assert.ok(initial.includes(token), `initial render includes ${token}`);
  }
  assert.ok(initial.includes("\u2026"), "chip shows a placeholder while loading");
  assert.ok(!initial.includes("dsau-bar"), "no progress bar");
  ok("initial render: chip + toggle + tooltip");

  /** Re-evaluate the bundle with a seeded `data` state and render it. */
  const renderSeeded = (balance, extra = {}) => {
    const src = source.replace(
      "const [data, setData] = react.useState(null);",
      "const [data, setData] = react.useState(globalThis.__SEED__);"
    );
    assert.notEqual(src, source, "seed transform applied");
    globalThis.__SEED__ = {
      ok: true,
      configured: true,
      balance,
      balanceError: null,
      updatedAt: 1752222222000,
      ...extra
    };
    (0, eval)(src);
    const exp = registration.factory(myRequire);
    let seeded = null;
    exp.apply({
      effect: (fn) => fn(),
      locale: { register() {} },
      slots: {
        inject(_n, cb) {
          cb();
        },
        register(opts, component) {
          seeded = { opts, component };
          return () => {};
        }
      }
    });
    return renderToStaticMarkup(React.createElement(seeded.component, { t }));
  };

  const html = renderSeeded({ isAvailable: true, currency: "CNY", total: 5.03, granted: 0, toppedUp: 5.03, infos: [] });
  assert.ok(html.includes("5.03"), "chip shows total_balance");
  for (const token of ["账户余额", "更新时间", "自动刷新"]) {
    assert.ok(html.includes(token), `tooltip row ${token}`);
  }
  for (const gone of ["今日花费", "今日 Token", "总额度", "剩余", "重新校准"]) {
    assert.ok(!html.includes(gone), `statistics absent: ${gone}`);
  }
  ok("seeded render: balance + updated + auto-refresh only, no statistics");

  // ---- breakdown rows (充值 / 赠金) -------------------------------------------
  const withParts = renderSeeded({ isAvailable: true, currency: "CNY", total: 5.74, granted: 2.41, toppedUp: 3.32, infos: [] });
  assert.ok(withParts.includes("5.74"), "total shown");
  assert.ok(withParts.includes("赠金") && withParts.includes("充值"), "both breakdown labels present");
  assert.ok(withParts.includes("2.41") && withParts.includes("3.32"), "both breakdown amounts present");
  // They render as subordinate rows, not as peers of the total.
  const subRows = withParts.match(/dsau-tip-row dsau-tip-sub/g) ?? [];
  assert.equal(subRows.length, 2, `exactly two sub rows (got ${subRows.length})`);
  // Order: the total, then the user's own funds (充值), then the gift (赠金).
  assert.ok(withParts.indexOf("账户余额") < withParts.indexOf("充值"), "充值 follows the total");
  assert.ok(withParts.indexOf("充值") < withParts.indexOf("赠金"), "topped-up precedes granted");
  ok("breakdown renders as two indented sub-rows under the total, 充值 before 赠金");

  // A missing breakdown field must be hidden, never rendered as ¥0.00.
  const onlyGranted = renderSeeded({ isAvailable: true, currency: "CNY", total: 2.41, granted: 2.41, toppedUp: null, infos: [] });
  assert.ok(onlyGranted.includes("赠金"), "present field shown");
  assert.ok(!onlyGranted.includes("充值"), "null toppedUp hidden");
  assert.equal((onlyGranted.match(/dsau-tip-row dsau-tip-sub/g) ?? []).length, 1, "one sub row");

  const noParts = renderSeeded({ isAvailable: true, currency: "CNY", total: 5.03, granted: null, toppedUp: null, infos: [] });
  assert.ok(!noParts.includes("赠金") && !noParts.includes("充值"), "both null -> no breakdown rows");
  assert.ok(!noParts.includes("dsau-tip-sub"), "no sub rows at all");
  ok("absent breakdown fields are hidden (no misleading ¥0.00)");
}

console.log(`\nALL PASS (${pass} checks)`);
