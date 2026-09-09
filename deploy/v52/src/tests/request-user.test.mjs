import assert from "node:assert/strict";
import test from "node:test";
import { getRequestUser } from "../lib/request-user.ts";

test("uses the authenticated workspace identity", () => {
  const request = new Request("https://example.test/", {
    headers: { "oai-authenticated-user-email": "owner@example.test" },
  });
  assert.equal(getRequestUser(request), "owner@example.test");
});

test("allows only explicit local preview fallback", () => {
  assert.equal(getRequestUser(new Request("http://terminal.local/", { headers: { host: "terminal.local" } })), "local-preview@arthello.test");
  assert.equal(getRequestUser(new Request("https://public.example/", { headers: { host: "public.example" } })), null);
});
