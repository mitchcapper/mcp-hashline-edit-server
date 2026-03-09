import { describe, test, expect } from "bun:test";
import { generateDiffString } from "../src/diff";

describe("generateDiffString — line counts", () => {
	test("no changes — both counts should be 0", () => {
		const content = "line1\nline2\nline3";
		const result = generateDiffString(content, content);

		expect(result.addedCount).toBe(0);
		expect(result.removedCount).toBe(0);
		expect(result.diff).toBe("");
	});

	test("add lines at end — addedCount reflects additions", () => {
		const oldContent = "line1\nline2\n";
		const newContent = "line1\nline2\nline3\nline4\n";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(2);
		expect(result.removedCount).toBe(0);
	});

	test("add lines at beginning — addedCount reflects additions", () => {
		const oldContent = "line2\nline3";
		const newContent = "line1\nline2\nline3";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(1);
		expect(result.removedCount).toBe(0);
	});

	test("remove lines from middle — removedCount reflects removals", () => {
		const oldContent = "line1\nto-remove\nalso-remove\nline4";
		const newContent = "line1\nline4";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(0);
		expect(result.removedCount).toBe(2);
	});

	test("replace single line — counts both removal and addition", () => {
		const oldContent = "line1\nold-line\nline3";
		const newContent = "line1\nnew-line\nline3";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(1);
		expect(result.removedCount).toBe(1);
	});

	test("replace 5 lines with 2 lines — accurate counts (the motivating case)", () => {
		const oldContent = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
		const newContent = "line1\nnew-a\nnew-b\nline6\nline7\nline8\nline9\nline10";

		const result = generateDiffString(oldContent, newContent);

		// Removed lines 2-5 (4 lines), added new-a and new-b (2 lines)
		expect(result.addedCount).toBe(2);
		expect(result.removedCount).toBe(4);
	});

	test("replace 3 lines with 5 lines — more additions than removals", () => {
		const oldContent = "line1\nold1\nold2\nold3\nline5";
		const newContent = "line1\nnew1\nnew2\nnew3\nnew4\nnew5\nline5";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(5);
		expect(result.removedCount).toBe(3);
	});

	test("multiple separate changes — counts accumulate correctly", () => {
		const oldContent = "keep1\nremove1\nkeep2\nremove2\nkeep3";
		const newContent = "keep1\nadd1\nkeep2\nadd2\nkeep3";

		const result = generateDiffString(oldContent, newContent);

		// Two separate removals and two separate additions
		expect(result.addedCount).toBe(2);
		expect(result.removedCount).toBe(2);
	});

	test("complete file replacement — all lines counted", () => {
		const oldContent = "old1\nold2\nold3";
		const newContent = "new1\nnew2";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(2);
		expect(result.removedCount).toBe(3);
	});

	test("empty to content — all additions", () => {
		const oldContent = "";
		const newContent = "line1\nline2\nline3";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(3);
		expect(result.removedCount).toBe(0);
	});

	test("content to empty — all removals", () => {
		const oldContent = "line1\nline2\nline3";
		const newContent = "";

		const result = generateDiffString(oldContent, newContent);

		expect(result.addedCount).toBe(0);
		expect(result.removedCount).toBe(3);
	});

	test("firstChangedLine is set correctly", () => {
		const oldContent = "line1\nline2\nline3";
		const newContent = "line1\nCHANGED\nline3";

		const result = generateDiffString(oldContent, newContent);

		expect(result.firstChangedLine).toBe(2);
	});

	test("firstChangedLine for additions at start", () => {
		const oldContent = "line2\nline3";
		const newContent = "line1\nline2\nline3";

		const result = generateDiffString(oldContent, newContent);

		expect(result.firstChangedLine).toBe(1);
	});
});
