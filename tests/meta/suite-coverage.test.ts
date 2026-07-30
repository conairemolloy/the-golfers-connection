// Guard against the gotcha this file exists because of (see ROADMAP.md's
// "A new test directory silently doesn't run"): vitest.config.ts has an
// explicit include list, and a suite missing from it reports zero tests,
// not an error — the summary just looks a little smaller. This asserts
// every directory under tests/ that holds at least one *.test.ts is
// matched by one of vitest.config.ts's include patterns.
//
// This file must itself be listed in that include list for the guard to
// run at all — the one case it can't catch itself. Accepted.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Minimal glob -> RegExp for the subset vitest.config.ts's include
 * patterns actually use: `**` (any number of path segments, including
 * zero) and `*` (any run of non-slash characters). Not a general-purpose
 * glob implementation — just enough to check coverage honestly rather
 * than special-casing this repo's "tests/<dir>/**\/*.test.ts" shape.
 */
function globToRegExp(pattern: string): RegExp {
  let regexStr = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i++; // consume the second '*'
      if (pattern[i + 1] === "/") {
        i++; // consume the following '/' too — "**/" matches zero-or-more dirs
        regexStr += "(?:.*/)?";
      } else {
        regexStr += ".*";
      }
    } else if (c === "*") {
      regexStr += "[^/]*";
    } else if (".+^${}()|[]\\".includes(c)) {
      regexStr += "\\" + c;
    } else {
      regexStr += c;
    }
  }
  return new RegExp(`^${regexStr}$`);
}

describe("vitest include coverage", () => {
  it("covers every directory under tests/ that contains a *.test.ts file", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const testsDir = path.resolve(repoRoot, "tests");

    const includePatterns = vitestConfig.test?.include ?? [];
    expect(includePatterns.length).toBeGreaterThan(0);
    const patternRegexes = includePatterns.map((p) => globToRegExp(p));

    const testFiles = walk(testsDir).filter((f) => f.endsWith(".test.ts"));
    expect(testFiles.length).toBeGreaterThan(0);

    const uncoveredDirs = new Set<string>();
    for (const absFile of testFiles) {
      const relFile = path.relative(repoRoot, absFile).split(path.sep).join("/");
      const covered = patternRegexes.some((re) => re.test(relFile));
      if (!covered) {
        uncoveredDirs.add(path.dirname(relFile));
      }
    }

    expect([...uncoveredDirs].sort(), "directories with *.test.ts files not covered by any vitest.config.ts include pattern").toEqual([]);
  });
});
