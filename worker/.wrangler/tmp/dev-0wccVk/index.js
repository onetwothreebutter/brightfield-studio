var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var ALLOWED_ORIGIN = "https://brightfield-2.myshopify.com";
var PRINTFUL_API = "https://api.printful.com";
var PRODUCT_ID = 71;
var PRINT_WIDTH = 1800;
var PRINT_HEIGHT = 2400;
function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === "http://127.0.0.1:9292";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
var src_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/generate-mockup") {
      return handleGenerateMockup(request, env, origin);
    }
    return new Response("Not found", { status: 404 });
  }
};
async function handleGenerateMockup(request, env, origin) {
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }
  const { image, variant_id } = body;
  if (!image || !variant_id) {
    return new Response(JSON.stringify({ error: "Missing image or variant_id" }), { status: 400, headers });
  }
  const imageKey = `designs/${crypto.randomUUID()}.png`;
  const imageData = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
  await env.MOCKUP_STAGING.put(imageKey, imageData, {
    httpMetadata: { contentType: "image/png" }
  });
  const imageUrl = `https://${env.R2_PUBLIC_DOMAIN}/${imageKey}`;
  try {
    const taskRes = await fetch(`${PRINTFUL_API}/mockup-generator/create-task/${PRODUCT_ID}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.PRINTFUL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        variant_ids: [Number(variant_id)],
        format: "jpg",
        files: [{
          placement: "front",
          image_url: imageUrl,
          position: {
            area_width: PRINT_WIDTH,
            area_height: PRINT_HEIGHT,
            width: PRINT_WIDTH,
            height: PRINT_HEIGHT,
            top: 0,
            left: 0
          }
        }]
      })
    });
    const taskJson = await taskRes.json();
    if (taskJson.code !== 200) {
      throw new Error(taskJson.result || taskJson.error || JSON.stringify(taskJson));
    }
    const taskKey = taskJson.result.task_key;
    let mockupUrl = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const resultRes = await fetch(`${PRINTFUL_API}/mockup-generator/task?task_key=${taskKey}`, {
        headers: { "Authorization": `Bearer ${env.PRINTFUL_API_KEY}` }
      });
      const resultJson = await resultRes.json();
      const status = resultJson.result?.status;
      if (status === "completed") {
        mockupUrl = resultJson.result.mockups?.[0]?.mockup_url;
        break;
      }
      if (status === "failed") {
        const detail = resultJson.result?.error || JSON.stringify(resultJson.result);
        throw new Error(`Printful mockup generation failed: ${detail}`);
      }
    }
    if (!mockupUrl) {
      throw new Error("Mockup generation timed out");
    }
    return new Response(JSON.stringify({ mockup_url: mockupUrl }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, imageUrl }), { status: 500, headers });
  } finally {
    env.MOCKUP_STAGING.delete(imageKey).catch(() => {
    });
  }
}
__name(handleGenerateMockup, "handleGenerateMockup");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(sleep, "sleep");

// ../../../../../usr/local/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../usr/local/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5cw1Q4/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../../usr/local/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5cw1Q4/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
