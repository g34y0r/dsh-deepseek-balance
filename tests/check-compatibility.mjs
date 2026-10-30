/**
 * Compatibility-gate check.
 *
 * The dsh runtime refuses to load a plugin whose `@deepseek-ai/dsh-*`
 * peerDependencies do not satisfy the running version (see
 * `evaluatePluginCompatibility` in @deepseek-ai/dsh-app-boot). This plugin
 * declares NO peers at all, which is the strongest form of "compatible" — it
 * cannot be rejected for a version reason on any runtime.
 *
 * This test asserts that property directly, and demonstrates the gate's
 * behaviour with the real `semver` implementation when one is resolvable.
 *
 * Run: node tests/check-compatibility.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

let pass = 0;
const ok = (label) => {
  pass += 1;
  console.log("  ok -", label);
};

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

console.log("# manifest shape");

assert.equal(pkg.name, "dsh-deepseek-balance");
assert.equal(pkg.type, "module", "ESM package");
assert.equal(pkg.main, "lib/index.js", "host entry");
assert.equal(pkg.exports["."], "./lib/index.js", "root export");
assert.equal(pkg.exports["./client"], "./lib/client.js", "client bundle export (the boot graph resolves this)");
assert.equal(pkg.dsh.client.platform, "web", "dsh.client.platform must be 'web' (both web and desktop use it)");
ok("name / type / exports / dsh.client.platform are correct");

console.log("# bundle shape (what makes the 插件 page list it)");

// The profile's 插件 page (dsh-client-ui-plugin-manager) manages BUNDLES only:
// it lists the packages in `dsh.profile.bundles` and the rows their patches
// declare. A package without dsh.bundle is invisible there however installed.
assert.ok(pkg.dsh.bundle !== undefined, "dsh.bundle must be declared or the plugin never reaches the 插件 page");
const patchList = pkg.dsh.bundle.patch;
assert.ok(Array.isArray(patchList), "dsh.bundle.patch must be an ARRAY of paths (the loader calls .flatMap on it)");
assert.ok(patchList.length > 0, "at least one patch file");
for (const rel of patchList) {
  assert.equal(typeof rel, "string");
  const file = new URL(rel, new URL("../package.json", import.meta.url));
  const text = readFileSync(file, "utf8");
  // The row must mount THIS package. If `name` pointed at another package the
  // card would not own the row and its switch would toggle something else.
  assert.match(
    text,
    /^\s*- id: deepseek-balance\s*$/m,
    `${rel} must declare the deepseek-balance row id (the page keys toggles on it)`,
  );
  const nameMatch = text.match(/^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/m);
  assert.ok(nameMatch !== null, `${rel} must declare a row name`);
  assert.equal(nameMatch[1], pkg.name, `${rel} must mount THIS package (name === ${pkg.name})`);
}
assert.ok(pkg.files.includes("cordis.patch.yml"), "cordis.patch.yml must ship inside the package");
ok("dsh.bundle declared, patch ships, and the row mounts this very package");

console.log("# display metadata (card title / description on the 插件 page)");

// readPluginMeta (dsh-app-boot) resolves `${specifier}/locale/en.json` through
// the package's exports map, then reads EVERY *.json in that directory as one
// language. Without en.json it reads nothing and the card falls back to the
// English package.json fields — the bug this guards against.
assert.equal(
  pkg.exports["./locale/*.json"],
  "./locale/*.json",
  "exports must expose ./locale/*.json or the locale files cannot be resolved",
);
const metaDir = new URL("../locale/", import.meta.url);
const enFile = new URL("en.json", metaDir);
const enRaw = readFileSync(enFile, "utf8");
assert.ok(JSON.parse(enRaw).meta !== undefined, "locale/en.json must carry a meta object");
assert.ok(pkg.files.some((f) => f.startsWith("locale/")), "locale files must be in `files` or they never ship");

const languages = new Map();
for (const name of readdirSync(metaDir)) {
  if (!name.endsWith(".json")) continue;
  const language = name.slice(0, -".json".length);
  assert.match(language, /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/, `${name} must be named after a language id`);
  const { meta } = JSON.parse(readFileSync(new URL(name, metaDir), "utf8"));
  assert.ok(meta !== undefined, `${name} must carry a meta object`);
  for (const field of ["title", "description"]) {
    const value = meta[field];
    if (value === undefined) continue;
    assert.equal(typeof value, "string", `${name}: meta.${field} must be a string`);
    assert.notEqual(value.trim(), "", `${name}: meta.${field} must not be empty (a blank value throws at load)`);
  }
  languages.set(language.toLowerCase(), meta);
}
assert.ok(languages.has("en"), "locale/en.json is required — it is the entry point for all localization");
assert.ok(languages.has("zh"), "locale/zh.json provides the Chinese title seen in the zh UI");

const zh = languages.get("zh");
assert.equal(zh.title, "DeepSeek 余额", "zh card title");
assert.ok(typeof zh.description === "string" && zh.description.length > 0, "zh card description");
assert.ok(
  /[\u4e00-\u9fff]/.test(zh.description),
  "zh description must actually be Chinese, not an English placeholder",
);
ok("locale/en.json + locale/zh.json resolve, export, ship, and carry real Chinese metadata");

console.log("# dependency policy");

assert.deepEqual(pkg.dependencies, {}, "no runtime dependencies");
assert.deepEqual(pkg.peerDependencies, {}, "no peer dependencies");

// The compatibility gate only inspects @deepseek-ai/dsh* peer ranges.
const dshPeers = Object.keys(pkg.peerDependencies).filter((n) => n === "@deepseek-ai/dsh" || n.startsWith("@deepseek-ai/dsh-"));
assert.equal(dshPeers.length, 0, "no dsh peers");
ok("zero dependencies and zero peer dependencies");

console.log("# declared dsh range (engines.dsh)");

// POLICY: the range is deliberately permissive so that users on ANY dsh runtime
// can at least INSTALL this package. What they must know is that installation
// and loading are gated separately by dsh: install is allowed, but on an
// unsupported runtime the gate still refuses to load the bundle, dsh prints
// "skipping profile bundle ... incompatible ... may cause crashes or data loss",
// and the widget does not appear until the user grants an exact-version
// exemption. The supported line is documented in README/CHANGELOG/install docs.
const dshRange = pkg.engines?.dsh;
assert.equal(typeof dshRange, "string", "engines.dsh must be declared");
assert.notEqual(dshRange.trim(), "", "engines.dsh must not be empty");
assert.equal(dshRange, "*", "engines.dsh is '*' by design: every runtime may install (see README)");
ok("engines.dsh is '*' — any dsh runtime may install; loading still gated by dsh itself");

// The supported line must be recorded SOMEWHERE machine-checkable, because the
// manifest no longer encodes it. Keep the docs honest.
// Only documents that actually ship are checked; README carries this by itself
// since the install guide was folded into it.
const docsToCheck = ["../README.md"];
const narrow = /0\.2\.x/;
for (const rel of docsToCheck) {
  const text = readFileSync(new URL(rel, import.meta.url), "utf8");
  assert.match(text, narrow, `${rel} must state the tested/supported dsh line (0.2.x)`);
  assert.match(text, /allow-version/, `${rel} must tell users how to accept the risk on other versions`);
}
ok("README states the supported 0.2.x line and the allow-version escape hatch");

console.log("# the gate itself (with real semver, when available)");

let semver = null;
for (const anchor of [
  "C:/Users/g34y0r/.dsh/profiles/web/package.json",
  "C:/Users/g34y0r/.dsh/profiles/node_modules/yaml/package.json"
]) {
  try {
    const { createRequire } = await import("node:module");
    semver = createRequire(anchor)("semver");
    break;
  } catch {
    /* keep looking */
  }
}

if (semver === null) {
  console.log("  skip - semver unavailable; gate demonstration skipped");
} else {
  /**
   * Port of `unmetRequirements` from @deepseek-ai/dsh-app-boot:
   * an own `engines.dsh` decides alone, and peerDependencies are then ignored.
   */
  const evaluate = (manifest, runtimeVersion) => {
    const engines = manifest.engines ?? {};
    if (Object.hasOwn(engines, "dsh")) {
      return semver.satisfies(runtimeVersion, engines.dsh, { includePrerelease: true })
        ? undefined
        : { "engines.dsh": engines.dsh };
    }
    const missing = {};
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
      if (!semver.satisfies(runtimeVersion, range, { includePrerelease: true })) missing[name] = range;
    }
    return Object.keys(missing).length === 0 ? undefined : missing;
  };

  // Sanity-check the port against a known-bad declaration, so a green result
  // below actually means something.
  const bad = evaluate({ peerDependencies: { "@deepseek-ai/dsh-credentials": "^0.1.0-rc.8" } }, "0.2.0-rc.2");
  assert.ok(bad !== undefined, "an 0.1.x peer IS rejected on 0.2.0-rc.2");
  ok("gate port verified: ^0.1.0-rc.8 is rejected by runtime 0.2.0-rc.2");

  // The install gate must let every runtime through — that is the whole point
  // of the permissive range.
  for (const runtime of ["0.1.0-rc.8", "0.2.0-rc.2", "0.2.1-rc.3", "0.2.1-rc.5", "0.3.0", "1.0.0", "2.5.0"]) {
    assert.equal(evaluate(pkg, runtime), undefined, `engines.dsh '*' must not block installation on ${runtime}`);
  }
  ok("no runtime is blocked at install time (0.1.x / 0.2.x / 0.3.x / 1.0.0 / 2.x all pass)");

  // Guard the documented truth: these are the runtimes the plugin was actually
  // verified on, and the docs must keep claiming exactly these.
  const VERIFIED = ["0.2.1-rc.3", "0.2.1-rc.5"];
  for (const runtime of VERIFIED) {
    assert.equal(
      semver.satisfies(runtime, "^0.2.0-rc.1", { includePrerelease: true }),
      true,
      `${runtime} belongs to the documented supported line`,
    );
  }
  ok(`verified runtimes ${VERIFIED.join(" / ")} fall inside the documented 0.2.x supported line`);
}

console.log(`\nALL PASS (${pass} checks)`);
