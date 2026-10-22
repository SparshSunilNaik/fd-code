import { expect, it } from "vite-plus/test";
import { namedDestination } from "./generalChatRouting.ts";
const projects = [
  { id: "rea", title: "REA" },
  { id: "sunflower", title: "sunflower" },
  { id: "brain", title: "IR Brain" },
];
it("recognises complete project names across case and punctuation", () => {
  expect(namedDestination("Continue the REA reverse engineering work", projects)?.id).toBe("rea");
  expect(namedDestination("Fix Sunflower’s Android upload", projects)?.id).toBe("sunflower");
  expect(namedDestination("Continue IR-Brain work", projects)?.id).toBe("brain");
});
it("does not treat substrings or multiple named projects as one destination", () => {
  expect(namedDestination("I have a great idea", projects)).toBeNull();
  expect(namedDestination("Compare REA and sunflower", projects)).toBeNull();
});
