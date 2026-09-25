// A stand-in for the two things a new owner connects first: an OpenAI-compatible model
// server and an MCP server. It runs on the host so the Docker installation reaches it the
// way it reaches a real local model, through host.docker.internal. No dependencies.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_SERVICES_PORT ?? 8099);
const GOOD_KEY = "fake-good-key";
const MODEL_ID = "fake-model";
const REPLY = "Hello from the fake model.";

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function chatCompletion(request, response, body) {
  if (request.headers.authorization !== `Bearer ${GOOD_KEY}`) {
    json(response, 401, {
      error: { message: "Incorrect API key provided.", type: "invalid_request_error" },
    });
    return;
  }
  if (!body.stream) {
    json(response, 200, {
      id: "fake",
      object: "chat.completion",
      created: 0,
      model: MODEL_ID,
      choices: [
        { index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" },
      ],
    });
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (delta, finishReason = null) =>
    response.write(
      `data: ${JSON.stringify({
        id: "fake",
        object: "chat.completion.chunk",
        created: 0,
        model: MODEL_ID,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`,
    );
  emit({ role: "assistant" });
  emit({ content: REPLY });
  emit({}, "stop");
  response.end("data: [DONE]\n\n");
}

// Streamable HTTP MCP with one tool, answered as plain JSON.
function mcp(response, body) {
  const reply = (result) => json(response, 200, { jsonrpc: "2.0", id: body.id, result });
  switch (body.method) {
    case "initialize":
      return reply({
        protocolVersion: body.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-notes", version: "1.0.0" },
      });
    case "tools/list":
      return reply({
        tools: [
          {
            name: "read_note",
            description: "Read the team's pinned note",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
    case "tools/call":
      return reply({ content: [{ type: "text", text: "Ship the web release first." }] });
    case "ping":
      return reply({});
    default:
      // Notifications carry no id and expect no body.
      if (body.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      return json(response, 200, {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      });
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const path = new URL(request.url ?? "/", "http://fake").pathname;
    if (request.method === "GET" && path === "/v1/models") {
      return json(response, 200, { object: "list", data: [{ id: MODEL_ID, object: "model" }] });
    }
    if (request.method === "POST" && path === "/v1/chat/completions") {
      return chatCompletion(request, response, await readJson(request));
    }
    if (path === "/mcp") {
      if (request.method !== "POST") return response.writeHead(405).end();
      return mcp(response, await readJson(request));
    }
    json(response, 404, { error: { message: `No fake for ${request.method} ${path}` } });
  })().catch((error) => {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: { message: "fake failed" } });
  });
});

server.listen(port, "0.0.0.0", () => console.log(`fake services on :${port}`));
