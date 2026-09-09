import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const PR_HEAD_PATTERN = /github\.event\.pull_request\.head\.(?:sha|ref)|github\.head_ref/;
const SSH_PATTERN = /(?:^|[^a-z])ssh(?:pass|-agent|-add|-keygen|-keyscan)?(?:[^a-z]|$)|DEPLOY_HOST|SSH_PRIVATE_KEY/i;
const DOCKER_PATTERN = /(?:^|[^a-z])docker(?:[^a-z]|$)/i;
const DESTRUCTIVE_PATTERN = /docker\s+(?:rm|kill|stop|container\s+prune|image\s+prune|builder\s+prune|volume\s+rm)|clean[-_ ]slate|\b(?:reset|wipe)\b/i;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function triggerNames(workflow) {
  const trigger = workflow.on;
  if (typeof trigger === "string") return [trigger];
  if (Array.isArray(trigger)) return trigger.map(String);
  if (trigger && typeof trigger === "object") return Object.keys(trigger);
  return [];
}

function runnerUsesSelfHosted(runner) {
  return asArray(runner).some((label) => String(label).toLowerCase().includes("self-hosted"));
}

function environmentName(environment) {
  if (typeof environment === "string") return environment;
  if (environment && typeof environment === "object") return String(environment.name ?? "");
  return "";
}

function jobRunsOnEvent(condition, eventName) {
  if (condition === false) return false;
  if (condition === undefined || condition === null || condition === true) return true;

  const expression = String(condition);
  const escapedEvent = eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    !expression.includes("||") &&
    new RegExp(`github\\.event_name\\s*!=\\s*['\"]${escapedEvent}['\"]`).test(expression)
  ) {
    return false;
  }

  const equalEvents = [
    ...expression.matchAll(/github\.event_name\s*==\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
  return equalEvents.length === 0 || equalEvents.includes(eventName);
}

function checksOutPullRequestHead(job) {
  return asArray(job?.steps).some((step) => {
    if (!step || typeof step !== "object" || !String(step.uses ?? "").startsWith("actions/checkout@")) {
      return false;
    }
    return PR_HEAD_PATTERN.test(JSON.stringify(step.with?.ref ?? ""));
  });
}

function analyzeJob(jobId, job) {
  const serialized = JSON.stringify(job ?? {});
  const capabilities = [];

  if (runnerUsesSelfHosted(job?.["runs-on"])) capabilities.push("self-hosted");
  if (/prod|production/i.test(environmentName(job?.environment))) capabilities.push("production-environment");
  if (SSH_PATTERN.test(serialized)) capabilities.push("ssh");
  if (DOCKER_PATTERN.test(serialized)) capabilities.push("docker");

  return {
    id: jobId,
    runner: job?.["runs-on"] ?? null,
    environment: environmentName(job?.environment) || null,
    capabilities,
    productionCapability: capabilities.some((value) =>
      ["self-hosted", "production-environment", "ssh"].includes(value),
    ),
    runsOnPullRequest: jobRunsOnEvent(job?.if, "pull_request"),
    runsOnPullRequestTarget: jobRunsOnEvent(job?.if, "pull_request_target"),
    checksOutPullRequestHead: checksOutPullRequestHead(job),
    destructive: DESTRUCTIVE_PATTERN.test(serialized),
    reusableWorkflow: typeof job?.uses === "string" ? job.uses : null,
  };
}

function findViolations(triggers, jobs) {
  const violations = [];

  for (const job of jobs) {
    if (triggers.includes("pull_request") && job.runsOnPullRequest && job.productionCapability) {
      violations.push({
        rule: "untrusted-pr-on-production-capability",
        job: job.id,
        detail: `pull_request job has capabilities: ${job.capabilities.join(", ")}`,
      });
    }

    if (
      triggers.includes("pull_request_target") &&
      job.runsOnPullRequestTarget &&
      job.productionCapability &&
      job.checksOutPullRequestHead
    ) {
      violations.push({
        rule: "pr-target-head-on-production-capability",
        job: job.id,
        detail: `pull_request_target job checks out PR-controlled ref with capabilities: ${job.capabilities.join(", ")}`,
      });
    }
  }

  return violations;
}

export function analyzeWorkflowSource(file, source) {
  let workflow;
  try {
    workflow = parse(source);
  } catch (error) {
    return {
      file,
      triggers: [],
      jobs: [],
      violations: [{ rule: "invalid-workflow-yaml", job: null, detail: error.message }],
    };
  }

  if (!workflow || typeof workflow !== "object") {
    return {
      file,
      triggers: [],
      jobs: [],
      violations: [{ rule: "invalid-workflow-document", job: null, detail: "Expected a YAML mapping" }],
    };
  }

  const triggers = triggerNames(workflow);
  const jobs = Object.entries(workflow.jobs ?? {}).map(([jobId, job]) => analyzeJob(jobId, job));
  return { file, triggers, jobs, violations: findViolations(triggers, jobs) };
}

export async function analyzeWorkflowDirectory(directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  const workflows = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    workflows.push(analyzeWorkflowSource(entry.name, await readFile(absolute, "utf8")));
  }

  const workflowsByFile = new Map(workflows.map((workflow) => [workflow.file, workflow]));
  for (let pass = 0; pass < workflows.length; pass += 1) {
    let changed = false;
    for (const workflow of workflows) {
      for (const job of workflow.jobs) {
        if (!job.reusableWorkflow?.startsWith("./")) continue;
        const calledWorkflow = workflowsByFile.get(path.basename(job.reusableWorkflow));
        if (!calledWorkflow) {
          if (!job.capabilities.includes("unresolved-local-reusable")) {
            job.capabilities.push("unresolved-local-reusable");
            job.productionCapability = true;
            changed = true;
          }
          continue;
        }

        const inherited = [
          ...new Set(calledWorkflow.jobs.flatMap((calledJob) => calledJob.capabilities)),
        ];
        for (const capability of inherited) {
          if (!job.capabilities.includes(capability)) {
            job.capabilities.push(capability);
            changed = true;
          }
        }
        const inheritedProduction = calledWorkflow.jobs.some((calledJob) => calledJob.productionCapability);
        const inheritedPrHead = calledWorkflow.jobs.some((calledJob) => calledJob.checksOutPullRequestHead);
        if (inheritedProduction && !job.productionCapability) {
          job.productionCapability = true;
          changed = true;
        }
        if (inheritedPrHead && !job.checksOutPullRequestHead) {
          job.checksOutPullRequestHead = true;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  for (const workflow of workflows) {
    workflow.violations = findViolations(workflow.triggers, workflow.jobs);
  }

  const violations = workflows.flatMap((workflow) =>
    workflow.violations.map((violation) => ({ file: workflow.file, ...violation })),
  );
  const risks = workflows.flatMap((workflow) =>
    workflow.jobs
      .filter((job) => job.destructive && workflow.triggers.includes("push"))
      .map((job) => ({
        file: workflow.file,
        job: job.id,
        risk: "destructive-push-production",
        productionCapability: job.productionCapability,
      })),
  );

  return {
    schemaVersion: 1,
    workflowCount: workflows.length,
    violationCount: violations.length,
    riskCount: risks.length,
    violations,
    risks,
    workflows,
  };
}

export function evaluateWorkflowCountRatchet(workflowCount, ratchet) {
  const maximum = ratchet?.maximumWorkflowCount;
  if (!Number.isInteger(maximum) || maximum < 0) {
    return [
      {
        rule: "invalid-workflow-count-ratchet",
        detail: "maximumWorkflowCount must be a non-negative integer",
      },
    ];
  }
  if (workflowCount <= maximum) return [];
  return [
    {
      rule: "workflow-count-ratchet-exceeded",
      detail: `Active workflow count ${workflowCount} exceeds reviewed maximum ${maximum}`,
    },
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const reportIndex = args.indexOf("--report");
  const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
  const root = process.cwd();
  const result = await analyzeWorkflowDirectory(path.join(root, ".github", "workflows"));
  const ratchetPath = path.join(root, "quality-gates", "workflow-policy-ratchet.json");
  const ratchet = JSON.parse(await readFile(ratchetPath, "utf8"));
  const ratchetViolations = evaluateWorkflowCountRatchet(result.workflowCount, ratchet);

  if (reportPath) {
    const absoluteReport = path.resolve(root, reportPath);
    await mkdir(path.dirname(absoluteReport), { recursive: true });
    await writeFile(absoluteReport, `${JSON.stringify(result, null, 2)}\n`);
  }

  console.log(
    `WORKFLOW_POLICY workflows=${result.workflowCount} violations=${result.violationCount + ratchetViolations.length} risks=${result.riskCount}`,
  );
  for (const violation of result.violations) {
    console.error(`${violation.file}:${violation.job ?? "workflow"}: ${violation.rule}: ${violation.detail}`);
  }
  for (const risk of result.risks) {
    console.log(`${risk.file}:${risk.job}: ${risk.risk}`);
  }
  for (const violation of ratchetViolations) {
    console.error(`workflow-policy-ratchet.json:workflow: ${violation.rule}: ${violation.detail}`);
  }

  if (result.violationCount > 0 || ratchetViolations.length > 0) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntryPoint) await main();
