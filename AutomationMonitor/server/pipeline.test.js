import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPipelineStatus, parseWrapperLog, STAGE_NAMES, BUILD_STAGE } from "./pipeline.js";

// ponytail: 2026-10-05 run — SCC blocked SteamDeck.Automation.dll at "Initializing script
// modules" while the wrapper still labelled the failed build step "DONE (42s)". The wrapper
// now prints FAILED + FAILED-MSG lines; these fixtures pin the parser contract for that shape.
const FAILED_LOG = [
  "[2026-10-05 14:15:03] Repository: D:\\UnrealEngine\\ue6",
  "[2026-10-05 14:15:03] Branch: ue6-automationSys",
  "[2026-10-05 14:15:06] START Check application control policy",
  "[2026-10-05 14:15:07] DONE  Check application control policy (1s)",
  "[2026-10-05 14:15:07] START Validate repository state",
  "[2026-10-05 14:15:08] DONE  Validate repository state (1s)",
  "[2026-10-05 14:15:08] START Build Win64 installed engine",
  "[2026-10-05 14:15:50] FAILED Build Win64 installed engine (42s)",
  "[2026-10-05 14:15:50] FAILED-MSG BuildGraph (RunUAT) exited with code 1 — see LocalBuilds\\AutomationLogs\\InstalledBuild-x-output.log",
  "[2026-10-05 14:15:51] Install build post-processing ran after the failed build step.",
  "Windows PowerShell transcript end"
].join("\r\n");

const SUCCESS_LOG = [
  "[2026-10-05 10:00:00] START Check application control policy",
  "[2026-10-05 10:00:01] DONE  Check application control policy (1s)",
  "[2026-10-05 10:00:01] START Validate repository state",
  "[2026-10-05 10:00:02] DONE  Validate repository state (1s)",
  "[2026-10-05 10:00:02] START Build Win64 installed engine",
  "[2026-10-05 12:00:00] DONE  Build Win64 installed engine (7198s)",
  "Windows PowerShell transcript end"
].join("\r\n");

test("STAGE_NAMES includes the SCC preflight stage first", () => {
  assert.equal(STAGE_NAMES[0], "Check application control policy");
  assert.equal(STAGE_NAMES.length, 13);
  assert.equal(STAGE_NAMES.length, STAGE_NAMES.filter((n, i, a) => a.indexOf(n) === i).length);
});

test("parses a healthy log into done stages", () => {
  const parsed = parseWrapperLog(SUCCESS_LOG);
  assert.equal(parsed.ended, true);
  assert.deepEqual(
    parsed.stages.map((s) => [s.name, s.endAt ? "closed" : "open", s.seconds]),
    [
      ["Check application control policy", "closed", 1],
      ["Validate repository state", "closed", 1],
      ["Build Win64 installed engine", "closed", 7198]
    ]
  );
});

test("marks the thrown step as failed with duration and message", () => {
  const parsed = parseWrapperLog(FAILED_LOG);
  const build = parsed.stages.find((s) => s.name === BUILD_STAGE);
  assert.equal(build.failed, true);
  assert.equal(build.seconds, 42);
  assert.ok(build.endAt);
  assert.match(build.error, /exited with code 1/);
  // Earlier steps stay successful.
  assert.equal(parsed.stages.find((s) => s.name === "Validate repository state").failed, undefined);
});

test("legacy FAILED lines with an inline message still parse", () => {
  // Pre-FAILED-MSG transcripts (or truncated lines) must not lose the failure state.
  const log = [
    "[2026-10-05 14:15:08] START Sync Unreal dependencies",
    "[2026-10-05 14:15:09] FAILED Sync Unreal dependencies (1s) GitDependencies.exe failed",
    "Windows PowerShell transcript end"
  ].join("\r\n");
  const parsed = parseWrapperLog(log);
  const stage = parsed.stages.find((s) => s.name === "Sync Unreal dependencies");
  assert.ok(stage, "stage matched by cleaned name");
  assert.equal(stage.failed, true);
  assert.equal(stage.seconds, 1);
  assert.equal(stage.error, "GitDependencies.exe failed");
});
const cases = [
  { name: 'preflight failure retains its stage index without transcript end', stage: STAGE_NAMES[0], failed: true, index: 0 },
  { name: 'legacy Fetch failure retains its failure reason', stage: 'Fetch origin and upstream', failed: false, index: 3 }
];
for (const scenario of cases) {
  test(scenario.name, async (t) => {
    const logRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
    t.after(() => fs.rm(logRoot, { recursive: true, force: true }));
    const name = `SyncAndBuildInstalled-test-${scenario.index}.log`;
    const lines = [`[2026-10-05 14:15:06] START ${scenario.stage}`];
    if (scenario.failed) lines.push(`[2026-10-05 14:15:07] FAILED ${scenario.stage} (1s)`);
    else lines.push('Windows PowerShell transcript end');
    await fs.writeFile(path.join(logRoot, name), lines.join('\n'));
    const { pipeline, runs } = await buildPipelineStatus({
      logRoot, logs: [{ name, modifiedAt: '2026-10-05T14:15:07Z' }],
      tailFile: async () => '', isMonitorRunActive: false, isTaskRunning: false
    });
    assert.equal(runs[0].result, 'failed');
    assert.equal(runs[0].reason, `${scenario.stage} failed`);
    assert.equal(pipeline.currentStage, scenario.index);
  });
}
