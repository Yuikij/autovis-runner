import { expect } from "@playwright/test";

try {
  const result = expect("A").toContain("B");
  console.log("Type of result:", typeof result);
  console.log("Is Promise?", result instanceof Promise);
} catch (e) {
  console.log("Caught synchronously!");
}
