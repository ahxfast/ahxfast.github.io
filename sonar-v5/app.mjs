const required = ["schema_version", "generation", "producer_instance", "config_hash",
  "feature_version", "publication_started_at_ms", "published_at_ms", "health", "watch"];

export function decodeGeneration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid generation");
  // Realtime Database elides empty objects, including an intentionally empty
  // actionable rows map in the private research beta.
  const rows = value.rows === undefined ? {} : value.rows;
  const signalHistory = value.signal_history === undefined ? [] : value.signal_history;
  if (required.some((key) => !(key in value)) || value.schema_version !== 5 ||
      !Number.isInteger(value.generation) || value.generation < 1 ||
      !Number.isInteger(value.published_at_ms) || value.published_at_ms < 0 ||
      !rows || typeof rows !== "object" || Array.isArray(rows) ||
      Object.keys(rows).length > 10 || !Array.isArray(signalHistory) ||
      signalHistory.length > 10) throw new Error("Unsupported or incomplete V5 generation");
  for (const [key, row] of Object.entries(rows)) {
    if (!row || row.setup_id !== key || row.direction !== "SHORT" ||
        row.eligibility_profile !== "STRICT_70" ||
        !["ARMED", "TRIGGERED"].includes(row.state) || row.actionable !== true ||
        !Number.isFinite(row.perc48) || !Number.isFinite(row.rsi14_4h_closed) ||
        row.rsi14_4h_closed < 70 || !Number.isFinite(row.rank_score) || row.rank_score < 65 ||
        !Number.isInteger(row.valid_until_ms) || !Number.isInteger(row.observed_at_ms) ||
        !row.quality || row.quality.verdict !== "PASS" || !row.entry_condition ||
        !row.invalidation || !Array.isArray(row.targets) || row.targets.length === 0 ||
        !row.source_times || !row.idea_text) throw new Error("Invalid actionable V5 row");
  }
  for (const signal of signalHistory) {
    if (!signal || typeof signal !== "object" ||
        typeof signal.signal_id !== "string" ||
        typeof signal.instrument_id !== "string" ||
        !["ARMED", "TRIGGERED"].includes(signal.state) ||
        !Number.isInteger(signal.observed_at_ms) ||
        !signal.entry_range || !signal.entry_condition || !signal.invalidation ||
        !Array.isArray(signal.targets) || signal.targets.length !== 1 ||
        !signal.quality || typeof signal.tick_size !== "string" ||
        (signal.early_partial != null && typeof signal.early_partial !== "string")) {
      throw new Error("Invalid archived V5 signal");
    }
  }
  return { ...value, rows, signal_history: signalHistory };
}

export function deriveView(snapshot, { nowMs, connected, fixtureMode, offsetMs }) {
  const clockReady = Number.isFinite(offsetMs);
  const serverNow = clockReady ? nowMs + offsetMs : nowMs;
  const generationFresh = clockReady && serverNow >= snapshot.published_at_ms - 2000 &&
    serverNow - snapshot.published_at_ms <= 15000;
  const healthy = snapshot.health?.status === "OK";
  const rows = Object.values(snapshot.rows).map((row) => {
    const fresh = clockReady && serverNow < row.valid_until_ms && serverNow < row.expires_at_ms;
    const actionable = Boolean(connected && !fixtureMode && generationFresh && healthy && fresh);
    const status = actionable ? row.state : fixtureMode ? "REPLAY ONLY" :
      !connected ? "DISCONNECTED" : !clockReady ? "CLOCK UNKNOWN" :
      !healthy ? "SOURCE DEGRADED" : !generationFresh ? "STALE GENERATION" : "EXPIRED";
    const evidenceAgeMs = clockReady ? Math.max(0, serverNow - row.observed_at_ms) : null;
    return { ...row, locallyActionable: actionable, displayStatus: status, evidenceAgeMs };
  });
  rows.sort((a, b) => b.rank_score - a.rank_score ||
    a.instrument_id.localeCompare(b.instrument_id));
  return { rows, history: snapshot.signal_history, connected, fixtureMode,
    generationFresh, healthy, clockReady };
}

function safeTime(value) {
  return Number.isInteger(value) && value >= 0 ?
    new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "Unknown";
}

function percentage(value, digits = 2) {
  if (value == null) return "Unavailable";
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(digits)}%` : "Unavailable";
}

export function formatPrice(value, tickSize) {
  const amount = Number(value);
  const tick = Number(tickSize);
  if (!Number.isFinite(amount) || !Number.isFinite(tick) || tick <= 0) return "Unavailable";
  const cleanTick = String(tickSize).replace(/0+$/, "").replace(/\.$/, "");
  const places = Math.max(0, Math.min(12, (cleanTick.split(".")[1] ?? "").length));
  return amount.toFixed(places);
}

function shortMoveRange(entry, target, invalidation) {
  const low = Number(entry.lower), high = Number(entry.upper);
  const tp = Number(target), stop = Number(invalidation);
  if (!(tp > 0 && tp < low && low <= high && high < stop)) return null;
  return { tpLow: (low - tp) / low * 100, tpHigh: (high - tp) / high * 100,
    stopLow: (stop - high) / high * 100, stopHigh: (stop - low) / low * 100 };
}

function pctRange(low, high) {
  return `${low.toFixed(1)}–${high.toFixed(1)}%`;
}

export function watchGateLabel(watch, instrumentId) {
  const gates = watch?.setup_gates;
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) return "Not evaluated";
  if (!Object.hasOwn(gates, instrumentId)) return "Capacity limit";
  const reason = gates[instrumentId];
  return typeof reason === "string" && reason.length > 0 ?
    reason.replaceAll("_", " ").toLowerCase() : "Not evaluated";
}

function cell(tr, value, className = "") {
  const td = document.createElement("td");
  td.textContent = String(value ?? "Unknown");
  if (className) td.className = className;
  tr.append(td);
}

function detailLine(dl, label, value) {
  const dt = document.createElement("dt"); dt.textContent = label;
  const dd = document.createElement("dd"); dd.textContent = String(value ?? "Unavailable");
  dl.append(dt, dd);
}

export function render(snapshot, view) {
  document.getElementById("generation").textContent = String(snapshot.generation);
  document.getElementById("feature-version").textContent = snapshot.feature_version;
  document.getElementById("profile").textContent = view.rows[0]?.timing_profile ?? "MINUTE";
  document.getElementById("published-at").textContent = safeTime(snapshot.published_at_ms);
  const connection = document.getElementById("connection");
  connection.textContent = view.fixtureMode ? "Saved fixture · observation only" :
    !view.connected ? "Disconnected · actionability removed" :
    !view.clockReady ? "Clock offset unavailable · actionability held" :
    !view.generationFresh ? "Generation stale · actionability removed" : "Connected";
  const healthReason = snapshot.health?.reason_codes?.[0];
  const healthDetail = healthReason === "BTC_QUOTE_STALE" ? "BTC quote is stale" :
    healthReason === "CONTEXT_INCOMPLETE" ? "full-universe context is incomplete" :
    "a required source is unavailable";
  document.getElementById("health").textContent = view.fixtureMode ?
    "This saved generation is for contract review. It is never a live opportunity." :
    view.healthy ? "Sources report healthy. Every row still has its own expiry." :
    `Source health is degraded: ${healthDetail}. Actionability is held.`;
  document.getElementById("row-count").textContent = `${view.rows.length} ${view.rows.length === 1 ? "row" : "rows"}`;
  document.getElementById("empty").hidden = view.rows.length > 0;
  const body = document.getElementById("rows");
  const details = document.getElementById("details");
  body.replaceChildren(); details.replaceChildren();
  for (const row of view.rows) {
    const tick = row.tick_size ?? "0.0001";
    const tr = document.createElement("tr");
    cell(tr, row.instrument_id);
    cell(tr, row.displayStatus, `state ${row.locallyActionable ? "ready" : "stale"}`);
    cell(tr, `${row.perc48.toFixed(2)}%`);
    cell(tr, row.rsi14_4h_closed.toFixed(1));
    cell(tr, row.rank_score);
    cell(tr, formatPrice(row.entry_condition.level, tick));
    cell(tr, row.early_partial ? formatPrice(row.early_partial, tick) : "—");
    cell(tr, formatPrice(row.targets[0].price, tick));
    cell(tr, formatPrice(row.invalidation.price, tick));
    cell(tr, safeTime(row.expires_at_ms));
    body.append(tr);
    const card = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${row.instrument_id} · ${row.family.replaceAll("_", " ")}`;
    const idea = document.createElement("p"); idea.textContent = row.idea_text;
    const dl = document.createElement("dl");
    detailLine(dl, "Early partial (illustrative)", row.early_partial ?
      formatPrice(row.early_partial, tick) : "Unavailable");
    detailLine(dl, "Structural target 1", formatPrice(row.targets[0].price, tick));
    detailLine(dl, "Invalidation", formatPrice(row.invalidation.price, tick));
    detailLine(dl, "Zone (approx.)", `${formatPrice(row.zone.lower, tick)}–${formatPrice(row.zone.upper, tick)}`);
    detailLine(dl, "Evidence age", row.evidenceAgeMs === null ? "Clock unavailable" :
      `${Math.floor(row.evidenceAgeMs / 1000)} s`);
    detailLine(dl, "Pump base / peak", row.episode_context ?
      `${row.episode_context.base_price} / ${row.episode_context.peak_price}` : "Unavailable");
    detailLine(dl, "Peak age", Number.isInteger(row.episode_context?.peak_age_ms) ?
      `${(row.episode_context.peak_age_ms / 3_600_000).toFixed(1)} h` : "Unavailable");
    detailLine(dl, "Retained pump", percentage(row.retention, 1));
    detailLine(dl, "Modeled net room", percentage(row.quality.net_room));
    detailLine(dl, "Modeled net R/R", row.quality.net_rr == null ? "Unavailable" : Number(row.quality.net_rr).toFixed(2));
    detailLine(dl, "Reference short / fee", `${row.quality.reference_notional_usdt ?? "?"} USDT / ${percentage(row.quality.fee_fraction_per_side)} per side`);
    detailLine(dl, "Spread", row.quality.spread_bps ? `${Number(row.quality.spread_bps).toFixed(1)} bps` : "Unavailable");
    detailLine(dl, "Quality", row.quality.economics_verified ? "Verified economics" : "Hypothetical economics");
    detailLine(dl, "Evidence sources", Object.entries(row.source_times ?? {}).map(([name, source]) =>
      `${name}: ${safeTime(source.event_at_ms)}`).join("; ") || "Unavailable");
    detailLine(dl, "Missing", Object.entries(row.missing_fields ?? {}).map(([k, v]) => `${k}: ${v}`).join("; ") || "None");
    card.append(summary, idea, dl); details.append(card);
  }
  const historyBody = document.getElementById("history-rows");
  const historyDetails = document.getElementById("history-details");
  historyBody.replaceChildren(); historyDetails.replaceChildren();
  for (const signal of view.history) {
    const tick = signal.tick_size;
    const lower = formatPrice(signal.entry_range.lower, tick);
    const upper = formatPrice(signal.entry_range.upper, tick);
    const target = formatPrice(signal.targets[0].price, tick);
    const invalid = formatPrice(signal.invalidation.price, tick);
    const tr = document.createElement("tr");
    cell(tr, safeTime(signal.observed_at_ms));
    cell(tr, signal.instrument_id);
    cell(tr, `${signal.state} · archived`, "state stale");
    cell(tr, `${lower}–${upper}`);
    cell(tr, signal.early_partial ? formatPrice(signal.early_partial, tick) : "—");
    cell(tr, target);
    cell(tr, invalid);
    cell(tr, signal.notification_status);
    historyBody.append(tr);
    const card = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${signal.instrument_id} · ${signal.family.replaceAll("_", " ")} · ${safeTime(signal.observed_at_ms)}`;
    const note = document.createElement("p");
    note.textContent = signal.state === "ARMED" ?
      "Archived setup watch: the entry condition was not observed. All quote and entry windows have expired." :
      "Archived trigger observation: no order or fill is implied. All quote and entry windows have expired.";
    const dl = document.createElement("dl");
    const trigger = signal.entry_condition.type.startsWith("CLOSED_1M") ?
      "Completed 1m close below" : "Verified cross below";
    detailLine(dl, "Entry condition", `${trigger} ${formatPrice(signal.entry_condition.level, tick)}, then fresh bid in range`);
    detailLine(dl, "Entry range", `${lower}–${upper}`);
    detailLine(dl, "Early partial (illustrative)", signal.early_partial ?
      formatPrice(signal.early_partial, tick) : "Unavailable");
    detailLine(dl, "Structural target 1", target);
    detailLine(dl, "Invalidation", invalid);
    detailLine(dl, "Closed reclaim at or above", signal.reclaim_at_or_above);
    const moves = shortMoveRange(signal.entry_range, signal.targets[0].price,
      signal.invalidation.price);
    if (moves) {
      detailLine(dl, "Price move to target", pctRange(moves.tpLow, moves.tpHigh));
      detailLine(dl, "Adverse move to invalidation", pctRange(moves.stopLow, moves.stopHigh));
      detailLine(dl, "25× gross margin illustration", `+${pctRange(moves.tpLow * 25, moves.tpHigh * 25)} to target; −${pctRange(moves.stopLow * 25, moves.stopHigh * 25)} to invalidation (before fees, funding and slippage)`);
    }
    const partialMoves = signal.early_partial ?
      shortMoveRange(signal.entry_range, signal.early_partial,
        signal.invalidation.price) : null;
    if (partialMoves) {
      detailLine(dl, "Early partial move / 25× gross margin",
        `${pctRange(partialMoves.tpLow, partialMoves.tpHigh)} price / +${pctRange(partialMoves.tpLow * 25, partialMoves.tpHigh * 25)} margin, before costs`);
    }
    detailLine(dl, "Resistance zone (approx.)", `${formatPrice(signal.zone.lower, tick)}–${formatPrice(signal.zone.upper, tick)}`);
    detailLine(dl, "Rank", `${signal.rank_score}/100 (uncalibrated)`);
    detailLine(dl, "Modeled net room", percentage(signal.quality.net_room));
    detailLine(dl, "Reference notional / fee", `${signal.quality.reference_notional_usdt} USDT / ${percentage(signal.quality.fee_fraction_per_side)} per side`);
    detailLine(dl, "Frozen quote valid until", safeTime(signal.valid_until_ms));
    detailLine(dl, "Setup expired", safeTime(signal.expires_at_ms));
    card.append(summary, note, dl); historyDetails.append(card);
  }
  document.getElementById("history-count").textContent =
    `${historyBody.children.length} ${historyBody.children.length === 1 ? "signal" : "signals"}`;
  document.getElementById("history-empty").hidden = historyBody.children.length > 0;
  const watch = snapshot.watch?.mode === "CONTEXT_ONLY" &&
    snapshot.watch?.actionable === false && Array.isArray(snapshot.watch.items) ?
    snapshot.watch.items : [];
  const watchBody = document.getElementById("watch-rows");
  watchBody.replaceChildren();
  for (const item of watch) {
    if (!item || typeof item.instrument_id !== "string") continue;
    const tr = document.createElement("tr");
    cell(tr, item.instrument_id);
    cell(tr, Number(item.rsi14_4h_closed).toFixed(1));
    cell(tr, `${Number(item.perc48).toFixed(2)}%`);
    cell(tr, `${(Number(item.retention) * 100).toFixed(1)}%`);
    cell(tr, watchGateLabel(snapshot.watch, item.instrument_id));
    cell(tr, safeTime(item.as_of_ms));
    watchBody.append(tr);
  }
  document.getElementById("watch-count").textContent =
    `${watchBody.children.length} ${watchBody.children.length === 1 ? "watch" : "watches"}`;
  document.getElementById("watch-empty").hidden = watchBody.children.length > 0;
}

export function fixtureModeFor(hostname, search) {
  const params = new URLSearchParams(search);
  return params.has("fixture") || (hostname !== "ahxfast.github.io" && !params.has("live"));
}

if (typeof document !== "undefined") {
  const fixtureMode = fixtureModeFor(globalThis.location.hostname, globalThis.location.search);
  if (!fixtureMode) {
    import("./live.mjs").then(({ startLive }) => startLive({ decodeGeneration, deriveView, render }))
      .catch(() => {
        document.getElementById("connection").textContent = "Live connection unavailable";
      });
  } else {
  let snapshot = null;
  let connected = false;
  async function refresh() {
    try {
      const response = await fetch("sample-generation.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const incoming = decodeGeneration(await response.json());
      if (snapshot && incoming.generation < snapshot.generation) throw new Error("Generation regressed");
      snapshot = incoming;
      connected = true;
    } catch {
      connected = false;
      document.getElementById("connection").textContent = "Disconnected · actionability removed";
    }
    tick();
  }
  function tick() {
    if (!snapshot) return;
    const offsetMs = Number.isFinite(globalThis.SONAR_V5_SERVER_OFFSET_MS) ?
      globalThis.SONAR_V5_SERVER_OFFSET_MS : null;
    render(snapshot, deriveView(snapshot, { nowMs: Date.now(), connected, fixtureMode, offsetMs }));
  }
  refresh();
  setInterval(tick, 1000);
  }
}
