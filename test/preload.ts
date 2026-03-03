// Set sandbox to os.tmpdir() so tests can access their temp directories
// while still exercising sandbox path resolution logic.
import * as os from "node:os";
process.env.HASHLINE_SANDBOX_DIR = os.tmpdir();
