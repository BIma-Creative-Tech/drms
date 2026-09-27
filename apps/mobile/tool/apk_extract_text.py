#!/usr/bin/env python3
"""Unpacks APKs into a directory the secret scanners can read (F4 gate "no secrets in APK").

For every entry of every APK: text files are written as they are; binary files (classes*.dex,
lib/*/libapp.so = Dart AOT, libflutter.so, resources.arsc, kernel_blob.bin, …) are written as a
`strings -n 8`-style dump of printable ASCII runs, so gitleaks/trivy see embedded literals.
Forbidden files (signing material, Firebase config) are reported and make the exit code 2.

Usage: apk_extract_text.py OUT_DIR APK [APK ...]
"""
import os
import re
import sys
import zipfile

MIN_RUN = 8
PRINTABLE = re.compile(rb"[\x20-\x7e\t]{%d,}" % MIN_RUN)
FORBIDDEN = re.compile(r"(^|/)(google-services\.json|key\.properties|[^/]*\.(jks|keystore|p12|pem|pfx))$", re.I)


def is_text(data: bytes) -> bool:
    if b"\x00" in data[:8192]:
        return False
    try:
        data[:8192].decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 64
    out, apks = argv[1], argv[2:]
    status = 0
    for apk in apks:
        base = os.path.join(out, os.path.basename(apk).removesuffix(".apk"))
        with zipfile.ZipFile(apk) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                if FORBIDDEN.search(name):
                    print(f"FORBIDDEN FILE in {apk}: {name}")
                    status = 2
                data = z.read(info)
                safe = name.replace("..", "_").lstrip("/")
                target = os.path.join(base, safe)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                if is_text(data):
                    with open(target, "wb") as f:
                        f.write(data)
                else:
                    with open(target + ".strings.txt", "wb") as f:
                        for m in PRINTABLE.finditer(data):
                            f.write(m.group(0) + b"\n")
        print(f"extracted {apk} -> {base}")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv))
