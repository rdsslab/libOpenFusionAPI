const ACCESS_LABELS = {
  0: "Public (no authentication)",
  1: "Basic authentication",
  2: "Token authentication",
  3: "Basic + Token authentication",
  4: "Local only",
};

const ACCESS_DEFAULT = "Unknown";

const METHOD_CLASS = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
  OPTIONS: "OPTIONS",
  HEAD: "HEAD",
  QUERY: "QUERY",
  WS: "WS",
};

function accessLabel(access) {
  return ACCESS_LABELS[access] ?? ACCESS_DEFAULT;
}

function stringifySafe(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return fallback;
  }
}

function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function canonicalUrl(appname, endpoint) {
  const app = String(appname || "").toLowerCase();
  const resource = String(endpoint?.resource || "").toLowerCase();
  const env = String(endpoint?.environment || "").toLowerCase();
  return `/api/${app}${resource}/${env}`;
}

function methodClass(method) {
  const upper = String(method || "UNKNOW").toUpperCase();
  return METHOD_CLASS[upper] || "UNKNOW";
}

function enabledKeyValues(array) {
  if (!Array.isArray(array)) return [];
  return array
    .filter((item) => item && item.enabled === true && item.key && String(item.key).length > 0)
    .map((item) => ({
      key: String(item.key),
      value: item.value === undefined || item.value === null ? "" : String(item.value),
    }));
}

function bodyExamples(data_test) {
  const body = data_test?.body;
  if (!body || typeof body !== "object") return [];
  const parts = [];
  if (body.json?.code !== undefined && body.json?.code !== null) {
    const code = body.json.code;
    if (typeof code === "object" && Object.keys(code).length > 0) {
      parts.push({ label: "JSON", value: stringifySafe(code) });
    } else if (typeof code === "string" && code.trim() !== "") {
      parts.push({ label: "JSON", value: code });
    }
  }
  if (body.xml?.code) {
    parts.push({ label: "XML", value: String(body.xml.code) });
  }
  if (body.text?.value) {
    parts.push({ label: "Text", value: String(body.text.value) });
  }
  if (body.form && typeof body.form === "object" && Object.keys(body.form).length > 0) {
    parts.push({ label: "Form", value: stringifySafe(body.form) });
  }
  return parts;
}

function quoteShell(value) {
  const str = String(value ?? "");
  if (str.includes("'")) {
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;
  }
  return `'${str}'`;
}

function createCurlExample(appname, endpoint) {
  const method = String(endpoint.method || "GET").toUpperCase();
  const url = canonicalUrl(appname, endpoint);
  const lines = [`curl --request ${method}`, `  --url ${quoteShell(url)}`];

  if (Number(endpoint.access) > 0) {
    lines.push(`  --header 'Authorization: Bearer <YOUR_TOKEN>'`);
  }

  enabledKeyValues(endpoint?.data_test?.headers).forEach((header) => {
    lines.push(`  --header ${quoteShell(`${header.key}: ${header.value}`)}`);
  });

  const body = bodyExamples(endpoint?.data_test);
  if (body.length > 0) {
    lines.push(`  --header 'Content-Type: application/json'`);
    const flat = body[0].value.replace(/\s+/g, " ").trim();
    lines.push(`  --data ${quoteShell(flat)}`);
  }

  return lines.join("\n");
}

function createItemConfigEndpoint(label, value) {
  return `<div class="kv">
            <span class="kv-k">${esc(label)}</span>
            <span class="kv-v">${esc(value)}</span>
          </div>`;
}

function createKeywordChips(keywords) {
  if (typeof keywords !== "string" || keywords.trim() === "") return "";
  const chips = keywords
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => `<span class="chip">${esc(word)}</span>`)
    .join("");
  return chips ? `<div class="ep-keywords">${chips}</div>` : "";
}

function createEndpointPills(endpoint) {
  const pills = [];

  pills.push(
    `<span class="pill ${endpoint.enabled ? "on" : "off"}${
      endpoint.enabled ? "" : ""
    }">${endpoint.enabled ? "Enabled" : "Disabled"}</span>`
  );

  const isPublic = Number(endpoint.access) === 0;
  pills.push(
    `<span class="pill access">${isPublic ? "Public" : "Private"}</span>`
  );

  if (endpoint?.mcp?.enabled === true) {
    pills.push(`<span class="pill mcp">MCP Tool</span>`);
  }

  if (endpoint?.ctrl?.admin === true) {
    pills.push(`<span class="pill admin">Admin only</span>`);
  }

  return `<div class="ep-pills">${pills.join("")}</div>`;
}

function createAuthSection(endpoint) {
  const rows = [];
  rows.push(createItemConfigEndpoint("Access level", accessLabel(endpoint.access)));
  rows.push(createItemConfigEndpoint("Access type", Number(endpoint.access) === 0 ? "Public" : "Private"));
  if (endpoint?.ctrl?.admin === true) {
    rows.push(createItemConfigEndpoint("Scope", "Admin only"));
  }
  return `<section class="card-sec">
    <h4>Authentication &amp; Access</h4>
    <div class="kv-grid">
      ${rows.join("\n")}
    </div>
  </section>`;
}

function createMcpSection(endpoint) {
  const mcp = endpoint?.mcp;
  if (!mcp || mcp.enabled !== true || !mcp.name) return "";

  const rows = [];
  rows.push(createItemConfigEndpoint("Tool name", mcp.name));
  if (mcp.title) rows.push(createItemConfigEndpoint("Title", mcp.title));
  if (mcp.operation_mode) rows.push(createItemConfigEndpoint("Operation mode", mcp.operation_mode));
  if (mcp.requires_explicit_confirmation !== undefined) {
    rows.push(
      createItemConfigEndpoint(
        "Requires confirmation",
        mcp.requires_explicit_confirmation ? "Yes" : "No"
      )
    );
  }

  const notes = Array.isArray(mcp.notes)
    ? mcp.notes.map((note) => `<li>${esc(note)}</li>`).join("")
    : "";

  return `<section class="card-sec mcp">
    <h4>MCP Tool <span class="pill mcp">MCP</span></h4>
    <div class="kv-grid">${rows.join("\n")}</div>
    ${
      mcp.description
        ? `<div class="prop"><span class="prop-k">Description</span><p class="prop-v">${esc(mcp.description)}</p></div>`
        : ""
    }
    ${
      mcp.side_effects
        ? `<div class="prop"><span class="prop-k">Side effects</span><p class="prop-v">${esc(mcp.side_effects)}</p></div>`
        : ""
    }
    ${
      mcp.safe_alternative
        ? `<div class="prop"><span class="prop-k">Safe alternative</span><p class="prop-v">${esc(mcp.safe_alternative)}</p></div>`
        : ""
    }
    ${notes ? `<div class="prop"><span class="prop-k">Notes</span><ul class="notes">${notes}</ul></div>` : ""}
  </section>`;
}

function createCorsSection(endpoint) {
  const cors = endpoint?.cors;
  if (!cors || typeof cors !== "object" || Object.keys(cors).length === 0) return "";
  return `<section class="card-sec">
    <h4>CORS</h4>
    <pre class="code-block">${esc(stringifySafe(cors))}</pre>
  </section>`;
}

function createExampleSection(appname, endpoint) {
  const headers = enabledKeyValues(endpoint?.data_test?.headers);
  const query = enabledKeyValues(endpoint?.data_test?.query);
  const body = bodyExamples(endpoint?.data_test);
  const response = endpoint?.data_test?.last_response?.data;
  const hasResponse = response !== undefined && response !== null && String(response).trim() !== "";
  const curl = createCurlExample(appname, endpoint);

  if (headers.length === 0 && query.length === 0 && body.length === 0 && !hasResponse) {
    return "";
  }

  let blocks = "";

  if (headers.length > 0) {
    blocks += `<h5>Headers</h5>
      <pre class="code-block">${esc(
        headers.map((h) => `${h.key}: ${h.value}`).join("\n")
      )}</pre>`;
  }

  if (query.length > 0) {
    blocks += `<h5>Query parameters</h5>
      <pre class="code-block">${esc(
        query.map((q) => `${q.key}=${q.value}`).join("\n")
      )}</pre>`;
  }

  if (body.length > 0) {
    blocks += body
      .map(
        (part) =>
          `<h5>Request body <span class="pill access">${esc(part.label)}</span></h5>
      <pre class="code-block">${esc(part.value)}</pre>`
      )
      .join("");
  }

  if (hasResponse) {
    blocks += `<h5>Response example</h5>
      <pre class="code-block response">${esc(String(response).trim())}</pre>`;
  }

  return `<section class="card-sec">
    <h4>Request &amp; Response examples</h4>
    <h5>cURL</h5>
    <pre class="code-block">${esc(curl)}</pre>
    ${blocks}
  </section>`;
}

function createSchemaSection(endpoint) {
  const schema = endpoint?.json_schema;
  if (!schema || typeof schema !== "object") return "";

  const inSchema = schema.in?.schema;
  const outSchema = schema.out?.schema;
  if (!inSchema && !outSchema) return "";

  let blocks = "";
  if (inSchema) {
    blocks += `<details class="schema">
      <summary><span>Input schema</span><span class="pill ${schema.in?.enabled ? "on" : "off"}">${
      schema.in?.enabled ? "enabled" : "disabled"
    }</span></summary>
      <pre class="code-block">${esc(stringifySafe(inSchema))}</pre>
    </details>`;
  }
  if (outSchema) {
    blocks += `<details class="schema">
      <summary><span>Output schema</span><span class="pill ${schema.out?.enabled ? "on" : "off"}">${
      schema.out?.enabled ? "enabled" : "disabled"
    }</span></summary>
      <pre class="code-block">${esc(stringifySafe(outSchema))}</pre>
    </details>`;
  }

  return `<section class="card-sec">
    <h4>JSON Schema</h4>
    ${blocks}
  </section>`;
}

function createAiMetadata(app, serverVersion, endpoints) {
  const data = {
    "@context": "https://schema.org",
    "@type": "APIReference",
    name: app.app,
    idapp: app.idapp,
    enabled: app.enabled,
    description: app.description || "",
    libraryVersion: serverVersion,
    generatedAt: new Date().toISOString(),
    endpoints: endpoints.map((endpoint) => ({
      idendpoint: endpoint.idendpoint,
      method: String(endpoint.method || "").toUpperCase(),
      url: canonicalUrl(app.app, endpoint),
      environment: endpoint.environment,
      handler: endpoint.handler,
      enabled: endpoint.enabled,
      access: {
        code: Number(endpoint.access),
        label: accessLabel(endpoint.access),
      },
      security: Number(endpoint.access) === 0 ? "none" : "bearer",
      adminOnly: endpoint?.ctrl?.admin === true,
      cacheSeconds: endpoint.cache_time,
      timeoutSeconds: endpoint.timeout,
      title: endpoint.title || "",
      description: endpoint.description || "",
      keywords: typeof endpoint.keywords === "string"
        ? endpoint.keywords.split(",").map((k) => k.trim()).filter(Boolean)
        : [],
      mcp: {
        enabled: endpoint?.mcp?.enabled === true,
        name: endpoint?.mcp?.name || "",
        operation_mode: endpoint?.mcp?.operation_mode || "",
        requires_explicit_confirmation:
          endpoint?.mcp?.requires_explicit_confirmation === true,
      },
      hasInputSchema: Boolean(endpoint?.json_schema?.in?.schema),
      hasOutputSchema: Boolean(endpoint?.json_schema?.out?.schema),
      hasRequestHeaders: enabledKeyValues(endpoint?.data_test?.headers).length > 0,
      hasQueryParams: enabledKeyValues(endpoint?.data_test?.query).length > 0,
      hasRequestBody: bodyExamples(endpoint?.data_test).length > 0,
      hasResponseExample: Boolean(
        endpoint?.data_test?.last_response?.data &&
          String(endpoint?.data_test?.last_response?.data).trim() !== ""
      ),
    })),
  };
  return `<script type="application/json" data-ofapi="app-documentation">${stringifySafe(
    data
  ).replace(/</g, "\\u003c")}</script>`;
}

function createEndpointSummary(appname, endpoint) {
  const url = canonicalUrl(appname, endpoint);
  const title = endpoint.title ? `<h3 class="ep-title">${esc(endpoint.title)}</h3>` : "";
  const description = endpoint.description
    ? `<p class="ep-desc">${esc(endpoint.description)}</p>`
    : "";
  const keywords = createKeywordChips(endpoint.keywords);

  const meta = [];
  meta.push(createItemConfigEndpoint("Handler", endpoint.handler));
  meta.push(createItemConfigEndpoint("Environment", endpoint.environment));
  if (endpoint.timeout !== undefined && endpoint.timeout !== null) {
    meta.push(createItemConfigEndpoint("Timeout", `${endpoint.timeout} s`));
  }
  meta.push(createItemConfigEndpoint("Cache", `${endpoint.cache_time} s`));
  meta.push(createItemConfigEndpoint("Created", endpoint.createdAt));
  meta.push(createItemConfigEndpoint("Last update", endpoint.updatedAt));
  meta.push(createItemConfigEndpoint("Endpoint ID", endpoint.idendpoint));

  return `  <article class="endpoint" id="ep-${esc(endpoint.idendpoint)}" data-endpoint="1">
    <div class="ep-head">
      <span class="method method-${methodClass(endpoint.method)}">${esc(
    String(endpoint.method || "UNKNOW").toUpperCase()
  )}</span>
      <code class="ep-url">${esc(url)}</code>
      ${createEndpointPills(endpoint)}
    </div>
    ${title}
    ${description}
    ${keywords}
    <div class="kv-grid ep-meta">
      ${meta.join("\n")}
    </div>
    ${createAuthSection(endpoint)}
    ${createMcpSection(endpoint)}
    ${createExampleSection(appname, endpoint)}
    ${createSchemaSection(endpoint)}
    ${createCorsSection(endpoint)}
  </article>`;
}

function createToc(app, endpoints) {
  if (endpoints.length <= 1) return "";
  const links = endpoints
    .map((endpoint) => {
      const resource = String(endpoint.resource || "");
      const methodClassValue = methodClass(endpoint.method);
      return `<a class="toc-link" href="#ep-${esc(endpoint.idendpoint)}">
        <b class="tm tm-${methodClassValue}">${esc(
        String(endpoint.method || "UNKNOW").toUpperCase()
      )}</b>
        <span class="toc-url">${esc(resource.toLowerCase())}</span>
      </a>`;
    })
    .join("\n");
  return `<aside class="toc" aria-label="Endpoint index">
    <div class="toc-head">Endpoints <span class="toc-count">${endpoints.length}</span></div>
    ${links}
  </aside>`;
}

function createHero(app, serverVersion, endpoints) {
  const environments = [...new Set(endpoints.map((e) => e.environment).filter(Boolean))];
  const envText = environments.length > 0 ? environments.map((e) => e.toUpperCase()).join(" · ") : "—";

  return `<header class="hero" role="banner">
    <div class="wrap hero-inner">
      <div class="hero-left">
        <span class="eyebrow">OpenFusionAPI · Endpoint Documentation</span>
        <h1 class="hero-title">${esc(app.app)}</h1>
        <p class="hero-desc">${esc(app.description)}</p>
        <div class="hero-meta">
          <span class="m-item"><b>${endpoints.length}</b> endpoint${
    endpoints.length === 1 ? "" : "s"
  }</span>
          <span class="m-item"><b>${esc(envText)}</b></span>
          <span class="m-item">libOpenFusionAPI <b>${esc(serverVersion)}</b></span>
        </div>
      </div>
      <div class="hero-side">
        <span class="hero-badge ${app.enabled ? "on" : "off"}">${
    app.enabled ? "Enabled" : "Disabled"
  }</span>
        <div class="hero-id">
          <span class="lbl">App ID</span>
          <code>${esc(app.idapp)}</code>
          <span class="lbl">Created</span>
          <code>${esc(app.createdAt)}</code>
        </div>
      </div>
    </div>
  </header>`;
}

function createHtmlDocument(app, serverVersion, toc, bodyHtml) {
  const appname = app.app || "";
  const aiMetadata = createAiMetadata(app, serverVersion, app.endpoints || []);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="generator" content="OpenFusionAPI Documentation" />
    <title>${esc(appname)} · API Documentation</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :root {
        --brand: #F06000;
        --brand-deep: #B23E00;
        --brand-soft: #FF7A00;
        --grad-1: #FF7A00;
        --grad-2: #F05000;
        --bg: #FDF7F1;
        --card: #FFFFFF;
        --line: #FFD7B8;
        --line-strong: #FFB887;
        --text: #2B1A0C;
        --muted: #8A6740;
        --dim: #B08968;
        --on-accent: #FFFFFF;
        --code-bg: #261407;
        --code-text: #FFE7D2;
        --code-line: #3A2010;
        --radius: 14px;
        --radius-sm: 10px;
        --mono: ui-monospace, SFMono-Regular, "Cascadia Mono", "Liberation Mono", Consolas, Menlo, monospace;
        font-synthesis: none;
      }
      html { scroll-behavior: smooth; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        background: var(--bg);
        color: var(--text);
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }

      /* Hero */
      .hero {
        background: linear-gradient(120deg, var(--grad-1) 0%, var(--grad-2) 100%);
        color: var(--on-accent);
        padding: 44px 0 38px;
      }
      .hero-inner { display: flex; gap: 28px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
      .hero-left { flex: 1 1 560px; min-width: 280px; }
      .eyebrow {
        display: inline-block;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.82);
        background: rgba(0, 0, 0, 0.16);
        padding: 5px 12px;
        border-radius: 999px;
        margin-bottom: 16px;
      }
      .hero-title { font-size: 2.6rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; margin-bottom: 10px; }
      .hero-desc { font-size: 1.02rem; color: rgba(255, 255, 255, 0.92); max-width: 640px; margin-bottom: 18px; }
      .hero-meta { display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; color: rgba(255,255,255,0.85); }
      .m-item b { color: #fff; font-weight: 800; }
      .hero-side { flex: 0 0 auto; text-align: right; }
      .hero-badge {
        display: inline-block;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border-radius: 999px;
        padding: 6px 14px;
        margin-bottom: 14px;
        background: rgba(0,0,0,0.22);
        color: #fff;
      }
      .hero-badge.on { background: rgba(255,255,255,0.92); color: var(--brand-deep); }
      .hero-id { display: grid; gap: 3px; }
      .hero-id .lbl { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.78; color: #fff; }
      .hero-id code {
        font-family: var(--mono);
        font-size: 12px;
        color: #fff;
        background: rgba(0,0,0,0.2);
        padding: 3px 8px;
        border-radius: 6px;
        display: inline-block;
        word-break: break-all;
      }

      /* Layout */
      .layout { display: grid; grid-template-columns: 240px 1fr; gap: 28px; align-items: start; padding: 28px 0 40px; }
      .main { min-width: 0; }

      /* TOC */
      .toc { position: sticky; top: 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); padding: 12px; }
      .toc-head {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--muted); margin-bottom: 8px; padding: 0 4px;
      }
      .toc-count {
        background: var(--brand); color: #fff; border-radius: 999px;
        font-size: 11px; padding: 1px 8px;
      }
      .toc-link {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 8px; border-radius: 8px;
        text-decoration: none; color: var(--muted);
        font-size: 13px; font-family: var(--mono);
        transition: background 120ms ease, color 120ms ease;
      }
      .toc-link:hover { background: #FFF1E3; color: var(--brand-deep); }
      .toc-link .toc-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tm {
        flex-shrink: 0; min-width: 40px; text-align: center;
        font-family: var(--mono); font-size: 10px; font-weight: 800; color: #fff;
        border-radius: 6px; padding: 2px 6px;
      }

      /* Method colors */
      .method-GET, .tm-GET { background: #0EA47A; }
      .method-POST, .tm-POST { background: #1D6FF2; }
      .method-PUT, .tm-PUT { background: #E08500; }
      .method-PATCH, .tm-PATCH { background: #845EF7; }
      .method-DELETE, .tm-DELETE { background: #E5484D; }
      .method-OPTIONS, .method-HEAD, .method-QUERY, .method-WS, .method-UNKNOW,
      .tm-OPTIONS, .tm-HEAD, .tm-QUERY, .tm-WS, .tm-UNKNOW { background: #5B7186; }

      /* Endpoint card */
      .endpoint {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 22px 24px;
        margin-bottom: 22px;
        box-shadow: 0 1px 2px rgba(176, 96, 32, 0.06);
        break-inside: avoid;
      }
      .ep-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .method {
        display: inline-block; color: #fff;
        font-family: var(--mono); font-weight: 800; font-size: 12px; letter-spacing: 0.05em;
        border-radius: 8px; padding: 5px 12px;
      }
      .ep-url { font-family: var(--mono); font-size: 15px; color: var(--brand-deep); word-break: break-all; }
      .ep-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
      .pill {
        display: inline-flex; align-items: center; border-radius: 999px;
        padding: 4px 10px; font-size: 11px; font-weight: 700; white-space: nowrap;
      }
      .pill.on { background: #E2F3E9; color: #0B6B3A; }
      .pill.off { background: #FBE4E4; color: #A81F13; }
      .pill.access { background: #FFE9D4; color: #9A3E00; }
      .pill.mcp { background: #E7EEFF; color: #1D4ED8; }
      .pill.admin { background: #F4E8FF; color: #7C3AED; }

      .ep-title { font-size: 19px; font-weight: 800; margin-top: 16px; }
      .ep-desc { color: var(--muted); font-size: 14.5px; margin-top: 8px; }
      .ep-keywords { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
      .chip {
        background: #FFF1E3; color: var(--brand-deep);
        border: 1px solid var(--line);
        border-radius: 999px; font-size: 11.5px; font-weight: 600;
        padding: 3px 10px;
      }

      /* Key/value grid */
      .kv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
      .ep-meta { margin-top: 16px; }
      .kv { background: #FFFDFA; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 9px 12px; }
      .kv-k {
        display: block; font-size: 10.5px; text-transform: uppercase;
        letter-spacing: 0.07em; color: var(--muted); margin-bottom: 4px; font-weight: 700;
      }
      .kv-v { font-size: 13px; color: var(--text); font-weight: 600; word-break: break-all; }

      /* Card sections */
      .card-sec { margin-top: 20px; padding-top: 18px; border-top: 1px dashed var(--line-strong); }
      .card-sec h4 {
        font-size: 13px; font-weight: 800; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--muted);
        display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
      }
      .card-sec h5 { font-size: 13px; font-weight: 700; color: var(--brand-deep); margin: 12px 0 6px; }
      .card-sec .kv-grid { margin: 0 0 10px; }

      .prop { margin: 10px 0; }
      .prop-k {
        display: block; font-size: 10.5px; text-transform: uppercase;
        letter-spacing: 0.07em; color: var(--muted); font-weight: 700; margin-bottom: 4px;
      }
      .prop-v { font-size: 13.5px; color: var(--text); white-space: pre-wrap; }
      .notes { margin: 4px 0 0 18px; color: var(--text); font-size: 13.5px; }
      .notes li { margin: 3px 0; }

      /* Code */
      .code-block {
        background: var(--code-bg); color: var(--code-text);
        border: 1px solid var(--code-line);
        border-radius: var(--radius-sm);
        padding: 14px 16px;
        font-family: var(--mono); font-size: 12.5px; line-height: 1.55;
        overflow: auto; white-space: pre-wrap; word-break: break-word;
        margin: 4px 0 8px;
      }
      .code-block.response { border-color: #2E7D32; }

      /* Schema details */
      details.schema {
        border: 1px solid var(--line); border-radius: var(--radius-sm);
        background: #FFFDFA; margin: 8px 0; overflow: hidden;
      }
      details.schema summary {
        display: flex; align-items: center; justify-content: space-between;
        cursor: pointer; list-style: none; padding: 10px 14px;
        font-weight: 700; font-size: 13.5px; color: var(--text);
      }
      details.schema summary::-webkit-details-marker { display: none; }
      details.schema summary::after { content: "+"; color: var(--brand); font-weight: 800; }
      details.schema[open] summary::after { content: "–"; }
      details.schema .code-block { border: none; border-top: 1px solid var(--line); border-radius: 0; margin: 0; }

      /* Footer */
      .footer { text-align: center; font-size: 12.5px; color: var(--muted); padding: 8px 0 40px; }

      @media (max-width: 860px) {
        .layout { grid-template-columns: 1fr; }
        .toc { position: static; }
        .hero-title { font-size: 2rem; }
        .hero-side { text-align: left; }
      }

      @media print {
        body { background: #fff; color: #000; }
        .hero { background: #fff !important; color: #000; border-bottom: 2px solid var(--brand); }
        .hero .eyebrow, .hero-meta, .hero-badge { color: #000 !important; }
        .hero-meta b, .hero-title { color: #000 !important; }
        .hero-id code { color: #000; background: #f3f3f3; }
        .hero-desc { color: #333; }
        .toc { display: none; }
        .layout { display: block; }
        .endpoint { box-shadow: none; page-break-inside: avoid; }
        .code-block { background: #f5f0ea; color: #222; border: 1px solid #ddd; }
        .kv { background: #fff; border-color: #e0d8cf; }
        .card-sec { border-top-color: #e0d8cf; }
      }
    </style>
  </head>
  <body>
    ${createHero(app, serverVersion, app.endpoints || [])}

    <div class="wrap layout">
      ${toc}
      <main class="main">
        <section aria-label="Endpoints">
          ${bodyHtml}
        </section>
        <footer class="footer">
          Generated by OpenFusionAPI · libOpenFusionAPI ${esc(serverVersion)}
        </footer>
      </main>
    </div>

    ${aiMetadata}
  </body>
</html>
`;
}

export const generateDocumentation = (
  app,
  serverVersion,
  endpoints_to_document
) => {
  let appEndpoints = Array.isArray(app.endpoints) ? app.endpoints.slice() : [];

  if (Array.isArray(endpoints_to_document) && endpoints_to_document.length > 0) {
    appEndpoints = appEndpoints.filter((endpoint) => {
      return endpoints_to_document.includes(endpoint.idendpoint);
    });
  }

  const bodyHtml = appEndpoints
    .map((endpoint) => createEndpointSummary(app.app, endpoint))
    .join("\n");

  const toc = createToc(app, appEndpoints);
  return createHtmlDocument(app, serverVersion, toc, bodyHtml);
};