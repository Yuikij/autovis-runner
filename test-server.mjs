import { WebSocketServer } from "ws"
const wss = new WebSocketServer({ port: 8788 })
wss.on("connection", (ws) => {
  console.log("Connected")
  ws.on("message", (raw) => {
    const isRecord = (value) => typeof value === "object" && value !== null
    const isStringRecord = (value) => {
      if (!isRecord(value)) return false
      return Object.values(value).every((item) => typeof item === "string")
    }
    const hasValidRelayId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128
    const isValidTunnelResponse = (value) => {
      if (!isRecord(value)) return false
      if (typeof value.status !== "number" || !Number.isInteger(value.status) || value.status < 100 || value.status > 599) return false
      if (value.headers !== undefined && !isStringRecord(value.headers)) return false
      if (value.body !== undefined && typeof value.body !== "string") return false
      if (value.bodyBase64 !== undefined && typeof value.bodyBase64 !== "string") return false
      if (value.binary !== undefined && typeof value.binary !== "boolean") return false
      if (value.error !== undefined && typeof value.error !== "string") return false
      if (value.binary === true && value.bodyBase64 === undefined && value.error === undefined) return false
      return true
    }

    const parseAgentEnvelope = (rawStr) => {
      if (rawStr.length === 0 || rawStr.length > 2000000) return "SIZE EXCEEDED"
      let parsed
      try { parsed = JSON.parse(rawStr) } catch { return "JSON PARSE FAIL" }
      if (!isRecord(parsed) || typeof parsed.type !== "string") return "NOT RECORD OR NO TYPE"
      if (parsed.type === "response") {
        if (!hasValidRelayId(parsed.id)) return "INVALID ID"
        if (!isValidTunnelResponse(parsed.response)) return "INVALID TUNNEL RESPONSE"
        return "SUCCESS response"
      }
      if (parsed.type === "response-start") {
        if (!hasValidRelayId(parsed.id) || !isRecord(parsed.response)) return "INVALID RESPONSE START"
        const head = parsed.response
        if (typeof head.status !== "number" || !Number.isInteger(head.status) || head.status < 100 || head.status > 599) return "INVALID STATUS"
        if (head.headers !== undefined && !isStringRecord(head.headers)) return "INVALID HEADERS"
        return "SUCCESS response-start"
      }
      if (parsed.type === "response-chunk") {
        if (!hasValidRelayId(parsed.id) || typeof parsed.data !== "string") return "INVALID CHUNK"
        return "SUCCESS response-chunk"
      }
      if (parsed.type === "response-end") {
        if (!hasValidRelayId(parsed.id)) return "INVALID END"
        return "SUCCESS response-end"
      }
      return "OTHER TYPE: " + parsed.type
    }

    const str = raw.toString("utf-8")
    const res = parseAgentEnvelope(str)
    if (!res.startsWith("SUCCESS")) {
      console.log("FAIL:", res)
      console.log("RAW:", str)
    } else {
      console.log(res)
    }
  })

  // simulate a request
  ws.send(JSON.stringify({
    type: "request",
    id: "req-123",
    request: {
      method: "GET",
      path: "/api/projects/project_y0f117t8/auth-profiles",
      headers: { "user-agent": "test" }
    }
  }))
})
console.log("WS server started on 8788")
