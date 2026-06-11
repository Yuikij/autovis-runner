import { expect } from "@playwright/test";

let count = 0;
for (let i = 0; i < 4; i++) {
  try {
    const p = expect("A").toContain("B");
    if (p instanceof Promise) {
      console.log("IT IS A PROMISE!");
      p.catch(() => {});
    }
  } catch (e) {
    count++;
  }
}
console.log("Caught count:", count);
