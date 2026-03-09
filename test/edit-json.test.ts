import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, getStructuredContent, type TestContext } from "./helpers";

describe("edit_file — json output", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("json mode returns structured result", async () => {
		const p = await writeTmpFile(ctx, "json-edit.txt", "aaa\nbbb\nccc");
		const readResult = await callTool(ctx, "read_file", { path: p });
		const lines = parseHashlines(getText(readResult));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "BBB_REPLACED" } }],
			json: true,
		});
		
		expect(isError(editResult)).toBe(false);
		const text = getText(editResult);
		const data = JSON.parse(text);
		
		expect(data.filePath).toBe(p);
		expect(data.totalEdits).toBe(1);
		expect(data.addedLines).toBe(1);
		expect(data.removedLines).toBe(1);
		expect(data.warnings).toEqual([]);
		expect(data.diff).toContain("BBB_REPLACED");
	});

	test("json mode with multiple edits", async () => {
		const p = await writeTmpFile(ctx, "json-multi.txt", "one\ntwo\nthree");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [
				{ set_line: { anchor: `${lines[0].line}:${lines[0].hash}`, new_text: "ONE" } },
				{ set_line: { anchor: `${lines[2].line}:${lines[2].hash}`, new_text: "THREE" } },
			],
			json: true,
		});
		
		const data = JSON.parse(getText(editResult));
		expect(data.totalEdits).toBe(2);
		expect(data.addedLines).toBe(2);
		expect(data.removedLines).toBe(2);
	});

	test("json mode with expanding edit (more lines added)", async () => {
		const p = await writeTmpFile(ctx, "json-expand.txt", "single");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `${lines[0].line}:${lines[0].hash}`, new_text: "line1\nline2\nline3" } }],
			json: true,
		});
		
		const data = JSON.parse(getText(editResult));
		expect(data.addedLines).toBe(3);
		expect(data.removedLines).toBe(1);
	});

	test("json mode with contracting edit (fewer lines)", async () => {
		const p = await writeTmpFile(ctx, "json-contract.txt", "a\nb\nc\nd");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		// Replace 3 lines with 1
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ 
				replace_lines: { 
					start_anchor: `${lines[0].line}:${lines[0].hash}`, 
					end_anchor: `${lines[2].line}:${lines[2].hash}`, 
					new_text: "X" 
				} 
			}],
			json: true,
		});
		
		const data = JSON.parse(getText(editResult));
		expect(data.addedLines).toBe(1);
		expect(data.removedLines).toBe(3);
	});

	test("json mode with insert_after", async () => {
		const p = await writeTmpFile(ctx, "json-insert.txt", "first");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ insert_after: { anchor: `${lines[0].line}:${lines[0].hash}`, text: "second\nthird" } }],
			json: true,
		});
		
		const data = JSON.parse(getText(editResult));
		expect(data.totalEdits).toBe(1);
		// Note: insert_after may show different added/removed counts due to diff algorithm behavior
		expect(data.addedLines).toBeGreaterThanOrEqual(2);
		expect(data.diff).toContain("second");
		expect(data.diff).toContain("third");
	});

	test("json mode with delete (empty new_text)", async () => {
		const p = await writeTmpFile(ctx, "json-delete.txt", "keep\ndelete\nalso-keep");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `${lines[1].line}:${lines[1].hash}`, new_text: "" } }],
			json: true,
		});
		
		const data = JSON.parse(getText(editResult));
		expect(data.addedLines).toBe(0);
		expect(data.removedLines).toBe(1);
	});

	test("json mode with warning (large change)", async () => {
		const p = await writeTmpFile(ctx, "json-warning.txt", "line1\nline2\nline3\nline4\nline5");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		// Make a large replacement that triggers warning (> 4x edit count)
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ 
				replace_lines: { 
					start_anchor: `${lines[0].line}:${lines[0].hash}`, 
					end_anchor: `${lines[4].line}:${lines[4].hash}`, 
					new_text: "new1\nnew2\nnew3\nnew4\nnew5\nnew6\nnew7\nnew8\nnew9\nnew10\nnew11\nnew12\nnew13\nnew14\nnew15\nnew16\nnew17\nnew18\nnew19\nnew20\nnew21" 
				} 
			}],
			json: true,
		});
		
		const data = JSON.parse(getText(editResult));
		expect(data.warnings.length).toBeGreaterThan(0);
		// Warning message format: "X is more than 4× the number of edit operations..."
		expect(data.warnings[0]).toContain("more than 4×");
	});

	test("json mode on error returns error", async () => {
		const result = await callTool(ctx, "edit_file", {
			path: "/nonexistent/path.txt",
			edits: [{ set_line: { anchor: "1:ab", new_text: "test" } }],
			json: true,
		});
		expect(isError(result)).toBe(true);
	});

	// structuredContent tests
	test("json mode includes structuredContent matching text", async () => {
		const p = await writeTmpFile(ctx, "structured-edit.txt", "hello\nworld");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `${lines[0].line}:${lines[0].hash}`, new_text: "HELLO" } }],
			json: true,
		});
		
		const text = getText(result);
		const structured = getStructuredContent(result);
		
		expect(structured).toBeDefined();
		expect(JSON.stringify(structured)).toBe(text);
	});

	test("json mode structuredContent has correct fields", async () => {
		const p = await writeTmpFile(ctx, "structured-fields-edit.txt", "one\ntwo\nthree");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [
				{ set_line: { anchor: `${lines[0].line}:${lines[0].hash}`, new_text: "ONE" } },
				{ set_line: { anchor: `${lines[2].line}:${lines[2].hash}`, new_text: "THREE" } },
			],
			json: true,
		});
		
		const structured = getStructuredContent(result) as {
			filePath: string;
			warnings: string[];
			addedLines: number;
			removedLines: number;
			totalEdits: number;
			diff: string;
		};
		
		expect(structured.filePath).toBe(p);
		expect(structured.totalEdits).toBe(2);
		expect(structured.addedLines).toBe(2);
		expect(structured.removedLines).toBe(2);
		expect(structured.warnings).toEqual([]);
		expect(typeof structured.diff).toBe("string");
	});

	test("json mode structuredContent includes warnings when present", async () => {
		const p = await writeTmpFile(ctx, "structured-warning.txt", "line1\nline2\nline3\nline4\nline5");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		
		// Make a large replacement that triggers warning
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ 
				replace_lines: { 
					start_anchor: `${lines[0].line}:${lines[0].hash}`, 
					end_anchor: `${lines[4].line}:${lines[4].hash}`, 
					new_text: Array.from({ length: 25 }, (_, i) => `new${i + 1}`).join("\n")
				} 
			}],
			json: true,
		});
		
		const text = getText(result);
		const structured = getStructuredContent(result);
		
		expect(structured).toBeDefined();
		expect(JSON.stringify(structured)).toBe(text);
		
		const data = structured as { warnings: string[] };
		expect(data.warnings.length).toBeGreaterThan(0);
	});
});
