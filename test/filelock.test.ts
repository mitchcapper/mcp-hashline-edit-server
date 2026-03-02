import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { openLocked } from "../src/filelock";

describe("openLocked", () => {
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-lock-test-"));
	});
	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function tmp(name: string) {
		return path.join(tmpDir, name);
	}

	test("read mode reads file content", async () => {
		const p = tmp("read.txt");
		await Bun.write(p, "hello world");
		const file = await openLocked(p, "read");
		try {
			expect(file.read()).toBe("hello world");
		} finally {
			file.close();
		}
	});

	test("read mode on empty file returns empty string", async () => {
		const p = tmp("read-empty.txt");
		await Bun.write(p, "");
		const file = await openLocked(p, "read");
		try {
			expect(file.read()).toBe("");
		} finally {
			file.close();
		}
	});

	test("edit mode can read and write", async () => {
		const p = tmp("edit.txt");
		await Bun.write(p, "original");
		const file = await openLocked(p, "edit");
		try {
			expect(file.read()).toBe("original");
			file.write("modified");
			expect(file.read()).toBe("modified");
		} finally {
			file.close();
		}
		// Verify on disk
		expect(await Bun.file(p).text()).toBe("modified");
	});

	test("edit mode truncates before writing", async () => {
		const p = tmp("edit-truncate.txt");
		await Bun.write(p, "long original content here");
		const file = await openLocked(p, "edit");
		try {
			file.write("short");
		} finally {
			file.close();
		}
		expect(await Bun.file(p).text()).toBe("short");
	});

	test("create mode creates new file", async () => {
		const p = tmp("create-new.txt");
		const file = await openLocked(p, "create");
		try {
			file.write("created");
		} finally {
			file.close();
		}
		expect(await Bun.file(p).text()).toBe("created");
	});

	test("create mode can overwrite existing file", async () => {
		const p = tmp("create-overwrite.txt");
		await Bun.write(p, "old stuff");
		const file = await openLocked(p, "create");
		try {
			file.write("new stuff");
		} finally {
			file.close();
		}
		expect(await Bun.file(p).text()).toBe("new stuff");
	});

	test("write empty content", async () => {
		const p = tmp("write-empty.txt");
		await Bun.write(p, "non-empty");
		const file = await openLocked(p, "edit");
		try {
			file.write("");
		} finally {
			file.close();
		}
		expect(await Bun.file(p).text()).toBe("");
	});

	test("close is idempotent", async () => {
		const p = tmp("close-twice.txt");
		await Bun.write(p, "test");
		const file = await openLocked(p, "read");
		file.close();
		// Second close should not throw
		file.close();
	});

	test("read after close throws", async () => {
		const p = tmp("read-after-close.txt");
		await Bun.write(p, "test");
		const file = await openLocked(p, "read");
		file.close();
		expect(() => file.read()).toThrow("File handle is closed");
	});

	test("write after close throws", async () => {
		const p = tmp("write-after-close.txt");
		await Bun.write(p, "test");
		const file = await openLocked(p, "edit");
		file.close();
		expect(() => file.write("new")).toThrow("File handle is closed");
	});

	test("read mode on nonexistent file throws", async () => {
		const p = tmp("nonexistent.txt");
		await expect(openLocked(p, "read")).rejects.toThrow();
	});

	test("edit mode on nonexistent file throws", async () => {
		const p = tmp("nonexistent-edit.txt");
		await expect(openLocked(p, "edit")).rejects.toThrow();
	});

	test("multiple shared readers allowed simultaneously", async () => {
		const p = tmp("multi-read.txt");
		await Bun.write(p, "shared content");
		const file1 = await openLocked(p, "read");
		const file2 = await openLocked(p, "read");
		try {
			expect(file1.read()).toBe("shared content");
			expect(file2.read()).toBe("shared content");
		} finally {
			file1.close();
			file2.close();
		}
	});

	test("write preserves unicode content", async () => {
		const p = tmp("unicode.txt");
		const content = "日本語テスト\n絵文字: 🎉🚀\naccénts: àéîõü";
		const file = await openLocked(p, "create");
		try {
			file.write(content);
		} finally {
			file.close();
		}
		expect(await Bun.file(p).text()).toBe(content);
	});
});
