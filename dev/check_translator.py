"""Test the real translator's input-origin filter in a disposable plugin copy."""

import argparse
import json
from pathlib import Path
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
    guard_manifest = Path(__file__).resolve().parents[1] / "plugins/capacity-guard/.claude-plugin/plugin.json"
    default = json.loads(guard_manifest.read_text())["userConfig"]["resume_text"]["default"]
    if not isinstance(default, str) or not default.strip():
        parser.error("Guard resume_text must have a nonempty string default")
    messages = list(dict.fromkeys([default, "继续"]))
    print(f"Checking interaction-translator {manifest.get('version', 'unknown')}", flush=True)
    with tempfile.TemporaryDirectory(prefix="capacity-translator-check-") as temporary:
        target = Path(temporary)
        (target / ".claude-plugin").mkdir()
        shutil.copy2(source / ".claude-plugin/plugin.json", target / ".claude-plugin/plugin.json")
        for directory in ("hooks", "types"):
            shutil.copytree(source / directory, target / directory)
        (target / "tests").mkdir()
        test = '''import { expect, test } from "claude-code/testing"
for (const continuation of RESUME_MESSAGES_JSON) {
for (const backend of ["api", "codex-cli"]) {
  test(`plugin continuation ${continuation} bypasses ${backend} input translation`, { options: { backend } }, async ($, on) => {
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
}
'''.replace("RESUME_MESSAGES_JSON", json.dumps(messages, ensure_ascii=False))
        (target / "tests/input-source.test.ts").write_text(test)
        return subprocess.run(["claude", "plugin", "test", str(target)], check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
