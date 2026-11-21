from __future__ import annotations

import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from .config import logs_directory
from .utils import iso_z

LOG_FILE_PREFIX = "imsc-"
LOG_FILE_SUFFIX = ".log"
RETAINED_LOG_FILES = 30


def log_file_path(directory: Path, now: datetime) -> Path:
    return directory / f"{LOG_FILE_PREFIX}{now.date().isoformat()}{LOG_FILE_SUFFIX}"


def prune_log_files(directory: Path | None = None, keep: int = RETAINED_LOG_FILES) -> None:
    target = directory or logs_directory()
    try:
        files = sorted(
            path
            for path in target.iterdir()
            if path.name.startswith(LOG_FILE_PREFIX) and path.name.endswith(LOG_FILE_SUFFIX)
        )
    except OSError:
        return
    for path in files[: max(0, len(files) - keep)]:
        try:
            path.unlink()
        except OSError:
            pass


class Logger:
    def __init__(
        self,
        scope: str,
        directory: Path | None = None,
        now: Callable[[], datetime] | None = None,
        mirror: Callable[[str, str], None] | None = None,
    ) -> None:
        self.scope = scope
        self.directory = directory or logs_directory()
        self.now = now or (lambda: datetime.now(UTC))
        self.mirror = mirror or _console_mirror

    def _write(self, level: str, message: str) -> None:
        timestamp = self.now()
        line = f"{iso_z(timestamp)} {level.upper()} [{self.scope}] {message}"
        try:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = log_file_path(self.directory, timestamp)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(f"{line}\n")
                handle.flush()
            path.chmod(0o600)
        except OSError:
            pass
        self.mirror(level, line)

    def info(self, message: str) -> None:
        self._write("info", message)

    def warn(self, message: str) -> None:
        self._write("warn", message)

    def error(self, message: str) -> None:
        self._write("error", message)


def _console_mirror(level: str, line: str) -> None:
    stream = sys.stderr if level == "error" else sys.stdout
    print(line, file=stream, flush=True)


def create_logger(scope: str) -> Logger:
    return Logger(scope)
