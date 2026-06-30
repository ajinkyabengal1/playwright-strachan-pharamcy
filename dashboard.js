const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}: ${e.message}`)); }
      });
    }).on("error", reject);
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard-public")));
app.use("/test-results", express.static(path.join(__dirname, "test-results")));
app.use("/trace-viewer", express.static(path.join(__dirname, "node_modules/playwright-core/lib/vite/traceViewer")));

const TEST_DATA_PATH = path.join(__dirname, "tests/fixtures/test-data.ts");
const PHARMACIES_PATH = path.join(__dirname, "tests/fixtures/pharmacies.ts");

// ── Pharmacy + test discovery ─────────────────────────────────────────────────

function readPharmacies() {
  const src = fs.readFileSync(PHARMACIES_PATH, "utf8");
  const list = [];
  const re = /\{\s*name:\s*"([^"]+)"\s*,\s*baseURL:\s*"([^"]+)"(?:\s*,\s*ciSkip:\s*(true|false))?,?\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    list.push({ name: m[1], baseURL: m[2], ciSkip: m[3] === "true" });
  }
  return list;
}

let _testListCache = null;
let _testListCacheAt = 0;
const TEST_LIST_TTL_MS = 30_000;
let lastRunStartTime = 0;

function flattenSuites(suites, parentTitles = [], depth = 0) {
  const out = [];
  for (const s of suites || []) {
    // Skip file-level suite title (depth 0); keep describe titles
    const titles = depth === 0 ? parentTitles : [...parentTitles, s.title].filter(Boolean);
    for (const spec of s.specs || []) {
      out.push({
        title: spec.title,
        fullTitle: [...titles, spec.title].filter(Boolean).join(" > "),
        file: spec.file || s.file || "",
        line: spec.line || 0,
      });
    }
    if (s.suites) out.push(...flattenSuites(s.suites, titles, depth + 1));
  }
  return out;
}

function listTests() {
  if (_testListCache && Date.now() - _testListCacheAt < TEST_LIST_TTL_MS) {
    return Promise.resolve(_testListCache);
  }
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["playwright", "test", "--list", "--reporter=json"], {
      cwd: __dirname,
      env: { ...process.env },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c.toString()));
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("close", () => {
      try {
        const json = JSON.parse(out);
        // Dedupe by fullTitle (same test repeats per project)
        const all = flattenSuites(json.suites || []);
        const seen = new Set();
        const unique = [];
        for (const t of all) {
          const key = `${t.file}::${t.fullTitle}`;
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(t);
          }
        }
        _testListCache = unique;
        _testListCacheAt = Date.now();
        resolve(unique);
      } catch (e) {
        reject(new Error(`Failed to list tests: ${e.message}\n${err}`));
      }
    });
  });
}

// ── Per-pharmacy Sanity configuration ─────────────────────────────────────────
// Three config shapes:
//   usePharmacyNameFilter: true  — resolve corporateIds via a name keyword lookup (Strachans)
//   query: "..."                 — run a raw GROQ query (Health Check)
//   corporateId: <number>        — filter by a known corporateId in the shared healthya project
const HEALTHYA_SANITY_BASE = "https://avnvku5j.api.sanity.io/v2023-01-01/data/query/production";

const PHARMACY_SANITY_CONFIGS = {
  // ── Strachans (own Sanity project, corporateId resolved by name) ───────────
  "strachans-pharamcy.healthya.co.uk": {
    sanityBase: "https://gnx5auvv.api.sanity.io/v2026-06-15/data/query/dev",
    usePharmacyNameFilter: true,
    keyword: "strachans",
  },

  // ── Health Check (own Sanity project, raw query) ───────────────────────────
  "health-check-pharmacy.vercel.app": {
    sanityBase: "https://fsri74r8.api.sanity.io/v2026-06-29/data/query/dev",
    query: `*[_type == "singleCondition" && conditionLogStatus == "active" && !(_id in path("drafts.**"))]{title, "conditionSlug": conditionSlug.current}`,
  },

  // ── Shared healthya.co.uk pharmacies (project avnvku5j, filtered by corporateId) ──
  "werneth.healthya.co.uk":       { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1102 },
  "hunts-cross.healthya.co.uk":   { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1098 },
  "edgeley.healthya.co.uk":       { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1090 },
  "liverpool-road.healthya.co.uk":{ sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1105 },
  "tupton.healthya.co.uk":        { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1073 },
  "allestree.healthya.co.uk":     { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1076 },
  "holmewood.healthya.co.uk":     { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1096 },
  "harehills.healthya.co.uk":     { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1099 },
  "talbot-road.healthya.co.uk":   { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1072 },
  "brunshaw.healthya.co.uk":      { sanityBase: HEALTHYA_SANITY_BASE, corporateId: 1083 },
};

// ── Flow configs (mirrors flow-configs.ts — JS copy for dashboard) ────────────
const FLOW_CONFIGS = [
  { name: "NHS — next available slot",              group: "NHS",     conditionJourneyType: "nhs" },
  { name: "NHS — specific date and time",           group: "NHS",     conditionJourneyType: "nhs" },
  { name: "Private — next available slot, new card",  group: "Private", conditionJourneyType: "private" },
  { name: "Private — next available slot, saved card", group: "Private", conditionJourneyType: "private" },
  { name: "Private — specific date, new card",      group: "Private", conditionJourneyType: "private" },
  { name: "Private — specific date, saved card",    group: "Private", conditionJourneyType: "private" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readTestData() {
  const src = fs.readFileSync(TEST_DATA_PATH, "utf8");

  const get = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*"([^"]+)"`));
    return m ? m[1] : "";
  };
  const getNum = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*(\\d+)`));
    return m ? parseInt(m[1]) : 0;
  };
  const getBool = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*(true|false)`));
    return m ? m[1] === "true" : false;
  };

  // Active condition — find the uncommented journeyType line inside ACTIVE_CONDITION
  const activeCondBlock = src.match(/ACTIVE_CONDITION\s*=\s*\{([^}]+)\}/s);
  let journeyType = "nhs";
  if (activeCondBlock) {
    const uncommented = activeCondBlock[1]
      .split("\n")
      .find((l) => l.includes("journeyType") && !l.trim().startsWith("//"));
    if (uncommented) {
      const jm = uncommented.match(/"(nhs|private|lifestyle)"/);
      if (jm) journeyType = jm[1];
    }
  }

  return {
    user: {
      gender: get("gender"),
      firstName: get("firstName"),
      lastName: get("lastName"),
      postcode: get("postcode"),
      email: get("email"),
      phone: get("phone"),
      guardianName: get("guardianName"),
      dobDay: get("day"),
      dobMonth: get("month"),
      dobYear: get("year"),
    },
    condition: { journeyType },
    booking: {
      appointmentType: get("appointmentType"),
      useNextAvailableSlot: getBool("useNextAvailableSlot"),
      preferredMonth: get("preferredMonth"),
      preferredDate: get("preferredDate"),
      preferredTime: get("preferredTime"),
      autoMoveToNextDate: getBool("autoMoveToNextDate"),
      maxDateAttempts: getNum("maxDateAttempts"),
    },
    pharmacy: {
      preferredBranch: get("preferredBranch"),
    },
  };
}

function writeTestData(data) {
  let src = fs.readFileSync(TEST_DATA_PATH, "utf8");

  const setStr = (key, val) => {
    src = src.replace(new RegExp(`(${key}:\\s*)"[^"]*"`), `$1"${val}"`);
  };
  const setBool = (key, val) => {
    src = src.replace(
      new RegExp(`(${key}:\\s*)(true|false)`),
      `$1${val ? "true" : "false"}`
    );
  };
  const setNum = (key, val) => {
    src = src.replace(new RegExp(`(${key}:\\s*)\\d+`), `$1${val}`);
  };

  const u = data.user;
  setStr("gender", u.gender);
  setStr("firstName", u.firstName);
  setStr("lastName", u.lastName);
  setStr("postcode", u.postcode);
  setStr("email", u.email);
  setStr("phone", u.phone);
  setStr("guardianName", u.guardianName);
  // DOB
  src = src.replace(/(day:\s*)"[^"]*"/, `$1"${u.dobDay}"`);
  src = src.replace(/(month:\s*)"[^"]*"/, `$1"${u.dobMonth}"`);
  src = src.replace(/(year:\s*)"[^"]*"/, `$1"${u.dobYear}"`);
  // ISO and display derived
  const iso = `${u.dobYear}-${u.dobMonth.padStart(2, "0")}-${u.dobDay.padStart(2, "0")}`;
  const display = `${u.dobDay.padStart(2, "0")}/${u.dobMonth.padStart(2, "0")}/${u.dobYear}`;
  src = src.replace(/(iso:\s*)"[^"]*"/, `$1"${iso}"`);
  src = src.replace(/(display:\s*)"[^"]*"/, `$1"${display}"`);

  const b = data.booking;
  setStr("appointmentType", b.appointmentType);
  setBool("useNextAvailableSlot", b.useNextAvailableSlot);
  setStr("preferredMonth", b.preferredMonth || "");
  setStr("preferredDate", b.preferredDate || "");
  setStr("preferredTime", b.preferredTime || "");
  setBool("autoMoveToNextDate", b.autoMoveToNextDate);
  setNum("maxDateAttempts", b.maxDateAttempts);

  const ph = data.pharmacy || {};
  setStr("preferredBranch", ph.preferredBranch || "");

  // Active condition — comment out all, uncomment chosen
  const jt = data.condition.journeyType;
  src = src.replace(
    /(ACTIVE_CONDITION\s*=\s*\{[^}]*\})/s,
    (block) => {
      return block
        .replace(/^\s*\/\/\s*(journeyType:\s*"(?:nhs|private|lifestyle)"[^,\n]*),?\s*$/gm, (line) => {
          const m = line.match(/"(nhs|private|lifestyle)"/);
          if (m && m[1] === jt) return line.replace(/^(\s*)\/\/\s*/, "$1");
          return line;
        })
        .replace(/^(\s*)(journeyType:\s*"(?:nhs|private|lifestyle)"[^,\n]*),?(\s*)$/gm, (line, indent, content, trail) => {
          const m = line.match(/"(nhs|private|lifestyle)"/);
          if (m && m[1] !== jt) return `${indent}// ${content},${trail}`;
          return line;
        });
    }
  );

  fs.writeFileSync(TEST_DATA_PATH, src, "utf8");
}

// ── Playwright UI process ─────────────────────────────────────────────────────

const UI_PORT = 8081;
let uiProc = null;
let uiReady = false;

function launchUI() {
  if (uiProc) return { already: true };

  uiReady = false;
  uiProc = spawn(
    "npx",
    ["playwright", "test", "--ui", `--ui-host=127.0.0.1`, `--ui-port=${UI_PORT}`],
    { cwd: __dirname, env: { ...process.env } }
  );

  const onData = (chunk) => {
    const text = chunk.toString();
    if (text.includes("listening") || text.includes(String(UI_PORT)) || text.includes("Listening")) {
      uiReady = true;
    }
  };

  uiProc.stdout.on("data", onData);
  uiProc.stderr.on("data", onData);

  // Give it time to boot even if we miss the log line
  setTimeout(() => { uiReady = true; }, 4000);

  uiProc.on("close", () => {
    uiProc = null;
    uiReady = false;
  });

  return { started: true };
}

function stopUI() {
  if (!uiProc) return { already: true };
  uiProc.kill();
  uiProc = null;
  uiReady = false;
  return { stopped: true };
}

// ── Artifact discovery ───────────────────────────────────────────────────────

function findArtifactsAfter(since) {
  const dir = path.join(__dirname, "test-results");
  const artifacts = { videos: [], traces: [] };
  if (!fs.existsSync(dir)) return artifacts;

  function scan(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) scan(full);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs >= since) {
            const url = "/" + path.relative(__dirname, full).replace(/\\/g, "/");
            if (entry.name.endsWith(".webm")) artifacts.videos.push(url);
            else if (entry.name === "trace.zip") artifacts.traces.push(url);
          }
        } catch (_) {}
      }
    }
  }

  scan(dir);
  return artifacts;
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/test-data", (req, res) => {
  try {
    res.json(readTestData());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sanity-conditions", async (req, res) => {
  try {
    const baseURL = req.query.baseURL;
    let sanityConditions = [];

    if (baseURL) {
      let hostname;
      try { hostname = new URL(baseURL).hostname; } catch (_) {}

      const config = hostname && PHARMACY_SANITY_CONFIGS[hostname];
      if (!config) return res.json({ result: [] });

      if (config.corporateId != null) {
        // Direct corporateId filter — shared healthya project
        const q = `*[_type == "singleCondition" && corporateId == ${config.corporateId} && conditionLogStatus == "active"]{title, "conditionSlug": conditionSlug.current}`;
        const condData = await httpGetJson(`${config.sanityBase}?query=${encodeURIComponent(q)}`);
        sanityConditions = condData.result || [];
      } else if (config.usePharmacyNameFilter) {
        // Two-step: resolve corporateIds from Sanity pharmacy docs by name, then filter conditions
        const pharmData = await httpGetJson(
          `${config.sanityBase}?query=${encodeURIComponent('*[_type == "pharmacies"]{name, corporateId}')}&perspective=drafts`
        );
        const ids = (pharmData.result || [])
          .filter((p) => p.name && p.name.toLowerCase().includes(config.keyword || ""))
          .map((p) => p.corporateId);

        if (ids.length === 0) return res.json({ result: [] });

        const condQuery = `*[_type == "singleCondition" && corporateId in [${ids.join(",")}]]{title, "conditionSlug": conditionSlug.current}`;
        const condData = await httpGetJson(`${config.sanityBase}?query=${encodeURIComponent(condQuery)}&perspective=drafts`);
        sanityConditions = condData.result || [];
      } else {
        // Direct raw GROQ query (Health Check and similar)
        const condData = await httpGetJson(
          `${config.sanityBase}?query=${encodeURIComponent(config.query)}&perspective=drafts`
        );
        sanityConditions = condData.result || [];
      }
    } else {
      // No baseURL — fall back to all conditions from default project
      const fallbackQuery = `*[_type == "singleCondition"]{title, "conditionSlug": conditionSlug.current}`;
      const condData = await httpGetJson(
        `https://gnx5auvv.api.sanity.io/v2026-06-15/data/query/dev?query=${encodeURIComponent(fallbackQuery)}&perspective=drafts`
      );
      sanityConditions = condData.result || [];
    }

    // Deduplicate by slug
    const result = [];
    const seenSlugs = new Set();
    for (const sc of sanityConditions) {
      if (sc.conditionSlug && !seenSlugs.has(sc.conditionSlug)) {
        seenSlugs.add(sc.conditionSlug);
        result.push({ title: sc.title, slug: sc.conditionSlug });
      }
    }

    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/branches", async (req, res) => {
  try {
    const baseURL = req.query.baseURL;
    if (!baseURL) return res.json({ branches: [] });

    const html = await new Promise((resolve, reject) => {
      https.get(baseURL, (r) => {
        let raw = "";
        r.on("data", (c) => (raw += c));
        r.on("end", () => resolve(raw));
      }).on("error", reject);
    });

    const seen = new Set();
    const branches = [];
    const re = /href="\/([^/"]+)\/conditions\/[^"]+"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const slug = m[1];
      if (!seen.has(slug)) {
        seen.add(slug);
        const name = slug
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
          .replace(/\bChemist\b/, "Chemist -");
        branches.push({ slug, name });
      }
    }

    res.json({ branches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/test-data", (req, res) => {
  try {
    writeTestData(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/flow-configs", (_req, res) => {
  res.json(FLOW_CONFIGS);
});

app.get("/api/pharmacies", (_req, res) => {
  try {
    res.json(readPharmacies());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/tests", async (_req, res) => {
  try {
    const tests = await listTests();
    res.json(tests);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SSE stream for running tests
app.get("/api/run-tests", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  const grep = req.query.grep;
  const project = req.query.project;
  const file = req.query.file;
  const line = req.query.line;
  const label = req.query.label;
  const parts = [];
  if (project) parts.push(project);
  parts.push(label || (file ? `${file}${line ? ":" + line : ""}` : "all tests"));
  send("start", `Starting Playwright — ${parts.join(" · ")}...`);

  const runStartTime = Date.now();
  lastRunStartTime = runStartTime;

  const outputDir = `test-results/run-${runStartTime}`;
  const args = ["playwright", "test", "--reporter=list", `--output=${outputDir}`];
  if (project) args.push(`--project=${project}`);
  // Prefer file:line targeting. Also allow grep within a file if no line number.
  if (file) {
    args.push(line ? `${file}:${line}` : file);
    if (grep && !line) args.push("--grep", grep);
  } else if (grep) {
    args.push("--grep", grep);
  }

  const envParams = { ...process.env };
  if (req.query.slug) {
    envParams.CONDITION_SLUG = req.query.slug;
    envParams.CONDITION_LABEL = req.query.label || req.query.slug;
    // Calculate iteration number from the store
    const storeEntry = conditionApiStore[req.query.slug];
    const iterNum = storeEntry ? storeEntry.iterations.length : 1;
    envParams.ITERATION_NUMBER = String(iterNum);
  }

  const proc = spawn("npx", args, {
    cwd: __dirname,
    env: envParams,
  });

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    text.split("\n").forEach((line) => {
      if (line.trim()) send("log", line);
    });
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    text.split("\n").forEach((line) => {
      if (line.trim()) send("log", line);
    });
  });

  proc.on("close", (code) => {
    const passed = (stdout.match(/\d+ passed/)?.[0] || "").trim();
    const failed = (stdout.match(/\d+ failed/)?.[0] || "").trim();
    const skipped = (stdout.match(/\d+ skipped/)?.[0] || "").trim();
    const artifacts = findArtifactsAfter(runStartTime - 1000);
    send("done", { code, passed, failed, skipped, success: code === 0, artifacts });
    res.end();
  });

  req.on("close", () => proc.kill());
});

app.get("/api/latest-artifacts", (req, res) => {
  res.json(findArtifactsAfter(lastRunStartTime - 1000));
});

app.post("/api/launch-ui", (req, res) => {
  try {
    writeTestData(req.body);
  } catch (_) {}
  res.json({ ...launchUI(), port: UI_PORT });
});

app.post("/api/stop-ui", (_req, res) => {
  res.json(stopUI());
});

app.get("/api/ui-status", (_req, res) => {
  res.json({ running: !!uiProc, ready: uiReady, port: UI_PORT });
});

app.get("/api/last-result", (req, res) => {
  const lastRun = path.join(__dirname, "test-results/.last-run.json");
  if (fs.existsSync(lastRun)) {
    res.json(JSON.parse(fs.readFileSync(lastRun, "utf8")));
  } else {
    res.json(null);
  }
});

// ── Serve dashboard ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard-public/index.html"));
});

// ── Condition API Tracking Store ────────────────────────────────────────────
const conditionApiStore = {};
let apiStreamClients = [];
let apiCallIdSeq = 0;

function broadcastApiEvent(event) {
  const data = JSON.stringify(event);
  apiStreamClients = apiStreamClients.filter(client => {
    try {
      client.write(`data: ${data}\n\n`);
      return true;
    } catch (e) {
      return false;
    }
  });
}

// SSE endpoint for real-time API call events
app.get("/api/api-call-stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  apiStreamClients.push(res);
  req.on("close", () => {
    apiStreamClients = apiStreamClients.filter(c => c !== res);
  });
});

// Track a single API call
app.post("/api/track-api-call", (req, res) => {
  const { conditionId, conditionName, iterationNumber, apiCall } = req.body;
  if (!conditionId || !iterationNumber || !apiCall) {
    return res.status(400).json({ error: "conditionId, iterationNumber, and apiCall are required" });
  }

  // Ensure condition entry exists
  if (!conditionApiStore[conditionId]) {
    conditionApiStore[conditionId] = { conditionName: conditionName || conditionId, iterations: [] };
  }

  // Find or create the iteration
  let iteration = conditionApiStore[conditionId].iterations.find(
    it => it.iterationNumber === iterationNumber
  );
  if (!iteration) {
    iteration = {
      iterationNumber,
      timestamp: new Date().toISOString(),
      status: "running",
      apiCalls: [],
    };
    conditionApiStore[conditionId].iterations.push(iteration);
  }

  const enrichedCall = {
    ...apiCall,
    id: `api-${++apiCallIdSeq}`,
    timestamp: new Date().toISOString(),
  };
  iteration.apiCalls.push(enrichedCall);

  const event = {
    type: "api-call",
    conditionId,
    conditionName: conditionApiStore[conditionId].conditionName,
    iterationNumber,
    apiCall: enrichedCall,
  };
  broadcastApiEvent(event);

  res.json({ success: true, apiCall: enrichedCall });
});

// Get API calls for a specific condition
app.get("/api/condition-api-calls/:conditionId", (req, res) => {
  const entry = conditionApiStore[req.params.conditionId];
  if (!entry) {
    return res.status(404).json({ error: "Condition not found" });
  }
  res.json(entry);
});

// Get all stored conditions
app.get("/api/condition-api-calls", (req, res) => {
  res.json(conditionApiStore);
});

// Start an iteration
app.post("/api/start-iteration", (req, res) => {
  const { conditionId, conditionName, iterationNumber } = req.body;
  if (!conditionId || !iterationNumber) {
    return res.status(400).json({ error: "conditionId and iterationNumber are required" });
  }

  if (!conditionApiStore[conditionId]) {
    conditionApiStore[conditionId] = { conditionName: conditionName || conditionId, iterations: [] };
  }

  // Remove existing iteration with the same number (if re-running)
  conditionApiStore[conditionId].iterations = conditionApiStore[conditionId].iterations.filter(
    it => it.iterationNumber !== iterationNumber
  );

  const iteration = {
    iterationNumber,
    timestamp: new Date().toISOString(),
    status: "running",
    apiCalls: [],
  };
  conditionApiStore[conditionId].iterations.push(iteration);

  // Update condition name if provided
  if (conditionName) {
    conditionApiStore[conditionId].conditionName = conditionName;
  }

  broadcastApiEvent({
    type: "iteration-start",
    conditionId,
    conditionName: conditionApiStore[conditionId].conditionName,
    iterationNumber,
  });

  res.json({ success: true, iteration });
});

// End an iteration
app.post("/api/end-iteration", (req, res) => {
  const { conditionId, iterationNumber, status } = req.body;
  if (!conditionId || !iterationNumber || !status) {
    return res.status(400).json({ error: "conditionId, iterationNumber, and status are required" });
  }

  const entry = conditionApiStore[conditionId];
  if (!entry) {
    return res.status(404).json({ error: "Condition not found" });
  }

  const iteration = entry.iterations.find(it => it.iterationNumber === iterationNumber);
  if (!iteration) {
    return res.status(404).json({ error: "Iteration not found" });
  }

  iteration.status = status;

  broadcastApiEvent({
    type: "iteration-end",
    conditionId,
    conditionName: entry.conditionName,
    iterationNumber,
    status,
    totalApiCalls: iteration.apiCalls.length,
  });

  res.json({ success: true, iteration });
});

// Clear stored API call data
app.post("/api/clear-api-calls", (req, res) => {
  const { conditionId } = req.body || {};
  if (conditionId) {
    delete conditionApiStore[conditionId];
    broadcastApiEvent({ type: "clear", conditionId });
  } else {
    for (const key of Object.keys(conditionApiStore)) {
      delete conditionApiStore[key];
    }
    broadcastApiEvent({ type: "clear-all" });
  }
  res.json({ success: true });
});

const PORT = 7890;
app.listen(PORT, () => {
  console.log(`\n  Dashboard running at http://localhost:${PORT}\n`);
});
