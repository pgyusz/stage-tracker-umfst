/* Stage Tracker (static, no backend)
   - 10 teams rotate through 10 stages
   - Internally 0-based; UI shows 1–10
*/

const STORAGE_KEY = "stage-tracker-v1";

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.appendChild(child);
    return node;
};
const mod = (n, m) => ((n % m) + m) % m;

function defaultState() {
    const n = 10;
    return {
        nStages: n,
        mode: "auto",                 // "auto" | "manual"
        startAt: "",                  // datetime-local string
        roundMinutes: 10,
        manualRound: 0,               // internal 0..9 (UI 1..10)
        stages: Array.from({ length: n }, (_, i) => ({
            name: `Stage ${i + 1}`,
            professor: `Professor ${String.fromCharCode(65 + i)}`
        })),
        teams: Array.from({ length: n }, (_, i) => ({
            name: `Team ${i + 1}`,
            startStage: i               // internal 0..9 (UI 1..10)
        })),
        view: "stages"                // "stages" | "teams"
    };
}

function loadState() {
    const shared = decodeStateFromHash();
    if (shared) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(shared)); } catch { }
        return shared;
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw);
        return normalizeState(parsed);
    } catch {
        return defaultState();
    }
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { }
}

function normalizeState(s) {
    const d = defaultState();
    const out = { ...d, ...s };

    out.nStages = Number(out.nStages) || 10;
    if (!Array.isArray(out.stages) || out.stages.length !== out.nStages) out.stages = d.stages;
    if (!Array.isArray(out.teams) || out.teams.length !== out.nStages) out.teams = d.teams;

    out.roundMinutes = Math.max(1, Number(out.roundMinutes) || 10);
    out.manualRound = mod(Number(out.manualRound) || 0, out.nStages);
    out.mode = out.mode === "manual" ? "manual" : "auto";
    out.view = out.view === "teams" ? "teams" : "stages";
    out.startAt = typeof out.startAt === "string" ? out.startAt : "";

    out.teams = out.teams.map((t, i) => ({
        name: typeof t.name === "string" && t.name.trim() ? t.name : `Team ${i + 1}`,
        startStage: mod(Number(t.startStage) || 0, out.nStages)
    }));

    out.stages = out.stages.map((st, i) => ({
        name: typeof st.name === "string" && st.name.trim() ? st.name : `Stage ${i + 1}`,
        professor: typeof st.professor === "string" ? st.professor : ""
    }));

    return out;
}

function encodeStateToHash(s) {
    const json = JSON.stringify(s);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const safe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `#s=${safe}`;
}

function decodeStateFromHash() {
    const h = window.location.hash || "";
    const m = h.match(/#s=([A-Za-z0-9\-_]+)/);
    if (!m) return null;
    try {
        const safe = m[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = safe + "===".slice((safe.length + 3) % 4);
        const json = decodeURIComponent(escape(atob(padded)));
        return normalizeState(JSON.parse(json));
    } catch {
        return null;
    }
}

function parseLocalDateTime(dtLocalStr) {
    if (!dtLocalStr) return null;
    const d = new Date(dtLocalStr);
    return isNaN(d.getTime()) ? null : d;
}

function computeRound(nowMs) {
    const n = state.nStages;

    if (state.mode === "manual") return mod(state.manualRound, n);

    const start = parseLocalDateTime(state.startAt);
    if (!start) return 0;

    const lenMs = state.roundMinutes * 60_000;
    const elapsed = nowMs - start.getTime();

    if (elapsed < 0) return 0;
    const r = Math.floor(elapsed / lenMs);
    return mod(r, n);
}

function assignmentForRound(round) {
    const n = state.nStages;
    const teamAtStage = Array.from({ length: n }, () => null);
    const stageOfTeam = Array.from({ length: n }, () => 0);

    state.teams.forEach((t, ti) => {
        const stage = mod(t.startStage + round, n);
        stageOfTeam[ti] = stage;
        if (teamAtStage[stage] === null) teamAtStage[stage] = ti;
        else teamAtStage[stage] = -1;
    });

    return { teamAtStage, stageOfTeam };
}

function renderWarnings(round) {
    const w = $("#warnings");
    w.innerHTML = "";

    const counts = new Map();
    for (const t of state.teams) counts.set(t.startStage, (counts.get(t.startStage) || 0) + 1);

    // show dupes as 1..10
    const dupes = [...counts.entries()].filter(([, c]) => c > 1).map(([s]) => s + 1);

    if (dupes.length) {
        w.appendChild(el("div", {
            className: "warn",
            textContent: `Warning: duplicate starting stages (${dupes.join(", ")}). Two teams may appear on the same stage.`
        }));
    } else {
        w.appendChild(el("div", {
            className: "ok",
            textContent: "Rotation looks good: each team has a unique starting stage."
        }));
    }

    if (state.mode === "auto" && !parseLocalDateTime(state.startAt)) {
        w.appendChild(el("div", {
            className: "warn",
            textContent: "Auto mode is on, but Start time is empty/invalid. Round will stay at 1."
        }));
    }

    const { teamAtStage } = assignmentForRound(round);
    const collisions = teamAtStage.filter(x => x === -1).length;
    if (collisions) {
        w.appendChild(el("div", {
            className: "warn",
            textContent: `Collision detected this round: at least one stage has multiple teams (fix starting stages).`
        }));
    }
}

function renderEditors() {
    const stagesEditor = $("#stagesEditor");
    stagesEditor.innerHTML = "";
    state.stages.forEach((st, i) => {
        const row = el("div", { className: "editorRow" }, [
            el("div", { className: "badge", textContent: `${i + 1}` }),
            el("input", {
                type: "text",
                value: st.name,
                placeholder: `Stage ${i + 1}`,
                oninput: (e) => {
                    state.stages[i].name = e.target.value;
                    saveState();
                    renderAll();
                }
            }),
            el("input", {
                type: "text",
                value: st.professor,
                placeholder: `Professor`,
                oninput: (e) => {
                    state.stages[i].professor = e.target.value;
                    saveState();
                    renderAll();
                }
            }),
            el("div", { className: "hint span2", textContent: "Stage number shown to users is 1–10." })
        ]);
        stagesEditor.appendChild(row);
    });

    const teamsEditor = $("#teamsEditor");
    teamsEditor.innerHTML = "";
    state.teams.forEach((t, i) => {
        const startSel = el("select", {
            value: String(t.startStage + 1), // UI 1..10
            onchange: (e) => {
                const uiVal = parseInt(e.target.value, 10) || 1;        // 1..10
                state.teams[i].startStage = mod(uiVal - 1, state.nStages); // internal 0..9
                saveState();
                renderAll();
            }
        });

        for (let s = 0; s < state.nStages; s++) {
            const ui = s + 1;
            const opt = el("option", { value: String(ui), textContent: `${ui}` });
            if (s === t.startStage) opt.selected = true;
            startSel.appendChild(opt);
        }

        const row = el("div", { className: "editorRow" }, [
            el("div", { className: "badge", textContent: `${i + 1}` }),
            el("input", {
                type: "text",
                value: t.name,
                placeholder: `Team ${i + 1}`,
                oninput: (e) => {
                    state.teams[i].name = e.target.value;
                    saveState();
                    renderAll();
                }
            }),
            el("div", {}, [
                el("span", { className: "hint", textContent: "Starting stage (1–10)" }),
                startSel
            ]),
            el("div", { className: "hint span2", textContent: "Perfect rotation: Team 1 starts at Stage 1, Team 2 at Stage 2, etc." })
        ]);

        teamsEditor.appendChild(row);
    });
}

function renderStageView(round) {
    const n = state.nStages;
    const nextRound = mod(round + 1, n);

    const curr = assignmentForRound(round);
    const next = assignmentForRound(nextRound);

    const container = $("#viewStages");
    container.className = "view stageGrid";
    container.innerHTML = "";

    for (let si = 0; si < n; si++) {
        const stage = state.stages[si];
        const ti = curr.teamAtStage[si];
        const nextTi = next.teamAtStage[si];

        const teamName = (ti === null) ? "—" : (ti === -1 ? "⚠ collision" : state.teams[ti]?.name ?? "—");
        const nextTeamName = (nextTi === null) ? "—" : (nextTi === -1 ? "⚠ collision" : state.teams[nextTi]?.name ?? "—");

        const card = el("div", { className: "stageCard" }, [
            el("div", { className: "stageTop" }, [
                el("div", {}, [
                    el("div", { className: "stageName", textContent: stage.name }),
                    el("div", { className: "prof", textContent: stage.professor ? `Prof: ${stage.professor}` : "Prof: —" })
                ]),
                // UI stage number: 1..10
                el("div", { className: "stageNum", textContent: `#${si + 1}` })
            ]),
            el("div", { className: "bigTeam", textContent: teamName }),
            el("div", { className: "nextLine", textContent: "Next:" }),
            el("div", { className: "nextBadge", textContent: nextTeamName })
        ]);

        container.appendChild(card);
    }
}

function renderTeamView(round) {
    const n = state.nStages;
    const nextRound = mod(round + 1, n);

    const curr = assignmentForRound(round);
    const next = assignmentForRound(nextRound);

    const container = $("#viewTeams");
    container.className = "view teamList";
    container.innerHTML = "";

    for (let ti = 0; ti < n; ti++) {
        const team = state.teams[ti];
        const currStage = curr.stageOfTeam[ti];
        const nextStage = next.stageOfTeam[ti];

        const currStageName = state.stages[currStage]?.name ?? `Stage #${currStage + 1}`;
        const nextStageName = state.stages[nextStage]?.name ?? `Stage #${nextStage + 1}`;

        const card = el("div", { className: "teamCard" }, [
            el("div", { className: "teamTitle", textContent: team.name }),
            el("div", {
                className: "teamMeta",
                innerHTML:
                    `Now: <b>${currStageName}</b> (stage #${currStage + 1})<br/>Next: <b>${nextStageName}</b> (stage #${nextStage + 1})`
            })
        ]);
        container.appendChild(card);
    }
}

function renderStatus(round) {
    const n = state.nStages;

    // UI rounds: 1..10
    $("#kpiRound").textContent = String(round + 1);
    $("#kpiInfo").textContent = `Next is round ${mod(round + 1, n) + 1} (cycle length ${n})`;

    $("#pillMode").textContent = `Mode: ${state.mode === "auto" ? "Auto" : "Manual"}`;
    $("#pillCycle").textContent = `Cycle: Round ${round + 1} / ${n}`;

    const now = new Date();
    $("#pillClock").textContent = `Local time: ${now.toLocaleString()}`;
}

function renderAll() {
    const nowMs = Date.now();
    const round = computeRound(nowMs);

    renderWarnings(round);
    renderStatus(round);

    if (state.view === "stages") {
        $("#viewStages").classList.remove("hidden");
        $("#viewTeams").classList.add("hidden");
        renderStageView(round);
    } else {
        $("#viewTeams").classList.remove("hidden");
        $("#viewStages").classList.add("hidden");
        renderTeamView(round);
    }
}

let state = loadState();

function syncInputsFromState() {
    document.querySelectorAll('input[name="mode"]').forEach(r => {
        r.checked = (r.value === state.mode);
    });

    $("#startAt").value = state.startAt || "";
    $("#roundMinutes").value = String(state.roundMinutes);

    // slider is 1..10; state.manualRound is 0..9
    $("#manualRound").value = String(state.manualRound + 1);
}

function attachHandlers() {
    $("#btnToggleSetup").addEventListener("click", () => {
        $("#setupPanel").classList.toggle("hidden");
    });

    $("#btnViewStages").addEventListener("click", () => {
        state.view = "stages";
        saveState();
        renderAll();
    });
    $("#btnViewTeams").addEventListener("click", () => {
        state.view = "teams";
        saveState();
        renderAll();
    });

    $("#btnCopyLink").addEventListener("click", async () => {
        const hash = encodeStateToHash(state);
        const url = `${window.location.origin}${window.location.pathname}${hash}`;
        try {
            await navigator.clipboard.writeText(url);
            $("#btnCopyLink").textContent = "Copied!";
            setTimeout(() => ($("#btnCopyLink").textContent = "Copy share link"), 1200);
        } catch {
            alert("Could not copy automatically. Share this URL:\n\n" + url);
        }
    });

    document.querySelectorAll('input[name="mode"]').forEach(r => {
        r.addEventListener("change", (e) => {
            state.mode = e.target.value === "manual" ? "manual" : "auto";
            saveState();
            renderAll();
        });
    });

    $("#startAt").addEventListener("change", (e) => {
        state.startAt = e.target.value;
        saveState();
        renderAll();
    });

    $("#roundMinutes").addEventListener("input", (e) => {
        state.roundMinutes = Math.max(1, Number(e.target.value) || 10);
        saveState();
        renderAll();
    });

    // slider UI 1..10 -> internal 0..9
    $("#manualRound").addEventListener("input", (e) => {
        const uiVal = Number(e.target.value) || 1; // 1..10
        state.manualRound = mod(uiVal - 1, state.nStages);
        saveState();
        renderAll();
    });

    $("#btnStartNow").addEventListener("click", () => {
        const now = new Date();
        const pad = (x) => String(x).padStart(2, "0");
        const dtLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        state.startAt = dtLocal;
        saveState();
        syncInputsFromState();
        renderAll();
    });

    $("#btnReset").addEventListener("click", () => {
        state = defaultState();
        saveState();
        window.location.hash = "";
        syncInputsFromState();
        renderEditors();
        renderAll();
    });

    $("#btnExport").addEventListener("click", () => {
        $("#jsonBox").value = JSON.stringify(state, null, 2);
    });

    $("#btnImport").addEventListener("click", () => {
        const raw = $("#jsonBox").value.trim();
        if (!raw) return alert("Paste JSON first.");
        try {
            const parsed = normalizeState(JSON.parse(raw));
            state = parsed;
            saveState();
            syncInputsFromState();
            renderEditors();
            renderAll();
        } catch {
            alert("Invalid JSON.");
        }
    });
}

function boot() {
    state = normalizeState(state);
    saveState();

    syncInputsFromState();
    renderEditors();
    attachHandlers();
    renderAll();

    setInterval(() => renderAll(), 1000);
}

boot();