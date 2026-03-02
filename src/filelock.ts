/**
 * Cross-platform file locking using fs-native-extensions.
 * Acquires an exclusive advisory lock via waitForLock() during write
 * operations, preventing other cooperating processes from writing
 * while we hold the lock.
 */
import * as nodeFs from "node:fs";
// @ts-expect-error — no type declarations
import { waitForLock, unlock } from "fs-native-extensions";

export interface LockedFile {
	read(): string;
	write(content: string): void;
	close(): void;
}

type WaitForLock = (fd: number, opts?: { shared: boolean }) => Promise<void>;

/**
 * Open a file with an advisory lock.
 *
 * @param mode
 *   "read"   — shared lock, read-only (multiple readers allowed, blocks during writes)
 *   "edit"   — exclusive lock, read+write (file must exist)
 *   "create" — exclusive lock, read+write+create (truncates on open)
 */
export async function openLocked(filePath: string, mode: "read" | "edit" | "create"): Promise<LockedFile> {
	// Use string flags — Bun's openSync doesn't handle integer flag bitmasks correctly.
	// "w+" for create: truncates on open, but that's fine for write_file (full overwrite).
	const flag = mode === "read" ? "r" : mode === "edit" ? "r+" : "w+";
	const fd = nodeFs.openSync(filePath, flag);

	try {
		const shared = mode === "read";
		await (waitForLock as WaitForLock)(fd, { shared });
	} catch (err) {
		nodeFs.closeSync(fd);
		throw err;
	}

	let closed = false;

	return {
		read(): string {
			if (closed) throw new Error("File handle is closed");
			const size = nodeFs.fstatSync(fd).size;
			if (size === 0) return "";
			const buf = Buffer.alloc(size);
			nodeFs.readSync(fd, buf, 0, size, 0);
			return buf.toString("utf-8");
		},

		write(content: string): void {
			if (closed) throw new Error("File handle is closed");
			nodeFs.ftruncateSync(fd, 0);
			const data = Buffer.from(content, "utf-8");
			if (data.length > 0) {
				nodeFs.writeSync(fd, data, 0, data.length, 0);
			}
			nodeFs.fsyncSync(fd);
		},

		close(): void {
			if (!closed) {
				closed = true;
				try { (unlock as (fd: number) => void)(fd); } catch {}
				nodeFs.closeSync(fd);
			}
		},
	};
}
