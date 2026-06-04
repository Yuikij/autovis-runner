import { expect } from "@playwright/test";

console.log("Before expect");
const result = expect("A").toContain("B");
console.log("After expect, result is:", result);
