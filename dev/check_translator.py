"""Test the real translator's input-origin filter in a disposable plugin copy."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plugin", type=Path, help="Path to the trusted interaction-translator plugin source")
    args = parser.parse_args()
    source = args.plugin.resolve()
    manifest = json.loads((source / ".claude-plugin/plugin.json").read_text())
    if manifest.get("name") != "interaction-translator":
        parser.error("The supplied directory is not interaction-translator")
    guard = Path(__file__).resolve().parents[1] / "plugins/capacity-guard/hooks/register.ts"
    match = re.search(r'const CONTINUE = "([^"]+)"', guard.read_text())
    if match is None:
        parser.error("Cannot locate the guard continuation; update this development helper")
    print(f"Checking interaction-translator {manifest.get('version', 'unknown')}", flush=True)
    with tempfile.TemporaryDirectory(prefix="capacity-translator-check-") as temporary:
        target = Path(temporary)
        (target / ".claude-plugin").mkdir()
        shutil.copy2(source / ".claude-plugin/plugin.json", target / ".claude-plugin/plugin.json")
        for directory in ("hooks", "types"):
            shutil.copytree(source / directory, target / directory)
        (target / "tests").mkdir()
        test = '''import { expect, test } from "claude-code/testing"
const continuation = CONTINUATION_JSON
for (const backend of ["api", "codex-cli"]) {
  test(`plugin continuation bypasses ${backend} input translation`, { options: { backend } }, async ($, on) => {
    let calls = 0
    on("http.fetch", () => { calls++; throw new Error("unexpected translation API call") })
    on("process.run", () => { calls++; throw new Error("unexpected translation process") })
    on("prompt.submit", (_, e) => ({ text: e.text, context: e.context, origin: e.origin }))
    const result = await $.prompt.submit({ text: continuation, origin: { kind: "plugin", name: "capacity-guard" }, wait: false })
    expect(result.text).toBe(continuation)
    expect(result.origin).toEqual({ kind: "plugin", name: "capacity-guard" })
    expect(calls).toBe(0)
  })
}
'''.replace("CONTINUATION_JSON", json.dumps(match.group(1), ensure_ascii=False))
        (target / "tests/input-source.test.ts").write_text(test)
        return subprocess.run(["claude", "plugin", "test", str(target)], check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
