import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, tmpPath, parseHashlines, type TestContext } from "./helpers";

describe("grep", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	// rg omits filename when searching a single file unless --with-filename
	// is passed. Our grep tool must always produce hashline-formatted output.

	async function writeInDir(name: string, fileName: string, content: string): Promise<string> {
		const dir = tmpPath(ctx, name);
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/${fileName}`, content);
		return dir;
	}

	test("basic pattern match with hashline format", async () => {
		const dir = await writeInDir("grep1", "file.txt", "hello world\nfoo bar\nhello again");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir });
		const text = getText(result);
		// Match lines have >> prefix in directory mode
		expect(text).toContain(":>>");
		expect(text).toMatch(/\d+:[0-9a-z]{2}\|/);
		expect(text).toContain("hello world");
		expect(text).toContain("hello again");
		expect(text).not.toContain("foo bar");
	});

	test("case-insensitive search", async () => {
		const dir = await writeInDir("grep-ci", "file.txt", "Hello\nhello\nHELLO\nworld");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir, i: true });
		const text = getText(result);
		expect(text).toContain("Hello");
		expect(text).toContain("hello");
		expect(text).toContain("HELLO");
	});

	test("context lines with pre/post", async () => {
		const dir = await writeInDir("grep-ctx", "file.txt", "aaa\nbbb\nTARGET\nddd\neee");
		const result = await callTool(ctx, "grep", { pattern: "TARGET", path: dir, pre: 1, post: 1 });
		const text = getText(result);
		expect(text).toContain("TARGET");
		// Context lines should be present
		expect(text).toContain("bbb");
		expect(text).toContain("ddd");
	});

	test("glob filter", async () => {
		const dir = tmpPath(ctx, "grep-glob");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/file.js`, "const x = 1;");
		await Bun.write(`${dir}/file.py`, "x = 1");
		await Bun.write(`${dir}/file.txt`, "x = 1");

		const result = await callTool(ctx, "grep", { pattern: "x", path: dir, glob: "*.js" });
		const text = getText(result);
		expect(text).toContain("file.js");
		expect(text).not.toContain("file.py");
		expect(text).not.toContain("file.txt");
	});

	test("file type filter", async () => {
		const dir = tmpPath(ctx, "grep-type");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/app.js`, "const y = 2;");
		await Bun.write(`${dir}/app.py`, "y = 2");

		const result = await callTool(ctx, "grep", { pattern: "y", path: dir, type: "js" });
		const text = getText(result);
		expect(text).toContain("app.js");
		expect(text).not.toContain("app.py");
	});

	test("limit results", async () => {
		const lines = Array.from({ length: 50 }, (_, i) => `match_line_${i}`).join("\n");
		const dir = await writeInDir("grep-limit", "file.txt", lines);
		const result = await callTool(ctx, "grep", { pattern: "match_line", path: dir, limit: 5 });
		const text = getText(result);
		const matchLines = text.split("\n").filter((l: string) => l.includes(":>>"));
		expect(matchLines.length).toBe(5);
	});

	test("no matches returns 'No matches found.'", async () => {
		const dir = await writeInDir("grep-none", "file.txt", "aaa\nbbb\nccc");
		const result = await callTool(ctx, "grep", { pattern: "zzzzzzz", path: dir });
		expect(getText(result)).toBe("No matches found.");
	});

	test("search in directory with multiple files", async () => {
		const dir = tmpPath(ctx, "grep-dir");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/a.txt`, "findme here");
		await Bun.write(`${dir}/b.txt`, "nothing");

		const result = await callTool(ctx, "grep", { pattern: "findme", path: dir });
		const text = getText(result);
		expect(text).toContain("a.txt");
		expect(text).toContain("findme here");
	});

	test("regex pattern", async () => {
		const dir = await writeInDir("grep-regex", "file.txt", "foo123\nbar456\nfoo789");
		const result = await callTool(ctx, "grep", { pattern: "foo\\d+", path: dir });
		const text = getText(result);
		expect(text).toContain("foo123");
		expect(text).toContain("foo789");
		expect(text).not.toContain("bar456");
	});

	test("hashes in grep output match hashes from read_file", async () => {
		const dir = await writeInDir("grep-hash", "file.txt", "unique_alpha\nunique_beta\nunique_gamma");
		const filePath = `${dir}/file.txt`;

		// Read to get canonical hashes
		const readResult = parseHashlines(getText(await callTool(ctx, "read_file", { path: filePath })));

		// Grep for "unique_beta" in directory so we get hashline format
		const grepResult = await callTool(ctx, "grep", { pattern: "unique_beta", path: dir });
		const grepText = getText(grepResult);

		// Extract hash from grep output: file:>>LINE:HASH|content
		const grepMatch = grepText.match(/>>(\d+):([0-9a-z]{2})\|unique_beta/);
		expect(grepMatch).not.toBeNull();

		const grepLine = parseInt(grepMatch![1], 10);
		const grepHash = grepMatch![2];

		// Should match the hash from read_file for the same line
		const readLine = readResult.find((l) => l.content === "unique_beta");
		expect(readLine).toBeDefined();
		expect(grepHash).toBe(readLine!.hash);
		expect(grepLine).toBe(readLine!.line);
	});

	test("single-file grep produces hashline-formatted output", async () => {
		const p = await writeTmpFile(ctx, "grep-single.txt", "aaa\nbbb\nccc");
		const result = await callTool(ctx, "grep", { pattern: "bbb", path: p });
		const text = getText(result);
		// Should have hash format even for single-file search
		expect(text).toMatch(/>>(\d+):([0-9a-z]{2})\|bbb/);
	});

	test("single-file grep hashes match read_file hashes", async () => {
		const p = await writeTmpFile(ctx, "grep-single-hash.txt", "alpha\nbeta\ngamma");
		const readResult = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const grepResult = await callTool(ctx, "grep", { pattern: "beta", path: p });
		const grepText = getText(grepResult);
		const grepMatch = grepText.match(/>>(\d+):([0-9a-z]{2})\|beta/);
		expect(grepMatch).not.toBeNull();
		const readLine = readResult.find((l) => l.content === "beta");
		expect(readLine).toBeDefined();
		expect(grepMatch![2]).toBe(readLine!.hash);
	});

	// --- JSON output mode tests ---

	type GrepRecord = { type: string; data: { path: { text: string }; lines: { text: string }; line_number: number; hash: string; submatches?: unknown[] } };

	/** Extract structured result from tool response */
	function getJsonGrep(result: Awaited<ReturnType<typeof callTool>>): GrepRecord[] {
		return (result as { structuredContent: { result: GrepRecord[] } }).structuredContent.result;
	}

	test("json mode: returns structured content and text", async () => {
		const dir = await writeInDir("grep-json1", "file.txt", "hello world\nfoo bar\nhello again");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir, json: true });
		// structuredContent.result has parsed array
		const records = getJsonGrep(result);
		expect(records.length).toBe(2);
		// content[0].text has JSON string
		const textRecords = JSON.parse(getText(result));
		expect(textRecords.length).toBe(2);
		for (const r of records) {
			expect(r.type).toBe("match");
			expect(r.data.hash).toMatch(/^[0-9a-z]{2}$/);
			expect(r.data.lines.text).toContain("hello");
		}
	});

	test("json mode: excludes stats nodes (begin, end, summary)", async () => {
		const dir = await writeInDir("grep-json-stats", "file.txt", "hello world\nfoo bar");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir, json: true });
		const records = getJsonGrep(result);
		const types = records.map((r) => r.type);
		expect(types).not.toContain("begin");
		expect(types).not.toContain("end");
		expect(types).not.toContain("summary");
	});

	test("json mode: strips absolute_offset", async () => {
		const dir = await writeInDir("grep-json-offset", "file.txt", "hello world");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir, json: true });
		const records = getJsonGrep(result);
		for (const r of records) {
			expect(r.data).not.toHaveProperty("absolute_offset");
		}
	});

	test("json mode: context lines have type context", async () => {
		const dir = await writeInDir("grep-json-ctx", "file.txt", "aaa\nbbb\nTARGET\nddd\neee");
		const result = await callTool(ctx, "grep", { pattern: "TARGET", path: dir, pre: 1, post: 1, json: true });
		const records = getJsonGrep(result);
		const types = records.map((r) => r.type);
		expect(types).toContain("match");
		expect(types).toContain("context");
		const matchRec = records.find((r) => r.type === "match")!;
		expect(matchRec.data.lines.text).toBe("TARGET");
		const ctxRecs = records.filter((r) => r.type === "context");
		const ctxTexts = ctxRecs.map((r) => r.data.lines.text);
		expect(ctxTexts).toContain("bbb");
		expect(ctxTexts).toContain("ddd");
	});

	test("json mode: no matches", async () => {
		const dir = await writeInDir("grep-json-none", "file.txt", "aaa\nbbb\nccc");
		const result = await callTool(ctx, "grep", { pattern: "zzzzzzz", path: dir, json: true });
		expect(getText(result)).toBe("No matches found.");
	});

	test("json mode: hashes match read_file hashes", async () => {
		const dir = await writeInDir("grep-json-hash", "file.txt", "unique_alpha\nunique_beta\nunique_gamma");
		const filePath = `${dir}/file.txt`;

		const readResult = parseHashlines(getText(await callTool(ctx, "read_file", { path: filePath })));
		const grepResult = await callTool(ctx, "grep", { pattern: "unique_beta", path: dir, json: true });
		const records = getJsonGrep(grepResult);

		const matchRec = records.find((r) => r.data.lines.text === "unique_beta")!;
		expect(matchRec).toBeDefined();

		const readLine = readResult.find((l) => l.content === "unique_beta")!;
		expect(readLine).toBeDefined();
		expect(matchRec.data.hash).toBe(readLine.hash);
		expect(matchRec.data.line_number).toBe(readLine.line);
	});

	test("json mode: multiple files", async () => {
		const dir = tmpPath(ctx, "grep-json-dir");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/a.txt`, "findme here");
		await Bun.write(`${dir}/b.txt`, "nothing");

		const result = await callTool(ctx, "grep", { pattern: "findme", path: dir, json: true });
		const records = getJsonGrep(result);
		expect(records.length).toBe(1);
		expect(records[0].data.path.text).toContain("a.txt");
		expect(records[0].data.lines.text).toBe("findme here");
	});

	test("json mode: single-file search includes hash", async () => {
		const p = await writeTmpFile(ctx, "grep-json-single.txt", "aaa\nbbb\nccc");
		const result = await callTool(ctx, "grep", { pattern: "bbb", path: p, json: true });
		const records = getJsonGrep(result);
		expect(records.length).toBe(1);
		expect(records[0].data.lines.text).toBe("bbb");
		expect(records[0].data.hash).toMatch(/^[0-9a-z]{2}$/);
	});

	test("json mode: context hashes match read_file hashes", async () => {
		const p = await writeTmpFile(ctx, "grep-json-ctx-hash.txt", "aaa\nbbb\nccc\nddd\neee");
		const readResult = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));

		const grepResult = await callTool(ctx, "grep", { pattern: "ccc", path: p, pre: 1, post: 1, json: true });
		const records = getJsonGrep(grepResult);

		// Verify context line "bbb" hash matches read_file
		const bbbRead = readResult.find((l) => l.content === "bbb")!;
		const bbbGrep = records.find((r) => r.data.lines.text === "bbb")!;
		expect(bbbGrep).toBeDefined();
		expect(bbbGrep.data.hash).toBe(bbbRead.hash);

		// Verify match line "ccc" hash matches read_file
		const cccRead = readResult.find((l) => l.content === "ccc")!;
		const cccGrep = records.find((r) => r.data.lines.text === "ccc")!;
		expect(cccGrep).toBeDefined();
		expect(cccGrep.data.hash).toBe(cccRead.hash);
	});

	test("json mode: content has no trailing newlines", async () => {
		const dir = await writeInDir("grep-json-newline", "file.txt", "hello world\nfoo bar");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir, json: true });
		const records = getJsonGrep(result);
		for (const r of records) {
			expect(r.data.lines.text).not.toMatch(/[\r\n]/);
		}
	});
});
