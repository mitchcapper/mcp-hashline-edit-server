import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, type TestContext } from "./helpers";

describe("grep input validation", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("rejects glob starting with dash", async () => {
		const result = await callTool(ctx, "grep", { pattern: "test", glob: "--include=*.ts" });
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("Invalid glob pattern");
	});

	test("allows glob with parent traversal (../)", async () => {
		// Glob with .. is fine — rg --glob only filters filenames, not paths
		const result = await callTool(ctx, "grep", { pattern: "test", glob: "../*.ts" });
		// Should not error on the glob itself (may return no matches, that's fine)
		expect(getText(result)).not.toContain("Invalid glob pattern");
	});

	test("allows normal glob patterns", async () => {
		const result = await callTool(ctx, "grep", { pattern: "test", glob: "*.ts" });
		// Should not error on glob validation
		expect(getText(result)).not.toContain("Invalid glob pattern");
	});

	test("rejects file type starting with dash", async () => {
		const result = await callTool(ctx, "grep", { pattern: "test", type: "--type-add" });
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("Invalid file type");
	});

	test("rejects file type with whitespace", async () => {
		const result = await callTool(ctx, "grep", { pattern: "test", type: "js py" });
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("Invalid file type");
	});

	test("rejects file type with tab", async () => {
		const result = await callTool(ctx, "grep", { pattern: "test", type: "js\tpy" });
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("Invalid file type");
	});

	test("allows arbitrary file type names without whitespace", async () => {
		// rg will reject unknown types, but our validation should not block them
		const result = await callTool(ctx, "grep", { pattern: "test", type: "somecustomtype" });
		// May error from rg ("Unknown file type"), but should NOT be our validation error
		expect(getText(result)).not.toContain("Invalid file type");
	});
});
