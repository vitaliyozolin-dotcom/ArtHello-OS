import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const artifactRoot = fileURLToPath(new URL("../", import.meta.url));
const inbox = JSON.parse(
  readFileSync(
    `${artifactRoot}src/features/front-office/inbox-preview-data.json`,
    "utf8",
  ),
);
const workspace = readFileSync(
  `${artifactRoot}src/features/front-office/inbox-preview-workspace.tsx`,
  "utf8",
);
const page = readFileSync(`${artifactRoot}src/pages/front-office.tsx`, "utf8");
const contract = readFileSync(
  `${artifactRoot}src/features/front-office/preview-contract.ts`,
  "utf8",
);

function collectKeys(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, result);
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      result.push(key);
      collectKeys(nested, result);
    }
  }
  return result;
}

test("inbox preview is isolated, synthetic, and fails closed", () => {
  assert.equal(inbox.projectId, "ARTHELLO");
  assert.equal(inbox.dataMode, "SYNTHETIC");
  assert.equal(inbox.autonomyMode, "DRAFT_ONLY");
  assert.equal(inbox.realIngressEnabled, false);
  assert.equal(inbox.outboundDeliveryEnabled, false);
  assert.equal(inbox.persistenceEnabled, false);
  assert.doesNotMatch(JSON.stringify(inbox), /BLACKVILLAGE/i);

  assert.match(contract, /channelIngress:\s*false/);
  assert.match(contract, /inboxPersistence:\s*false/);
  assert.match(contract, /conversationWrites:\s*false/);
  assert.match(contract, /assignmentWrites:\s*false/);
  assert.match(contract, /resolutionWrites:\s*false/);
  assert.match(contract, /outboundDelivery:\s*false/);
  assert.match(contract, /automaticConversationMerge:\s*false/);
  assert.match(contract, /sharedDraftWrites:\s*false/);
  assert.match(contract, /snippetInsertion:\s*false/);
});

test("conversation and message identities are unique and immutable", () => {
  const conversationIds = inbox.conversations.map(
    (conversation) => conversation.id,
  );
  assert.equal(new Set(conversationIds).size, conversationIds.length);

  const messages = inbox.conversations.flatMap(
    (conversation) => conversation.messages,
  );
  const messageIds = messages.map((message) => message.id);
  assert.equal(new Set(messageIds).size, messageIds.length);
  assert.ok(messages.length >= inbox.conversations.length * 3);

  for (const message of messages) {
    assert.ok(["INCOMING", "INTERNAL_NOTE", "AI_DRAFT"].includes(message.type));
    assert.notEqual(message.type, "OUTBOUND_SENT");
    assert.equal(message.immutable, true);
    assert.equal(message.synthetic, true);
  }
});

test("sales, service, incident, and routing remain separate objects", () => {
  for (const conversation of inbox.conversations) {
    assert.equal(conversation.linkedObject.previewOnly, true);
    if (conversation.kind === "SALES") {
      assert.equal(conversation.linkedObject.type, "LEAD");
    }
    if (conversation.kind === "SERVICE") {
      assert.equal(conversation.linkedObject.type, "TICKET");
    }
    if (conversation.kind === "INCIDENT") {
      assert.equal(conversation.linkedObject.type, "INCIDENT");
    }
    if (conversation.kind === "ROUTING") {
      assert.equal(conversation.linkedObject.type, "ROUTING");
    }
  }
});

test("identity and private-data disclosure fail closed", () => {
  const protectedConversations = inbox.conversations.filter(
    (conversation) => conversation.personalDataRisk,
  );
  assert.ok(protectedConversations.length > 0);

  for (const conversation of protectedConversations) {
    assert.equal(conversation.mayRevealPrivateData, false);
    if (conversation.identity !== "verified") {
      assert.ok(
        [
          "IDENTITY_BLOCKED",
          "ESCALATED",
          "CRITICAL_HANDOFF",
          "URGENT_HANDOFF",
        ].includes(conversation.slaState),
      );
    }
  }
});

test("P0 and P1 always contain a complete human handoff", () => {
  const urgent = inbox.conversations.filter((conversation) =>
    ["P0", "P1"].includes(conversation.priority),
  );
  assert.ok(urgent.some((conversation) => conversation.priority === "P0"));
  assert.ok(urgent.some((conversation) => conversation.priority === "P1"));

  const requiredFields = [
    "requester",
    "goal",
    "scope",
    "dates",
    "verifiedFacts",
    "unverifiedClaims",
    "emotion",
    "risk",
    "policy",
    "actionsDone",
    "decisionRequired",
    "ownerRole",
    "due",
    "recommendedReply",
  ];

  for (const conversation of urgent) {
    assert.ok(conversation.handoff);
    for (const field of requiredFields) {
      const value = conversation.handoff[field];
      assert.ok(
        Array.isArray(value)
          ? value.length > 0
          : String(value).trim().length > 0,
        `${conversation.id} is missing handoff.${field}`,
      );
    }
    assert.equal(conversation.followUp.required, true);
  }
});

test("every promised follow-up has an owner, deadline, and return channel", () => {
  for (const conversation of inbox.conversations) {
    if (!conversation.followUp.required) continue;
    assert.ok(conversation.followUp.owner.trim());
    assert.ok(conversation.followUp.due.trim());
    assert.ok(conversation.followUp.promisedChannel.trim());
    assert.ok(conversation.nextAction.trim());
  }
});

test("drafts are unsent and every factual claim carries evidence", () => {
  for (const conversation of inbox.conversations) {
    assert.equal(conversation.draft.sent, false);
    assert.equal(conversation.draft.saved, false);
    assert.ok(conversation.draft.text.trim());
    assert.ok(conversation.draft.claims.length > 0);
    for (const claim of conversation.draft.claims) {
      assert.equal(claim.status, "VERIFIED");
      assert.ok(claim.assertion.trim());
      assert.ok(claim.evidence.trim());
    }
  }
});

test("continuity checks never merge profiles automatically", () => {
  const conversationIds = inbox.conversations
    .map((conversation) => conversation.id)
    .sort();
  const continuityIds = inbox.continuityChecks
    .map((check) => check.conversationId)
    .sort();
  assert.deepEqual(continuityIds, conversationIds);

  for (const check of inbox.continuityChecks) {
    assert.equal(check.threadKey, check.conversationId);
    assert.equal(check.automaticMergeAllowed, false);
    assert.ok(check.channels.length > 0);
    assert.ok(["NO_MATCH", "POSSIBLE_RELATED"].includes(check.duplicateState));
    if (check.duplicateState === "POSSIBLE_RELATED") {
      assert.ok(check.candidateIds.length > 0);
    }
  }
});

test("collaboration and collision indicators stay read-only", () => {
  const conversationIds = inbox.conversations
    .map((conversation) => conversation.id)
    .sort();
  const collaborationIds = inbox.collaborationStates
    .map((state) => state.conversationId)
    .sort();
  assert.deepEqual(collaborationIds, conversationIds);

  for (const state of inbox.collaborationStates) {
    assert.equal(state.sharedDraftWrites, false);
    assert.ok(["CLEAR", "VIEWER_PRESENT"].includes(state.collisionState));
    if (state.collisionState === "VIEWER_PRESENT") {
      assert.ok(state.viewers.length > 0);
    }
  }
});

test("only approved verified snippets are discoverable and none can be inserted", () => {
  assert.ok(inbox.approvedSnippets.length > 0);
  for (const snippet of inbox.approvedSnippets) {
    assert.equal(snippet.status, "APPROVED");
    assert.equal(snippet.sourceStatus, "VERIFIED");
    assert.equal(snippet.insertEnabled, false);
    assert.ok(snippet.sourceRef.trim());
    assert.ok(snippet.appliesTo.length > 0);
    assert.ok(!snippet.appliesTo.includes("CHILD_INJURY"));
    assert.ok(!snippet.appliesTo.includes("DISPUTED_CHARGE"));
    assert.ok(!snippet.appliesTo.includes("STAFF_COMPLAINT"));
  }
});

test("synthetic inbox contains no direct payment or identity fields", () => {
  const forbiddenKeys = new Set([
    "fullName",
    "childName",
    "phone",
    "emailAddress",
    "address",
    "passport",
    "cardNumber",
    "cvv",
    "bankCode",
    "password",
  ]);
  const found = collectKeys(inbox).filter((key) => forbiddenKeys.has(key));
  assert.deepEqual(found, []);
});

test("interactive inbox uses local state and keeps mutations disabled", () => {
  const sources = `${workspace}\n${page}`;
  assert.doesNotMatch(sources, /\bfetch\s*\(/);
  assert.doesNotMatch(sources, /\buseQuery\s*\(/);
  assert.doesNotMatch(sources, /@workspace\/api-client-react/);
  assert.doesNotMatch(sources, /\blocalStorage\b/);
  assert.doesNotMatch(sources, /\bWebSocket\b/);
  assert.match(workspace, /inbox-preview-data\.json/);
  assert.match(workspace, /Отправка отключена/);
  assert.match(workspace, /Сохранение отключено/);
  assert.match(workspace, /Назначение отключено/);
  assert.match(workspace, /Закрытие отключено/);
  assert.match(workspace, /Передача отключена/);
  assert.match(workspace, /Автоматический merge запрещён/);
  assert.match(workspace, /Совместное редактирование отключено/);
  assert.match(workspace, /Вставка snippet отключена/);
  assert.match(workspace, /Activity \/ audit history/);
  assert.match(workspace, /follow_up/);
  assert.match(page, /InboxPreviewWorkspace/);
  assert.match(page, /key:\s*["']inbox["']/);
});
