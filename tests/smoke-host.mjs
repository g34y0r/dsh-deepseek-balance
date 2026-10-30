/**
 * Host-half smoke test (lib/index.js).
 *
 * The host half has ZERO runtime dependencies (only node: builtins), so this
 * test runs anywhere — no node_modules, no dsh checkout.
 *
 * Covers: config normalization, the three credential layers, the balance
 * payload shape, every error path, and the stateless / no-LLM guarantees.
 *
 * Run: node tests/smoke-host.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config, ENDPOINT_PATH, apply, inject, name } from "../lib/index.js";

let pass = 0;
const ok = (label) => {
  pass += 1;
  console.log("  ok -", label);
};

// ---- harness -----------------------------------------------------------------
const HOME = mkdtempSync(join(tmpdir(), "dsau-"));
mkdirSync(join(HOME, "storages"), { recursive: true });
process.env.DSH_HOME = HOME;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.TEST_KEY;

const BALANCE = {
  is_available: true,
  balance_infos: [{ currency: "CNY", total_balance: "5.03", granted_balance: "0", topped_up_balance: "5.03" }]
};

let lastAuth = null;
/** Install a fetch stub; `impl` overrides the default success response. */
function stubFetch(impl) {
  globalThis.fetch = async (_url, init) => {
    lastAuth = init?.headers?.Authorization ?? null;
    if (impl !== undefined) return impl();
    return { ok: true, json: async () => BALANCE };
  };
}
stubFetch();

/**
 * Build a fake host context.
 * @param opts.service - "ok" (default) | "missing" | "throw"
 */
function makeCtx(opts = {}) {
  const routes = [];
  const listeners = new Map();
  const ctx = {
    on(event, listener) {
      listeners.set(event, listener);
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      }
    },
    effect(fn) {
      return fn();
    }
  };
  const mode = opts.service ?? "ok";
  if (mode === "ok") ctx.credentials = { resolve: async () => ({ value: "sk-from-service" }) };
  else if (mode === "throw") ctx.credentials = { resolve: async () => { throw new Error("seam exploded"); } };
  else ctx.get = () => undefined;
  return { ctx, routes, listeners };
}

function mockRes() {
  const res = { status: 0, headers: {}, body: "" };
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers ?? {};
  };
  res.end = (body) => {
    res.body = body ?? "";
  };
  return res;
}

async function get(routes, method = "GET") {
  const res = mockRes();
  await routes[0].handler({ method, url: ENDPOINT_PATH }, res);
  return res;
}

/** Parse the JSON body of a successful GET. */
async function snapshot(routes) {
  const res = await get(routes);
  assert.equal(res.status, 200, "GET returns 200");
  return JSON.parse(res.body);
}

// ---- 1. module surface -------------------------------------------------------
console.log("# module surface");
{
  assert.equal(name, "dsh-deepseek-balance");
  assert.equal(ENDPOINT_PATH, "/deepseek-balance/state");
  assert.ok(Array.isArray(inject), "inject is an array (the form Cordis expects)");
  assert.deepEqual(inject, ["credentials", "webServer"]);
  assert.equal(typeof apply, "function");
  assert.equal(typeof Config, "function");
  ok("exports name / inject / Config / apply with the documented values");

  // Cordis resolves config through the Standard Schema interface:
  //   Config["~standard"].validate(raw) -> { value } | { issues }
  // A plain callable WITHOUT `~standard` makes Cordis throw
  // "Cannot read properties of undefined (reading 'validate')", and the row
  // silently fails to activate — the exact bug this interface fixes.
  assert.ok(Config["~standard"] !== undefined, "Config carries the ~standard interface Cordis calls");
  assert.equal(typeof Config["~standard"].validate, "function", "~standard.validate is callable");
  const probe = Config["~standard"].validate({ baseURL: "https://x.test/" });
  assert.ok(!("then" in probe), "validate is synchronous (Cordis rejects async validation)");
  assert.equal(probe.issues, undefined, "no issues for a well-formed config");
  assert.deepEqual(probe.value, { baseURL: "https://x.test", apiKeyEnv: "DEEPSEEK_API_KEY" });
  const bare = Config["~standard"].validate(undefined);
  assert.deepEqual(bare.value, { baseURL: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" });
  assert.equal(Config["~standard"].validate({ dailyQuota: 30 }).issues, undefined, "retired keys never produce issues");
  ok("Config satisfies Cordis resolveConfig via ~standard.validate (sync, value, no issues)");
}

// ---- 2. config normalization --------------------------------------------------
console.log("# config normalization");
{
  assert.deepEqual(Config({}), { baseURL: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" }, "defaults");
  assert.equal(Config({ baseURL: "https://example.com/" }).baseURL, "https://example.com", "trailing slash trimmed");
  assert.equal(Config({ apiKeyEnv: "  MY_KEY  " }).apiKeyEnv, "MY_KEY", "value trimmed");
  assert.equal(Config(undefined).baseURL, "https://api.deepseek.com", "undefined tolerated");
  assert.equal(Config(null).apiKeyEnv, "DEEPSEEK_API_KEY", "null tolerated");
  assert.equal(Config("nonsense").baseURL, "https://api.deepseek.com", "non-object tolerated");
  // Retired fields from an older profile patch must not break the load.
  const legacy = Config({ dailyQuota: 30, quotaCurrency: "CNY", pricing: { x: 1 }, baseURL: "https://x.test" });
  assert.equal(legacy.baseURL, "https://x.test");
  assert.deepEqual(Object.keys(legacy).sort(), ["apiKeyEnv", "baseURL"], "unknown keys ignored, not copied");
  ok("defaults, trimming, junk tolerance, and retired-key tolerance");
}

// ---- 3. credential layer 1: the service ---------------------------------------
console.log("# credential layer 1 — ctx.credentials");
{
  const { ctx, routes } = makeCtx();
  apply(ctx, Config({}));
  assert.equal(routes.length, 1, "one route registered");
  assert.equal(routes[0].kind, "exact");
  assert.equal(routes[0].path, ENDPOINT_PATH);
  const payload = await snapshot(routes);
  assert.equal(payload.ok, true);
  assert.equal(payload.configured, true);
  assert.equal(lastAuth, "Bearer sk-from-service", "key came from the service");
  assert.equal(payload.balance.total, 5.03);
  assert.equal(payload.balance.currency, "CNY");
  assert.equal(payload.balance.granted, 0);
  assert.equal(payload.balance.toppedUp, 5.03);
  assert.equal(payload.balance.isAvailable, true);
  assert.equal(payload.balanceError, null);
  assert.ok(typeof payload.updatedAt === "number" && payload.updatedAt > 0, "updatedAt present");
  assert.equal(payload.usage, undefined, "no usage field");
  assert.equal(payload.quota, undefined, "no quota field");
  assert.ok(!JSON.stringify(payload).includes("sk-"), "no key material in the response");
  ok("service layer wins; payload is balance + updatedAt only");
}

// ---- 4. credential layer 2: environment ---------------------------------------
console.log("# credential layer 2 — environment");
{
  process.env.TEST_KEY = "sk-from-env";
  const { ctx, routes } = makeCtx({ service: "missing" });
  apply(ctx, Config({ apiKeyEnv: "TEST_KEY" }));
  const payload = await snapshot(routes);
  assert.equal(payload.configured, true);
  assert.equal(lastAuth, "Bearer sk-from-env", "key came from the environment");
  delete process.env.TEST_KEY;
  ok("environment layer works with no credential service");
}

// ---- 5. credential layer 3: .credentials.yaml ---------------------------------
console.log("# credential layer 3 — .credentials.yaml");
{
  const credFile = join(HOME, ".credentials.yaml");
  writeFileSync(credFile, ["version: 1", "refs:", "  DEEPSEEK_API_KEY: sk-from-file", "  OTHER: nope", "records: {}", ""].join("\n"), "utf8");
  const a = makeCtx({ service: "missing" });
  apply(a.ctx, Config({}));
  await snapshot(a.routes);
  assert.equal(lastAuth, "Bearer sk-from-file", "key parsed from the document");
  ok("file layer parses refs.<name> with no yaml dependency");

  writeFileSync(credFile, 'refs:\n  DEEPSEEK_API_KEY: "sk-quoted"\n', "utf8");
  const b = makeCtx({ service: "missing" });
  apply(b.ctx, Config({}));
  await snapshot(b.routes);
  assert.equal(lastAuth, "Bearer sk-quoted", "double-quoted scalar unwrapped");
  ok("quoted scalars unwrapped");

  // A nested/other ref must not be mistaken for ours.
  writeFileSync(credFile, "refs:\n  OTHER: sk-wrong\n", "utf8");
  const c = makeCtx({ service: "missing" });
  apply(c.ctx, Config({}));
  const p = await snapshot(c.routes);
  assert.equal(p.configured, false);
  assert.equal(p.balanceError.code, "MISSING_CREDENTIAL");
  ok("a different ref name is never reused");
}

// ---- 6. no key anywhere --------------------------------------------------------
console.log("# no key anywhere");
{
  rmSync(join(HOME, ".credentials.yaml"), { force: true });
  const { ctx, routes } = makeCtx({ service: "missing" });
  apply(ctx, Config({}));
  const payload = await snapshot(routes);
  assert.equal(payload.ok, true, "endpoint still answers");
  assert.equal(payload.configured, false);
  assert.equal(payload.balance, null);
  assert.equal(payload.balanceError.code, "MISSING_CREDENTIAL");
  assert.ok(!JSON.stringify(payload).includes("sk-"), "no key material");
  ok("missing key is reported, never thrown, never leaked");
}

// ---- 7. a throwing seam degrades ----------------------------------------------
console.log("# credentials service throws");
{
  process.env.TEST_KEY = "sk-after-throw";
  const { ctx, routes } = makeCtx({ service: "throw" });
  apply(ctx, Config({ apiKeyEnv: "TEST_KEY" }));
  const payload = await snapshot(routes);
  assert.equal(payload.configured, true, "fell through to the environment");
  assert.equal(lastAuth, "Bearer sk-after-throw");
  delete process.env.TEST_KEY;
  ok("a throwing credential seam degrades instead of failing the plugin");
}

// ---- 8. transport & method errors ---------------------------------------------
console.log("# transport and methods");
{
  stubFetch(() => ({ ok: false, status: 401 }));
  const a = makeCtx();
  apply(a.ctx, Config({}));
  assert.equal((await snapshot(a.routes)).balanceError.code, "HTTP_401");
  ok("HTTP status mapped to a code");

  stubFetch(() => { throw new Error("boom"); });
  const b = makeCtx();
  apply(b.ctx, Config({}));
  assert.equal((await snapshot(b.routes)).balanceError.code, "TRANSPORT");
  ok("transport failure mapped to a code");

  stubFetch(() => ({ ok: true, json: async () => ({ is_available: true, balance_infos: [] }) }));
  const c = makeCtx();
  apply(c.ctx, Config({}));
  const empty = await snapshot(c.routes);
  assert.equal(empty.configured, true, "reachable but empty payload");
  assert.equal(empty.balance.total, null, "no infos -> null total");
  ok("an empty balance_infos list yields a null total, not a crash");

  stubFetch();
  const d = makeCtx();
  apply(d.ctx, Config({}));
  const head = await get(d.routes, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "", "HEAD sends no body");
  ok("HEAD handled");

  const post = await get(d.routes, "POST");
  assert.equal(post.status, 405, "POST rejected");
  ok("non-GET/HEAD rejected with 405");
}

// ---- 9. stateless & model-free -------------------------------------------------
console.log("# stateless and model-free");
{
  const { ctx, routes, listeners } = makeCtx();
  apply(ctx, Config({}));
  await snapshot(routes);
  await snapshot(routes);
  assert.equal(listeners.get("llm/stream"), undefined, "no llm/stream listener");
  assert.equal(listeners.size, 0, "registers no events at all");
  assert.equal(existsSync(join(HOME, "storages", "dsh-deepseek-balance.json")), false, "writes no state file");
  ok("no LLM listener, no events, no persisted state");
}

rmSync(HOME, { recursive: true, force: true });
console.log(`\nALL PASS (${pass} checks)`);
