import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — anchor echo stripping", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("insert_after strips echoed anchor line from inserted text", async () => {
		// When an LLM echoes the anchor line as the first line of inserted text,
		// stripInsertAnchorEchoAfter should remove it. This exercises equalsIgnoringWhitespace.
		const p = await writeTmpFile(ctx, "echo1.txt", "function hello() {\n  return 1;\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[0].line}:${lines[0].hash}`; // "function hello() {"

		const result = await callTool(ctx, "edit_file", {
			path: p,
			// Text starts with the anchor line (echoed) then the actual insertion
			edits: [{ insert_after: { anchor, text: "function hello() {\n  // new comment" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		// The echoed "function hello() {" should be stripped, leaving only the comment
		expect(content).toBe("function hello() {\n  // new comment\n  return 1;\n}");
	});

	test("replace_lines strips echoed boundary lines", async () => {
		// stripRangeBoundaryEcho removes lines that match the context around a range.
		// This also exercises equalsIgnoringWhitespace.
		const p = await writeTmpFile(ctx, "echo2.txt", "aaa\nbbb\nccc\nddd");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[1].line}:${lines[1].hash}`; // bbb
		const endAnchor = `${lines[2].line}:${lines[2].hash}`; // ccc

		const result = await callTool(ctx, "edit_file", {
			path: p,
			// Text includes echoed boundary context: "aaa" before and "ddd" after
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "aaa\nBBB\nCCC\nddd" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		// The echoed "aaa" and "ddd" should be stripped
		expect(content).toBe("aaa\nBBB\nCCC\nddd");
	});

	test("replace_lines keeps a final closer that only matches the next line when indentation is ignored", async () => {
		// The range grows, its last new line is the method's `}` and the line after the range is the class's `}`.
		const p = await writeTmpFile(ctx, "echo3.txt", "class A {\n\tvoid M() {\n\t\tx();\n\t}\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[1].line}:${lines[1].hash}`; // \tvoid M() {
		const endAnchor = `${lines[3].line}:${lines[3].hash}`; // \t}

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "\tvoid M() {\n\t\ty();\n\t\tz();\n\t}" } }],
		});
		expect(isError(result)).toBe(false);
		expect(await Bun.file(p).text()).toBe("class A {\n\tvoid M() {\n\t\ty();\n\t\tz();\n\t}\n}");
	});

	test("replace_lines keeps a first line that only matches the previous line when indentation is ignored", async () => {
		const p = await writeTmpFile(ctx, "echo4.txt", "{\n\ta();\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`; // \ta();

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: anchor, end_anchor: anchor, new_text: "\t{\n\t\tb();\n\t}" } }],
		});
		expect(isError(result)).toBe(false);
		expect(await Bun.file(p).text()).toBe("{\n\t{\n\t\tb();\n\t}\n}");
	});

	test("insert_after keeps a first line that only matches the anchor when indentation is ignored", async () => {
		const p = await writeTmpFile(ctx, "echo5.txt", "a {\n\tb {\n\t}\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[2].line}:${lines[2].hash}`; // \t}

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ insert_after: { anchor, text: "}\nc {" } }],
		});
		expect(isError(result)).toBe(false);
		expect(await Bun.file(p).text()).toBe("a {\n\tb {\n\t}\n}\nc {\n}");
	});

	test("replace_lines still strips an echoed closer with matching indentation", async () => {
		const p = await writeTmpFile(ctx, "echo6.txt", "class A {\n\tvoid M() {\n\t\tx();\n\t}\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[2].line}:${lines[2].hash}`; // \t\tx();

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: anchor, end_anchor: anchor, new_text: "\t\ty();\n\t\tz();\n\t}" } }],
		});
		expect(isError(result)).toBe(false);
		expect(await Bun.file(p).text()).toBe("class A {\n\tvoid M() {\n\t\ty();\n\t\tz();\n\t}\n}");
	});

	async function withEchoFixDisabled(run: () => Promise<void>): Promise<void> {
		process.env.HASHLINE_NO_FIX_POSSIBLE_ECHO = "1";
		try {
			await run();
		} finally {
			delete process.env.HASHLINE_NO_FIX_POSSIBLE_ECHO;
		}
	}

	test("HASHLINE_NO_FIX_POSSIBLE_ECHO keeps an echoed replace_lines closer", async () => {
		const p = await writeTmpFile(ctx, "echo7.txt", "class A {\n\tvoid M() {\n\t\tx();\n\t}\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[2].line}:${lines[2].hash}`; // \t\tx();

		await withEchoFixDisabled(async () => {
			const result = await callTool(ctx, "edit_file", {
				path: p,
				edits: [{ replace_lines: { start_anchor: anchor, end_anchor: anchor, new_text: "\t\ty();\n\t\tz();\n\t}" } }],
			});
			expect(isError(result)).toBe(false);
		});
		expect(await Bun.file(p).text()).toBe("class A {\n\tvoid M() {\n\t\ty();\n\t\tz();\n\t}\n\t}\n}");
	});

	test("HASHLINE_NO_FIX_POSSIBLE_ECHO keeps an echoed insert_after anchor line", async () => {
		const p = await writeTmpFile(ctx, "echo8.txt", "function hello() {\n  return 1;\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[0].line}:${lines[0].hash}`;

		await withEchoFixDisabled(async () => {
			const result = await callTool(ctx, "edit_file", {
				path: p,
				edits: [{ insert_after: { anchor, text: "function hello() {\n  // new comment" } }],
			});
			expect(isError(result)).toBe(false);
		});
		expect(await Bun.file(p).text()).toBe("function hello() {\nfunction hello() {\n  // new comment\n  return 1;\n}");
	});
});
