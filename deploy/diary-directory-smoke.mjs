import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function runDiarySmoke({
  origin,
  systemId,
  branchId,
  secret,
  fetch: request = globalThis.fetch,
}) {
  assert.equal(origin, "http://127.0.0.1:3000", "isolated loopback only");
  assert.ok(secret?.length >= 32);
  const endpoint = origin + "/api/internal/directory-sync";
  async function send(action, snapshot, signed = true, foreign = false) {
    const body = JSON.stringify({
      systemId: foreign ? "SYS-FOREIGN" : systemId,
      branchId,
      action,
      snapshot,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { "content-type": "application/json" };
    if (signed)
      Object.assign(headers, {
        "x-arthello-timestamp": timestamp,
        "x-arthello-signature": createHmac("sha256", secret)
          .update(`${timestamp}.${body}`)
          .digest("hex"),
      });
    return request(endpoint, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  }
  const snapshot = {
    version: 1,
    complete: true,
    sequence: Date.now(),
    classes: [{ id: "CI-G1", name: "CI isolated class", grade: 1 }],
    families: [{ id: "CI-F1" }],
    students: [
      {
        id: "CI-C1",
        firstName: "Synthetic pupil",
        lastName: "",
        classId: "CI-G1",
        familyId: "CI-F1",
      },
    ],
    teachers: [{ id: "CI-T1", displayName: "Synthetic teacher" }],
  };
  assert.equal(
    (await send("apply", snapshot, false)).status,
    401,
    "unsigned writes must be rejected",
  );
  assert.equal(
    (await send("apply", snapshot, true, true)).status,
    400,
    "foreign school must be rejected",
  );
  async function receipt(action, value) {
    const response = await send(action, value);
    assert.equal(response.status, 200, `${action} must succeed`);
    const result = await response.json();
    assert.equal(
      result.digest,
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    );
    assert.equal(result.sequence, value.sequence);
    assert.equal(result.applied, action === "apply");
    return result;
  }
  await receipt("preview", snapshot);
  let inspected = await (await send("inspect", null)).json();
  assert.ok(
    !inspected.classes.some((row) => row.id === "os-CI-G1"),
    "preview must not create class",
  );
  await receipt("apply", snapshot);
  await receipt("apply", snapshot);
  inspected = await (await send("inspect", null)).json();
  assert.equal(
    inspected.classes.filter((row) => row.id === "os-CI-G1").length,
    1,
  );
  assert.equal(
    (await send("apply", { ...snapshot, sequence: snapshot.sequence - 1 }))
      .status,
    409,
  );
  const empty = {
    ...snapshot,
    sequence: snapshot.sequence + 1,
    students: [],
    families: [],
    teachers: [],
  };
  assert.equal((await receipt("preview", empty)).archived, 1);
  assert.equal((await receipt("apply", empty)).archived, 1);
  assert.equal((await receipt("apply", empty)).archived, 0);
  return { status: "verified", branchId };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runDiarySmoke({
    origin: "http://127.0.0.1:3000",
    systemId: process.env.SMOKE_SYSTEM_ID,
    branchId: process.env.SMOKE_BRANCH_ID,
    secret: process.env.CENTRAL_ACCESS_SECRET,
  });
  console.log(JSON.stringify(result));
}
