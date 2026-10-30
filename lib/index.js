/**
 * dsh-deepseek-balance — host half.
 *
 * One job: resolve the DeepSeek API key, call the official
 * `GET <baseURL>/user/balance` endpoint, and serve the account balance as JSON
 * at `GET /deepseek-balance/state` for the browser half.
 *
 * ── Zero runtime dependencies ────────────────────────────────────────────────
 * This file imports NOTHING from `@deepseek-ai/*` (not even schemastery) and
 * nothing outside `node:*`. Config validation is hand-written below.
 *
 * Why: a profile's `node_modules` and the host runtime that actually executes
 * this code can resolve the same bare specifier to DIFFERENT copies/versions
 * of a `@deepseek-ai/dsh-*` package. The desktop app bundles its runtime inside
 * `app.asar` (0.2.0-rc.2) while `%USERPROFILE%\.dsh\profiles\node_modules` may
 * expose an npm-installed dsh (0.1.x). Importing across that boundary is a
 * version-mixing hazard that can fail the whole plugin load, so this host half
 * avoids the boundary entirely and keeps only Node builtins.
 *
 * ── Layered credential resolution ────────────────────────────────────────────
 * The API key is resolved lazily, in order, and the first hit wins:
 *   1. `ctx.credentials.resolve(ref)` — the sanctioned seam, read through the
 *      injected service (never an import).
 *   2. `process.env[apiKeyEnv]` — an inherited environment variable.
 *   3. `$DSH_HOME/.credentials.yaml` → `refs.<apiKeyEnv>` — the local credential
 *      provider's own document, parsed by the tiny scanner below.
 * Exhausting every layer reports MISSING_CREDENTIAL instead of throwing.
 *
 * ── Guarantees ───────────────────────────────────────────────────────────────
 * The key never leaves the host. No token/cost tracking, no persistence, no
 * LLM involvement: this plugin makes no model calls and contributes nothing to
 * any request.
 *
 * The endpoint path is a fixed constant shared with the browser half — both
 * sides hardcode `/deepseek-balance/state` so a config/browser mismatch is
 * impossible.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Cordis plugin name (also the client bundle's `load` id). */
export const name = "dsh-deepseek-balance";

/** Required host services: the credential seam and the HTTP route registry. */
export const inject = ["credentials", "webServer"];

/** Fixed endpoint shared with the browser half (`lib/client.js` ENDPOINT). */
export const ENDPOINT_PATH = "/deepseek-balance/state";

/** Where a deployable default lives; overridable through config. */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";

/**
 * Hand-written config normalizer (no schema library).
 *
 * Accepts the validated shape Cordis would pass, or `undefined`, or a partial
 * object, and always returns a complete, type-correct config. Unknown keys are
 * ignored rather than rejected: a stale profile patch that still carries
 * retired fields (dailyQuota / quotaCurrency / pricing) must not fail the load.
 *
 * @param {unknown} raw - the value the loader passed as config.
 * @returns {{baseURL: string, apiKeyEnv: string}}
 */
function normalizeConfig(raw) {
  const cfg = raw !== null && typeof raw === "object" ? raw : {};
  const baseURL = typeof cfg.baseURL === "string" && cfg.baseURL.trim().length > 0 ? cfg.baseURL.trim() : DEFAULT_BASE_URL;
  const apiKeyEnv = typeof cfg.apiKeyEnv === "string" && cfg.apiKeyEnv.trim().length > 0 ? cfg.apiKeyEnv.trim() : DEFAULT_API_KEY_ENV;
  return { baseURL: baseURL.replace(/\/+$/, ""), apiKeyEnv };
}

/**
 * The `Config` face Cordis consumes.
 *
 * Cordis resolves a plugin's config by calling
 * `Config["~standard"].validate(raw)` — the Standard Schema interface — and
 * reading `value` / `issues` SYNCHRONOUSLY. A plain callable without that
 * property makes Cordis throw
 * `TypeError: Cannot read properties of undefined (reading 'validate')`
 * and the entire row fails to activate. Carrying the interface explicitly is
 * what lets this plugin validate config with no schema package at all.
 */
export const Config = Object.assign(
  (value) => normalizeConfig(value),
  {
    "~standard": {
      version: 1,
      vendor: "dsh-deepseek-balance",
      /**
       * Validate raw config into the normalized shape. Never reports issues:
       * every input normalizes to a usable config, so a stale profile patch
       * cannot fail the plugin load.
       * @param {unknown} value - the raw config supplied by the loader.
       * @returns {{value: {baseURL: string, apiKeyEnv: string}}}
       */
      validate(value) {
        return { value: normalizeConfig(value) };
      }
    },
    toString: () => "{ baseURL?: string; apiKeyEnv?: string }"
  }
);

/** The Harness home, mirroring dsh-home-paths: `$DSH_HOME`, else `~/.dsh`. */
function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  return join(homedir(), ".dsh");
}

/**
 * Read `refs.<ref>` from the local credential document.
 *
 * The document is a two-level map (`refs:` → `NAME: value`) of scalars; this
 * scans exactly that shape. It never throws: a missing file, an unexpected
 * layout, or an unreadable path all yield `undefined` so the caller can fall
 * through to the other layers.
 *
 * @param {string} ref - credential reference name.
 * @returns {string | undefined} the secret, or undefined when unavailable.
 */
function readCredentialFile(ref) {
  let text;
  try {
    text = readFileSync(join(dshHome(), ".credentials.yaml"), "utf8");
  } catch {
    return undefined;
  }
  let inRefs = false;
  let refsIndent = -1;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (!inRefs) {
      if (/^refs\s*:\s*$/.test(trimmed)) {
        inRefs = true;
        refsIndent = indent;
      }
      continue;
    }
    // A key at or above the `refs:` indent closes the section.
    if (indent <= refsIndent) break;
    const match = /^("?)([A-Za-z0-9_.-]+)\1\s*:\s*(.*)$/.exec(trimmed);
    if (match === null || match[2] !== ref) continue;
    let value = match[3].trim();
    if (value === "" || value === "~" || value === "null") return undefined;
    const dq = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    const sq = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
    if (dq || sq) value = value.slice(1, -1);
    if (dq) value = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** Normalize the official /user/balance payload into a compact display shape. */
function normalizeBalance(body) {
  const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
  const primary = infos[0] ?? null;
  const num = (v) => Number(v ?? 0);
  return {
    isAvailable: body?.is_available === true,
    currency: primary?.currency ?? null,
    total: primary === null ? null : num(primary.total_balance),
    granted: primary === null ? null : num(primary.granted_balance),
    toppedUp: primary === null ? null : num(primary.topped_up_balance),
    infos: infos.map((info) => ({
      currency: info?.currency ?? "?",
      total: num(info?.total_balance),
      granted: num(info?.granted_balance),
      toppedUp: num(info?.topped_up_balance)
    }))
  };
}

/**
 * Cordis plugin body.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {unknown} config - raw plugin config.
 */
export function apply(ctx, config) {
  const { baseURL, apiKeyEnv } = normalizeConfig(config);

  /**
   * Resolve the API key through the layered strategy in the module header.
   * Never throws.
   * @returns {Promise<{ok: true, value: string} | {ok: false, code: string, message: string}>}
   */
  const resolveKey = async () => {
    // 1) The credential seam, read through the injected service.
    try {
      const service = ctx.credentials ?? ctx.get?.("credentials");
      if (service !== undefined && service !== null && typeof service.resolve === "function") {
        const resolved = await service.resolve(apiKeyEnv);
        if (resolved !== null && resolved !== undefined && typeof resolved.value === "string" && resolved.value.length > 0) {
          return { ok: true, value: resolved.value };
        }
      }
    } catch {
      /* a failing seam degrades to the next layer rather than failing the plugin */
    }
    // 2) Inherited environment.
    const fromEnv = process.env[apiKeyEnv];
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return { ok: true, value: fromEnv.trim() };
    // 3) The local credential document.
    const fromFile = readCredentialFile(apiKeyEnv);
    if (fromFile !== undefined) return { ok: true, value: fromFile };
    return {
      ok: false,
      code: "MISSING_CREDENTIAL",
      message: `${apiKeyEnv} is not configured (checked the credential service, the environment, and ~/.dsh/.credentials.yaml)`
    };
  };

  /** One in-flight balance fetch at a time. */
  let inFlight = null;
  const fetchBalance = () => {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      const key = await resolveKey();
      if (key.ok !== true) return { ok: false, code: key.code, message: key.message };
      try {
        const response = await fetch(`${baseURL}/user/balance`, {
          headers: { Authorization: `Bearer ${key.value}` },
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) {
          return { ok: false, code: `HTTP_${response.status}`, message: `balance endpoint returned ${response.status}` };
        }
        return { ok: true, body: await response.json() };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, code: "TRANSPORT", message };
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  /** The JSON payload the browser half renders. */
  const snapshot = async () => {
    const balance = await fetchBalance();
    return {
      ok: true,
      configured: balance.ok,
      balance: balance.ok ? normalizeBalance(balance.body) : null,
      balanceError: balance.ok ? null : { code: balance.code, message: balance.message },
      updatedAt: Date.now()
    };
  };

  /** Serve the endpoint. JSON only; the key never appears in a response. */
  const handler = async (req, res) => {
    const send = async (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        await send(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
        return;
      }
      await send(200, await snapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await send(500, { ok: false, code: "INTERNAL", message });
    }
  };

  // Route registration rides the plugin fiber: unloading removes the route.
  ctx.effect(
    () => ctx.webServer.register({ kind: "exact", path: ENDPOINT_PATH, handler }),
    "dsh-deepseek-balance: balance route"
  );
}

export default { name, inject, Config, apply };
