import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import { setupContext, teardownContext, callTool, getText, isError, tmpPath, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

/** Read file preserving BOM — Bun.file().text() silently strips BOM, so use fs for BOM-sensitive checks */
function readRaw(path: string): string {
	return fs.readFileSync(path, "utf-8");
}

describe("read_file — BOM and CR handling", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("BOM is stripped from read_file output", async () => {
		const p = await writeTmpFile(ctx, "bom-read.txt", "\uFEFFline one\nline two");
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		expect(text).not.toContain("\uFEFF");
		const parsed = parseHashlines(text);
		expect(parsed[0].content).toBe("line one");
	});

	test("CRLF is normalized in read_file output (no trailing \\r visible)", async () => {
		const p = await writeTmpFile(ctx, "crlf-read.txt", "alpha\r\nbeta\r\ngamma");
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		const parsed = parseHashlines(text);
		expect(parsed[0].content).toBe("alpha");
		expect(parsed[1].content).toBe("beta");
		expect(parsed[2].content).toBe("gamma");
		// No \r anywhere in the output
		for (const line of parsed) {
			expect(line.content).not.toContain("\r");
		}
	});

	test("BOM + CRLF file is fully cleaned in read_file output", async () => {
		const p = await writeTmpFile(ctx, "bom-crlf-read.txt", "\uFEFFfirst\r\nsecond\r\nthird");
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		expect(text).not.toContain("\uFEFF");
		expect(text).not.toContain("\r");
		const parsed = parseHashlines(text);
		expect(parsed[0].content).toBe("first");
		expect(parsed[1].content).toBe("second");
	});

	test("bare CR is normalized in read_file output", async () => {
		const p = await writeTmpFile(ctx, "bare-cr-read.txt", "one\rtwo\rthree");
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		const parsed = parseHashlines(text);
		// bare CR becomes LF, so we should see 3 separate lines
		expect(parsed.length).toBe(3);
		expect(parsed[0].content).toBe("one");
		expect(parsed[1].content).toBe("two");
		expect(parsed[2].content).toBe("three");
	});

	test("plain mode also strips BOM and CR", async () => {
		const p = await writeTmpFile(ctx, "bom-plain.txt", "\uFEFFhello\r\nworld");
		const result = await callTool(ctx, "read_file", { path: p, plain: true });
		const text = getText(result);
		expect(text).not.toContain("\uFEFF");
		expect(text).not.toContain("\r");
		expect(text).toContain("hello");
		expect(text).toContain("world");
	});

	test("json mode also strips BOM and CR", async () => {
		const p = await writeTmpFile(ctx, "bom-json.txt", "\uFEFFaaa\r\nbbb");
		const result = await callTool(ctx, "read_file", { path: p, json: true });
		const text = getText(result);
		expect(text).not.toContain("\uFEFF");
		expect(text).not.toContain("\r");
	});

	test("hashes are consistent between BOM and non-BOM versions of same content", async () => {
		const content = "function hello() {\n  return 1;\n}";
		const p1 = await writeTmpFile(ctx, "hash-no-bom.txt", content);
		const p2 = await writeTmpFile(ctx, "hash-with-bom.txt", "\uFEFF" + content);
		const r1 = await callTool(ctx, "read_file", { path: p1 });
		const r2 = await callTool(ctx, "read_file", { path: p2 });
		const h1 = parseHashlines(getText(r1));
		const h2 = parseHashlines(getText(r2));
		expect(h1.length).toBe(h2.length);
		for (let i = 0; i < h1.length; i++) {
			expect(h1[i].hash).toBe(h2[i].hash);
			expect(h1[i].content).toBe(h2[i].content);
		}
	});
});

describe("write_file — line ending preservation", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("overwriting a CRLF file preserves CRLF endings", async () => {
		const p = await writeTmpFile(ctx, "crlf-preserve.txt", "old line one\r\nold line two\r\n");
		const result = await callTool(ctx, "write_file", { path: p, content: "new line one\nnew line two\n" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		expect(raw).toBe("new line one\r\nnew line two\r\n");
	});

	test("overwriting an LF file keeps LF endings", async () => {
		const p = await writeTmpFile(ctx, "lf-preserve.txt", "old one\nold two\n");
		const result = await callTool(ctx, "write_file", { path: p, content: "new one\nnew two\n" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		expect(raw).toBe("new one\nnew two\n");
		expect(raw).not.toContain("\r");
	});

	test("new file (no existing) defaults to LF", async () => {
		const p = tmpPath(ctx, "brand-new.txt");
		const result = await callTool(ctx, "write_file", { path: p, content: "hello\nworld" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		expect(raw).toBe("hello\nworld");
		expect(raw).not.toContain("\r");
	});

	test("agent-sent CRLF is normalized to match existing LF file", async () => {
		const p = await writeTmpFile(ctx, "strip-crlf.txt", "original\n");
		const result = await callTool(ctx, "write_file", { path: p, content: "replaced\r\ncontent\r\n" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		// Existing file was LF, so agent's CRLF should be normalized to LF
		expect(raw).toBe("replaced\ncontent\n");
	});

	test("agent-sent CRLF into a new file is normalized to LF", async () => {
		const p = tmpPath(ctx, "new-crlf-stripped.txt");
		const result = await callTool(ctx, "write_file", { path: p, content: "line one\r\nline two\r\n" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		// New file defaults to LF, so CRLF should be stripped
		expect(raw).toBe("line one\nline two\n");
	});

	test("agent-sent mixed line endings are normalized to match existing", async () => {
		const p = await writeTmpFile(ctx, "mixed-endings.txt", "existing\r\nfile\r\n");
		const result = await callTool(ctx, "write_file", { path: p, content: "some\nlines\r\nmixed\rhere" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		// All endings should be CRLF to match existing file
		expect(raw).toBe("some\r\nlines\r\nmixed\r\nhere");
	});
});

describe("write_file — BOM preservation", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("overwriting a BOM file preserves BOM", async () => {
		const p = await writeTmpFile(ctx, "bom-preserve.txt", "\uFEFForiginal content");
		const result = await callTool(ctx, "write_file", { path: p, content: "new content" });
		expect(isError(result)).toBe(false);
		const raw = readRaw(p);
		expect(raw).toBe("\uFEFFnew content");
	});

	test("new file does not get BOM added", async () => {
		const p = tmpPath(ctx, "no-bom-new.txt");
		const result = await callTool(ctx, "write_file", { path: p, content: "no bom here" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		expect(raw).toBe("no bom here");
		expect(raw.charCodeAt(0)).not.toBe(0xFEFF);
	});

	test("overwriting non-BOM file does not add BOM", async () => {
		const p = await writeTmpFile(ctx, "no-bom-overwrite.txt", "plain content");
		const result = await callTool(ctx, "write_file", { path: p, content: "updated content" });
		expect(isError(result)).toBe(false);
		const raw = await Bun.file(p).text();
		expect(raw).toBe("updated content");
		expect(raw.charCodeAt(0)).not.toBe(0xFEFF);
	});

	test("BOM + CRLF file preserves both on overwrite", async () => {
		const p = await writeTmpFile(ctx, "bom-crlf-preserve.txt", "\uFEFFold one\r\nold two\r\n");
		const result = await callTool(ctx, "write_file", { path: p, content: "new one\nnew two\n" });
		expect(isError(result)).toBe(false);
		const raw = readRaw(p);
		expect(raw).toBe("\uFEFFnew one\r\nnew two\r\n");
	});
});

describe("edit_file — BOM round-trip with read_file", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("read then edit a BOM file preserves BOM and hides it from agent", async () => {
		const p = await writeTmpFile(ctx, "bom-roundtrip.txt", "\uFEFFaaa\nbbb\nccc");
		// Read — should not contain BOM
		const readResult = await callTool(ctx, "read_file", { path: p });
		const readText = getText(readResult);
		expect(readText).not.toContain("\uFEFF");
		const parsed = parseHashlines(readText);
		expect(parsed[0].content).toBe("aaa");
		// Edit using the hash from read
		const hash = parsed[1].hash;
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `2:${hash}`, new_text: "BBB" } }],
		});
		expect(isError(editResult)).toBe(false);
		// Verify BOM preserved and edit applied
		const raw = readRaw(p);
		expect(raw.startsWith("\uFEFF")).toBe(true);
		expect(raw).toBe("\uFEFFaaa\nBBB\nccc");
	});

	test("read then edit a CRLF file preserves CRLF endings", async () => {
		const p = await writeTmpFile(ctx, "crlf-roundtrip.txt", "aaa\r\nbbb\r\nccc");
		const readResult = await callTool(ctx, "read_file", { path: p });
		const readText = getText(readResult);
		const parsed = parseHashlines(readText);
		// Content should not show \r
		expect(parsed[0].content).toBe("aaa");
		expect(parsed[1].content).toBe("bbb");
		// Edit
		const hash = parsed[1].hash;
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `2:${hash}`, new_text: "BBB" } }],
		});
		expect(isError(editResult)).toBe(false);
		// Verify CRLF preserved
		const raw = await Bun.file(p).text();
		expect(raw).toBe("aaa\r\nBBB\r\nccc");
	});
});
