import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Sandbox integration tests. Since SANDBOX_DIR is a module-level constant,
 * we spawn the _sandbox_probe.ts script as a subprocess with
 * HASHLINE_SANDBOX_DIR set so the server picks up sandbox config at import time.
 */

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const PROBE_SCRIPT = path.join(PROJECT_ROOT, "test", "_sandbox_probe.ts");

async function probe(sandboxDir: string, operation: string, targetPath: string, content?: string) {
	const args = ["bun", "run", PROBE_SCRIPT, operation, targetPath];
	if (content !== undefined) args.push(content);

	const env = { ...process.env, HASHLINE_SANDBOX_DIR: sandboxDir };
	delete env.HASHLINE_NO_SANDBOX;

	const proc = Bun.spawn(args, {
		env,
		stdout: "pipe",
		stderr: "pipe",
		cwd: PROJECT_ROOT,
	});
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return JSON.parse(stdout.trim()) as { isError: boolean; text: string };
}

describe("sandbox (integration)", () => {
	let tmpDir: string;
	let sandboxDir: string;

	beforeAll(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-sandbox-test-"));
		sandboxDir = path.join(tmpDir, "sandbox");
		await fs.mkdir(sandboxDir, { recursive: true });
		await Bun.write(path.join(sandboxDir, "inside.txt"), "safe content");
		await Bun.write(path.join(tmpDir, "outside.txt"), "unsafe content");
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("blocks reads outside sandbox dir", async () => {
		const result = await probe(sandboxDir, "read", path.join(tmpDir, "outside.txt"));
		expect(result.text).toContain("Access denied");
		expect(result.text).toContain("resolves outside sandbox");
	});

	test("allows reads inside sandbox dir", async () => {
		const result = await probe(sandboxDir, "read", path.join(sandboxDir, "inside.txt"));
		expect(result.isError).toBe(false);
		expect(result.text).toContain("safe content");
	});

	test("blocks writes outside sandbox dir", async () => {
		const escapePath = path.join(tmpDir, "escape.txt");
		const result = await probe(sandboxDir, "write", escapePath, "escaped");
		expect(result.text).toContain("Access denied");
		expect(await Bun.file(escapePath).exists()).toBe(false);
	});

	test("blocks edits outside sandbox dir", async () => {
		const outsidePath = path.join(tmpDir, "outside.txt");
		const result = await probe(sandboxDir, "edit", outsidePath);
		expect(result.text).toContain("Access denied");
		expect(await Bun.file(outsidePath).text()).toBe("unsafe content");
	});

	test("blocks path traversal via ../", async () => {
		const result = await probe(sandboxDir, "read", "sandbox/../outside.txt");
		expect(result.isError).toBe(true);
	});
});
