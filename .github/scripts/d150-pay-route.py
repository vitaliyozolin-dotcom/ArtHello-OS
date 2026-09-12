#!/usr/bin/env python3
"""Append the fixed ArtHello Pay virtual host to a reviewed candidate Caddy route."""
import argparse
import os
from pathlib import Path
import re
import stat
import tempfile


PAY_HOST = "pay-188-225-38-55.sslip.io"
UPSTREAM = re.compile(r"arthello-direct-[1-9][0-9]*-[1-9][0-9]*:8081")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def append_pay_route(path_value, upstream):
    path = Path(path_value)
    require(path.is_absolute() and path.resolve() == path and not path.is_symlink(), "unsafe route path")
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1
            and 0 < info.st_size <= 1048576, "unsafe route file")
    require(UPSTREAM.fullmatch(upstream), "invalid candidate upstream")
    source = path.read_text(encoding="utf-8")
    require("\x00" not in source and PAY_HOST not in source, "Pay host already present")
    block = f"""

{PAY_HOST} {{
  encode zstd gzip

  header {{
    -Server
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    X-Frame-Options "DENY"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"
  }}

  @pay_backend path /api/* /pay-assets/*
  handle @pay_backend {{
    reverse_proxy {upstream}
  }}

  handle {{
    rewrite * /pay{{uri}}
    reverse_proxy {upstream}
  }}
}}
"""
    descriptor, temporary = tempfile.mkstemp(prefix=".pay-route-", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(source.rstrip("\n") + block)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route", required=True)
    parser.add_argument("--upstream", required=True)
    args = parser.parse_args()
    append_pay_route(args.route, args.upstream)
    print("ARTHELLO_PAY_ROUTE=VERIFIED")


if __name__ == "__main__":
    main()
