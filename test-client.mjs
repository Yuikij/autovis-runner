import { startCloudClient } from "./autovis-runner/apps/server/dist/cloud-client.js"
startCloudClient({
  cloudUrl: "http://localhost:8788",
  deviceToken: "test",
  localOrigin: "http://localhost:8787"
})
