/**
 * Sandbox probe — spawned as a subprocess by sandbox.test.ts.
 *
 * Usage: bun run test/_sandbox_probe.ts <operation> <path> [content]
 *   operation: "read" | "write" | "edit"
 *   path:      file path to operate on
 *   content:   (write only) content to write
 *
 * Outputs JSON: { isError: boolean, text: string }
 */
import { createServer } from "../src/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const [operation, targetPath, content] = process.argv.slice(2);

const server = createServer();
const client = new Client({ name: "test", version: "0.1.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
await client.connect(ct);

let args: Record<string, unknown>;
let toolName: string;

switch (operation) {
	case "read":
		toolName = "read_file";
		args = { path: targetPath };
		break;
	case "write":
		toolName = "write_file";
		args = { path: targetPath, content: content ?? "" };
		break;
	case "edit":
		toolName = "edit_file";
		args = { path: targetPath, edits: [{ replace: { old_text: "unsafe", new_text: "hacked" } }] };
		break;
	default:
		console.log(JSON.stringify({ isError: true, text: `Unknown operation: ${operation}` }));
		process.exit(1);
}

const result = await client.callTool({ name: toolName, arguments: args });
const text = (result as any).content[0].text;
console.log(JSON.stringify({ isError: !!(result as any).isError, text }));
await client.close();
