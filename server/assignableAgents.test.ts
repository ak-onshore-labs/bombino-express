import { test } from "node:test";
import assert from "node:assert/strict";

import { pickAgentsForCity, type AgentWithCities } from "./assignableAgents.js";
import { hubCity, hubCityForId } from "../shared/hubs.js";

const AGENTS: AgentWithCities[] = [
  { id: "1", full_name: "Ravi", phone: "9800000001", cities: ["Mumbai"] },
  { id: "2", full_name: "Amit", phone: "9800000002", cities: ["Delhi"] },
  { id: "3", full_name: "Sana", phone: null, cities: ["Mumbai", "Pune"] },
  { id: "4", full_name: "Joe", phone: null, cities: [] },
];

test("Mumbai's offices and beat hubs are one city", () => {
  for (const name of ["Mumbai", "Fort Office", "Lower Parel", "Fort", "Mumbai (Andheri)"]) {
    assert.equal(hubCity(name), "Mumbai", name);
  }
  assert.equal(hubCity("kolkata"), "Kolkata");
  assert.equal(hubCity(""), null);
  assert.equal(hubCityForId(12), "Mumbai");
  assert.equal(hubCityForId("3"), "Delhi");
  assert.equal(hubCityForId(99), null);
});

test("only the pickup city's agents are offered", () => {
  const result = pickAgentsForCity(AGENTS, "Mumbai");
  assert.equal(result.scoped, true);
  assert.deepEqual(result.agents.map((a) => a.full_name), ["Ravi", "Sana"]);
});

test("a city with no agents, or no city, offers everyone", () => {
  for (const city of ["Jaipur", null]) {
    const result = pickAgentsForCity(AGENTS, city);
    assert.equal(result.scoped, false);
    assert.equal(result.agents.length, 4);
  }
});
