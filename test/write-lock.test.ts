import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, tmpPath, type TestContext } from "./helpers";

describe("write lock serialization", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("concurrent writes to same file are serialized (no corruption)", async () => {
		const p = tmpPath(ctx, "concurrent.txt");
		// Write initial content
		await callTool(ctx, "write_file", { path: p, content: "initial" });

		// Fire multiple writes concurrently
		const results = await Promise.all([
			callTool(ctx, "write_file", { path: p, content: "write-A" }),
			callTool(ctx, "write_file", { path: p, content: "write-B" }),
			callTool(ctx, "write_file", { path: p, content: "write-C" }),
		]);

		// All writes should succeed (no errors)
		for (const result of results) {
			expect(isError(result)).toBe(false);
		}

		// Final content should be one of the written values (last one wins)
		const content = await Bun.file(p).text();
		expect(["write-A", "write-B", "write-C"]).toContain(content);
	});

	test("concurrent edits to same file don't corrupt", async () => {
		const p = await writeTmpFile(ctx, "concurrent-edit.txt", "aaa\nbbb\nccc");

		// Read to get anchors
		const readResult = await callTool(ctx, "read_file", { path: p });
		const text = getText(readResult);

		// Extract first line anchor
		const match = text.match(/(\d+:[0-9a-z]{2})\|aaa/);
		expect(match).not.toBeNull();
		const anchor = match![1];

		// Fire concurrent edits — second one may fail due to hash mismatch
		// (which is correct behavior: the hash changed after the first edit)
		const [r1, r2] = await Promise.all([
			callTool(ctx, "edit_file", {
				path: p,
				edits: [{ set_line: { anchor, new_text: "AAA" } }],
			}),
			callTool(ctx, "edit_file", {
				path: p,
				edits: [{ set_line: { anchor, new_text: "XXX" } }],
			}),
		]);

		// At least one should succeed
		const oneSucceeded = !isError(r1) || !isError(r2);
		expect(oneSucceeded).toBe(true);

		// First line should be one of the two edits (or unchanged if both failed, which shouldn't happen)
		const finalContent = await Bun.file(p).text();
		const lines = finalContent.split("\n");
		expect(lines).toHaveLength(3);
		expect(["AAA", "XXX"]).toContain(lines[0]);
	});

	test("writes to different files run independently", async () => {
		const p1 = tmpPath(ctx, "independent-1.txt");
		const p2 = tmpPath(ctx, "independent-2.txt");

		const [r1, r2] = await Promise.all([
			callTool(ctx, "write_file", { path: p1, content: "file one" }),
			callTool(ctx, "write_file", { path: p2, content: "file two" }),
		]);

		expect(isError(r1)).toBe(false);
		expect(isError(r2)).toBe(false);
		expect(await Bun.file(p1).text()).toBe("file one");
		expect(await Bun.file(p2).text()).toBe("file two");
	});

	test("write then read returns written content", async () => {
		const p = tmpPath(ctx, "write-then-read.txt");
		await callTool(ctx, "write_file", { path: p, content: "written content" });

		const readResult = await callTool(ctx, "read_file", { path: p });
		expect(isError(readResult)).toBe(false);
		expect(getText(readResult)).toContain("written content");
	});
});
